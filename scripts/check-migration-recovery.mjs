#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export function pendingMigrations(files, applied) {
  const current = new Map(files.map(file => [file.name, file.sha256]));
  for (const row of applied) {
    if (current.get(row.name) !== row.sha256) throw new Error(`Applied migration is missing or changed: ${row.name}`);
  }
  const completed = new Set(applied.map(row => row.name));
  return files.filter(file => !completed.has(file.name));
}

export function verifyRecoveryReceipt(receipt, environment, revision, pending, now = Date.now()) {
  if (receipt.environment !== environment || receipt.revision !== revision
    || receipt.restoreVerified !== true || receipt.offServerCopy !== true
    || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= now
    || JSON.stringify(receipt.pendingMigrations) !== JSON.stringify(pending)) {
    throw new Error("Critical migration requires a current verified off-server recovery receipt for this release");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [environment, revision, release, ...extra] = process.argv.slice(2);
  if (!["production", "staging"].includes(environment) || !/^[a-f0-9]{40}$/.test(revision ?? "") || extra.length
    || !(await realpath(release)).startsWith(`/srv/juro/${environment}/releases/`)) throw new Error("Invalid recovery-check target");
  const settings = parseEnv(await readFile(`/etc/juro/${environment}.env`, "utf8"));
  if (new URL(settings.DATABASE_URL).pathname !== `/juro_${environment}`) throw new Error("Database environment mismatch");
  const { default: pg } = await import(pathToFileURL(join(release, "apps/platform/node_modules/pg/lib/index.js")).href);
  const client = new pg.Client({ connectionString: settings.DATABASE_URL });
  await client.connect();
  try {
    const directory = join(release, "apps/platform/postgres");
    const files = await Promise.all((await readdir(directory)).filter(name => name.endsWith(".sql")).sort().map(async name => ({
      name, sha256: createHash("sha256").update(await readFile(join(directory, name), "utf8")).digest("hex"),
    })));
    const pending = pendingMigrations(files, (await client.query("SELECT name,sha256 FROM public.schema_migrations")).rows);
    if (pending.length) {
      const path = `/etc/juro/recovery/${environment}/${revision}.json`;
      const stat = await lstat(path).catch(() => { throw new Error("New migrations require an operator-created recovery receipt after backup and restore verification"); });
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022)) throw new Error("Recovery receipt must be a root-owned file without group/other write access");
      verifyRecoveryReceipt(JSON.parse(await readFile(path, "utf8")), environment, revision, pending);
    }
    console.log(JSON.stringify({ recoveryCheckPassed: true, pendingMigrations: pending.length, routineCodeDeployment: pending.length === 0 }));
  } finally { await client.end(); }
}
