import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PostgresDatabase } from "../lib/storage/postgres";

const db = new PostgresDatabase(process.env.DATABASE_URL!);
const directory = new URL("../postgres/", import.meta.url);
const client = await db.pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(782143219)");
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(name, directory), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    const previous = await client.query("SELECT sha256 FROM public.schema_migrations WHERE name=$1", [name]);
    if (previous.rows[0]) {
      if (previous.rows[0].sha256 !== digest) throw new Error(`Applied migration was modified: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations(name,sha256) VALUES($1,$2)", [name, digest]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(782143219)");
  client.release();
  await db.close();
}
