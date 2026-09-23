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
    const fewer = await index.query([1, 0, 0], { namespace: "workspace", topK: 50, filter: { eligible: true } });
    assert.deepEqual(fewer.matches.map(row => row.id), ["eligible"]);
    const empty = await index.query([1, 0, 0], { namespace: "missing", topK: 50 });
    assert.equal(empty.count, 0);
    assert.deepEqual(empty.matches, []);
    await db.pool.query("UPDATE storage.vector_collections SET ready=false WHERE name=$1", [name]);
    await assert.rejects(() => index.query([1, 0, 0]), /import has not been verified/);
  } finally {
    await db.pool.query("DELETE FROM storage.embeddings WHERE collection=$1", [name]);
    await db.pool.query("DELETE FROM storage.vector_collections WHERE name=$1", [name]);
    await db.close();
  }
});


test("filtered retrieval keeps one snapshot when eligibility changes between reads", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const name = `test-${crypto.randomUUID()}`;
  const index = new PostgresVectorIndex(db.pool, name);
  let changed = false;
  const pool = new Proxy(db.pool, {
    get(target, property) {
      if (property === "connect") return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(connection, member) {
            if (member === "query") return async (sql: string, parameters?: unknown[]) => {
              const result = await connection.query(sql, parameters);
              if (!changed && sql.startsWith("SELECT id FROM storage.embeddings")) {
                changed = true;
                await db.pool.query(`UPDATE storage.embeddings SET metadata=jsonb_build_object('eligible',id='replacement')
                  WHERE collection=$1`, [name]);
              }
              return result;
            };
            const value = Reflect.get(connection, member);
            return typeof value === "function" ? value.bind(connection) : value;
          },
        });
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    await index.create({ dimensions: 3, metric: "cosine" });
    await index.upsert([
      { id: "original", values: [1, 0, 0], metadata: { eligible: true } },
      { id: "replacement", values: [1, 1, 0], metadata: { eligible: false } },
    ]);
    const snapshot = await new PostgresVectorIndex(pool, name).query([1, 0, 0], { filter: { eligible: true } });
    assert.equal(changed, true);
    assert.deepEqual(snapshot.matches.map(row => row.id), ["original"]);
    const next = await index.query([1, 0, 0], { filter: { eligible: true } });
    assert.deepEqual(next.matches.map(row => row.id), ["replacement"]);
  } finally {
    await db.pool.query("DELETE FROM storage.embeddings WHERE collection=$1", [name]);
    await db.pool.query("DELETE FROM storage.vector_collections WHERE name=$1", [name]);
    await db.close();
  }
});
