import { readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import type { Pool } from "pg";

/** Writers and backup snapshots hold the shared lock; reclamation holds it exclusively. */
export function objectStorageLock(root: string) { return `juro:objects:${resolve(root)}`; }

export async function reclaimObjects(pool: Pool, root: string, digests?: string[], options: { wait?: boolean } = {}) {
  root = resolve(root);
  const client = await pool.connect();
  let removed = 0;
  try {
    await client.query("BEGIN");
    const deadline = Date.now() + 10_000;
    while (true) {
      // Never queue an exclusive lock behind a long backup: that would also
      // block subsequent shared readers and writers through lock fairness.
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired", [objectStorageLock(root)]);
      if (lock.rows[0].acquired) break;
      if (options.wait === false) { await client.query("ROLLBACK"); return {removed:0,processed:0}; }
      if (Date.now() >= deadline) throw new Error("Object reclamation is pinned by active storage work");
      await pause(100);
    }
    // Every active writer holds the shared lock from before creating its temp file.
    const entries = await readdir(root,{withFileTypes:true}).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) if (entry.isFile() && /^\.write-[a-f0-9-]{36}$/.test(entry.name)) {
      await unlink(join(root,entry.name));
    }
    const pending = await client.query<{sha256:string}>(`SELECT sha256 FROM storage.object_reclamation
      WHERE root=$1 AND ($2::text[] IS NULL OR sha256=ANY($2)) ORDER BY requested_at LIMIT 1000 FOR UPDATE`, [root, digests ?? null]);
    for (const {sha256} of pending.rows) {
      const references = await client.query("SELECT 1 FROM storage.objects WHERE sha256=$1 LIMIT 1", [sha256]);
      if (!references.rowCount) {
        await unlink(join(root, sha256.slice(0,2), sha256)).catch(error => { if (error.code !== "ENOENT") throw error; });
        removed++;
      }
      // A crash after unlink is safe: the pending row survives and ENOENT is idempotent.
      await client.query("DELETE FROM storage.object_reclamation WHERE root=$1 AND sha256=$2", [root, sha256]);
    }
    await client.query("COMMIT");
    return {removed,processed:pending.rowCount ?? 0};
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
