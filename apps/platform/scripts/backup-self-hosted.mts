import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, constants } from "node:fs";
import { copyFile, link, mkdir, open, readFile, readdir, stat, statfs, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Pool } from "pg";
import { createInterface } from "node:readline";
import { objectStorageLock } from "../lib/storage/object-reclamation";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname)) throw new Error("Backup requires the private local database");
const destination = resolve(process.argv[2] ?? join(root, ".data/backups", new Date().toISOString().replaceAll(":", "-")));
const objects = resolve(process.env.OBJECT_STORAGE_PATH ?? join(root, ".data/objects"));
await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
await mkdir(destination, { mode: 0o700 }); // Never overwrite an existing backup.
const pool = new Pool({ connectionString: databaseUrl.toString() });
const client = await pool.connect();

async function command(args: string[], input?: string, output?: string) {
  const sudo = process.argv.includes("--sudo-docker");
  const child = spawn(sudo ? "sudo" : "docker", [...(sudo ? ["-n", "docker"] : []), "compose", "--env-file", join(root, ".env.self-hosted"), "exec", "-T", "postgres", ...args],
    { cwd: root, stdio: [input ? "pipe" : "ignore", output ? "pipe" : "ignore", "pipe"] });
  let errors = "";
  child.stderr?.on("data", chunk => { if (errors.length < 8192) errors += String(chunk); });
  const closed = new Promise<void>((accept, reject) => {
    child.on("error", reject);
    child.on("close", code => code === 0 ? accept() : reject(new Error(`Database backup command failed (${code}): ${errors}`)));
  });
  await Promise.all([closed,
    ...(input ? [pipeline(createReadStream(input), child.stdin!)] : []),
    ...(output ? [pipeline(child.stdout!, createWriteStream(output, { flags: "wx", mode: 0o600 }))] : []),
  ]);
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
async function capturePublicAssets() {
  const entries: Array<{ path: string; size: number; sha256: string }> = [];
  for (const application of ["platform", "website"]) {
    const publicRoot = join(root, "apps", application, "public");
    async function visit(directory: string, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const source = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Public asset symlinks must be materialized before backup");
        if (entry.isDirectory()) { await visit(source, relative); continue; }
        if (!entry.isFile()) continue;
        const path = `${application}/${relative}`;
        const target = join(destination, "public-assets", path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        // Public files may change with the next build, so do not hard-link them.
        await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        entries.push({ path, size: (await stat(target)).size, sha256: await sha256(target) });
      }
    }
    try { await stat(publicRoot); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    await visit(publicRoot);
  }
  await writeFile(join(destination, "public-assets.json"), JSON.stringify(entries, null, 2), { flag: "wx", mode: 0o600 });
  return entries;
}
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
try {
  const databaseBytes = Number((await client.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
  const objectBytes = Number((await client.query("SELECT coalesce(sum(size),0) AS bytes FROM (SELECT DISTINCT sha256,size FROM storage.objects) objects")).rows[0].bytes);
  const sameFilesystem = (await stat(destination)).dev === (await stat(objects)).dev;
  const space = await statfs(destination);
  const requiredBytes = databaseBytes * (process.argv.includes("--verify-restore") ? 3 : 1.5)
    + (sameFilesystem ? 0 : objectBytes) + 10 * 1024 ** 3;
  if (space.bavail * space.bsize < requiredBytes) throw new Error("Insufficient free space for backup and restore verification");
  // Keep snapshot-referenced bytes reachable until every backup hard link exists.
  await client.query("SELECT pg_advisory_lock_shared(hashtextextended($1,0))", [objectStorageLock(objects)]);
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (await client.query("SELECT pg_export_snapshot() id")).rows[0].id as string;
  const tables = (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('app','legal','storage','public') ORDER BY schemaname,tablename")).rows;
  const counts: Array<{ schema: string; table: string; rows: string }> = [];
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::text n FROM ${identifier(table.schemaname)}.${identifier(table.tablename)}`);
    counts.push({ schema: table.schemaname, table: table.tablename, rows: result.rows[0].n });
  }
  const dump = join(destination, "database.dump");
  await command(["pg_dump", "-U", databaseUrl.username, "-d", databaseUrl.pathname.slice(1), "--format=custom", `--snapshot=${snapshot}`, "--no-owner", "--no-privileges"], undefined, dump);
  const manifest = await open(join(destination, "objects.jsonl"), "wx", 0o600);
  let cursor = "", objectCount = 0;
  try {
    while (true) {
      const rows = (await client.query("SELECT DISTINCT sha256,size::text FROM storage.objects WHERE sha256>$1 ORDER BY sha256 LIMIT 1000", [cursor])).rows;
      if (!rows.length) break;
      for (const row of rows) {
        const source = join(objects, row.sha256.slice(0, 2), row.sha256);
        const target = join(destination, "objects", row.sha256.slice(0, 2), row.sha256);
        if (String((await stat(source)).size) !== row.size) throw new Error("Backup object size mismatch");
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        try { await link(source, target); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
          await copyFile(source, target, constants.COPYFILE_EXCL);
        }
        await manifest.write(JSON.stringify({ sha256: row.sha256, size: row.size }) + "\n");
        cursor = row.sha256; objectCount++;
      }
    }
  } finally { await manifest.close(); }
  await client.query("COMMIT");
  await client.query("SELECT pg_advisory_unlock_shared(hashtextextended($1,0))", [objectStorageLock(objects)]);
  await writeFile(join(destination, "private.env"), await readFile(join(root, ".env.self-hosted")), { flag: "wx", mode: 0o600 });
  const publicAssets = await capturePublicAssets();
  const report = { publicAssetCount: publicAssets.length, completedAt: new Date().toISOString(), databaseSha256: await sha256(dump), objectCount, tables: counts, restoreVerified: false };
  if (process.argv.includes("--verify-restore")) {
    const name = `juro_restore_${randomBytes(8).toString("hex")}`;
    await pool.query(`CREATE DATABASE ${identifier(name)}`);
    try {
      await command(["pg_restore", "-U", databaseUrl.username, "-d", name, "--no-owner", "--no-privileges", "--exit-on-error"], dump);
      const restoreUrl = new URL(databaseUrl); restoreUrl.pathname = "/" + name;
      const restored = new Pool({ connectionString: restoreUrl.toString() });
      try {
        for (const table of counts) {
          const result = await restored.query(`SELECT count(*)::text n FROM ${identifier(table.schema)}.${identifier(table.table)}`);
          if (result.rows[0].n !== table.rows) throw new Error(`Restored count mismatch: ${table.schema}.${table.table}`);
        }
        const lines = createInterface({ input: createReadStream(join(destination, "objects.jsonl")), crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line) continue;
          const object = JSON.parse(line) as { sha256: string };
          if (await sha256(join(destination, "objects", object.sha256.slice(0, 2), object.sha256)) !== object.sha256) throw new Error("Restored object hash mismatch");
        }
        for (const asset of publicAssets) {
          if (await sha256(join(destination, "public-assets", asset.path)) !== asset.sha256) throw new Error("Restored public asset hash mismatch");
        }
      } finally { await restored.end(); }
      report.restoreVerified = true;
    } finally { await pool.query(`DROP DATABASE ${identifier(name)}`); }
  }
  await writeFile(join(destination, "manifest.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ destination, objectCount, tables: counts.length, restoreVerified: report.restoreVerified }));
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
