import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../lib/storage/postgres";
import { PostgresVectorIndex } from "../lib/storage/vectors";

test("dense retrieval applies namespace and evidence filters before selecting nearest candidates", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const name = `test-${crypto.randomUUID()}`;
  const index = new PostgresVectorIndex(db.pool, name);
  try {
    await index.create({ dimensions: 3, metric: "cosine", model: "test", ready: false });
    await assert.rejects(() => index.query([1, 0, 0]), /import has not been verified/);
    await db.pool.query("UPDATE storage.vector_collections SET ready=true WHERE name=$1", [name]);
    await index.upsert([
      { id: "other-tenant", namespace: "other", values: [1, 0, 0], metadata: { eligible: true } },
      { id: "ineligible", namespace: "workspace", values: [1, 0, 0], metadata: { eligible: false } },
      { id: "eligible", namespace: "workspace", values: [1, 1, 0], metadata: { eligible: true } },
    ]);
    const result = await index.query([1, 0, 0], { namespace: "workspace", topK: 1, filter: { eligible: true }, returnMetadata: "all" });
    assert.deepEqual(result.matches.map(row => row.id), ["eligible"]);
    assert.ok(Math.abs(result.matches[0].score - Math.SQRT1_2) < 0.000001);
    assert.deepEqual(result.matches[0].metadata, { eligible: true });
    await db.pool.query("UPDATE storage.vector_collections SET ready=false WHERE name=$1", [name]);
    await assert.rejects(() => index.query([1, 0, 0]), /import has not been verified/);
  } finally {
    await db.pool.query("DELETE FROM storage.embeddings WHERE collection=$1", [name]);
    await db.pool.query("DELETE FROM storage.vector_collections WHERE name=$1", [name]);
    await db.close();
  }
});
