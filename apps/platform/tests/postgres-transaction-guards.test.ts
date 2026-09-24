import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../lib/storage/postgres";

test("ownership guards allow valid writes and roll back a batch after ownership is lost", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const owned = crypto.randomUUID(), rejected = crypto.randomUUID();
  try {
    await db.prepare("CREATE TABLE IF NOT EXISTS storage_guard_probe(id text PRIMARY KEY)").run();
    const guard = (id: string) => db.prepare(`SELECT CASE WHEN EXISTS(
      SELECT 1 FROM storage_guard_probe WHERE id=?) THEN 1
      ELSE json_extract('AI_RUN_FINALIZATION_CLAIM_FAILED','$') END AS owned`).bind(id);
    const accepted = await db.batch([
      db.prepare("INSERT INTO storage_guard_probe(id) VALUES (?)").bind(owned), guard(owned),
    ]);
    assert.deepEqual(accepted[1].results, [{owned:1}]);
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO storage_guard_probe(id) VALUES (?)").bind(rejected), guard(crypto.randomUUID()),
    ]), /AI_RUN_FINALIZATION_CLAIM_FAILED/);
    assert.equal(await db.prepare("SELECT id FROM storage_guard_probe WHERE id=?").bind(rejected).first(), null);
    assert.deepEqual(await db.prepare("SELECT id FROM storage_guard_probe WHERE id=?").bind(owned).first(), {id:owned});
    const literal = "json_extract('AI_RUN_FINALIZATION_CLAIM_FAILED','$')";
    assert.deepEqual(await db.prepare("SELECT ?::text AS literalValue, json_extract('{\"count\":2}','$.count') AS countValue")
      .bind(literal).first(), {literalValue:literal,countValue:"2"});
  } finally {
    await db.prepare("DELETE FROM storage_guard_probe WHERE id IN (?,?)").bind(owned,rejected).run();
    await db.close();
  }
});
