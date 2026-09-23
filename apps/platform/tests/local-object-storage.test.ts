import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PostgresDatabase } from "../lib/storage/postgres";
import { LocalObjectStore } from "../lib/storage/objects";

test("concurrent immutable evidence writes create one object and retain exact ranged bytes", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const root = await mkdtemp(join(tmpdir(), "juro-objects-"));
  const bucket = `test-${crypto.randomUUID()}`;
  const store = new LocalObjectStore(db.pool, root, bucket);
  try {
    const writes = await Promise.all([
      store.put("../evidence/legal.txt", "abcdef", { onlyIf: { etagDoesNotMatch: "*" } }),
      store.put("../evidence/legal.txt", "uvwxyz", { onlyIf: { etagDoesNotMatch: "*" } }),
    ]);
    assert.equal(writes.filter(Boolean).length, 1);
    const whole = await store.get("../evidence/legal.txt");
    const content = await whole!.text();
    assert.ok(content === "abcdef" || content === "uvwxyz");
    const range = await store.get("../evidence/legal.txt", { range: { offset: 1, length: 3 } });
    assert.equal(await range!.text(), content.slice(1, 4));
    assert.equal(await store.get("absent"), null);
  } finally {
    await db.pool.query("DELETE FROM storage.objects WHERE bucket=$1", [bucket]);
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});
