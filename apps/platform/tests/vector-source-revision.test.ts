import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {PostgresDatabase} from "../lib/storage/postgres";
import {beginVectorRead} from "../lib/storage/vector-read-snapshot";

test("vector source revisions track direct mutations and truncation", async () => {
  const migration = await readFile(new URL("../postgres/0020-vector-source-revisions.sql", import.meta.url), "utf8");
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const schema = `vector_revision_${crypto.randomUUID().replaceAll("-", "")}`;
  const sql = (value: string) => value.replaceAll("storage.", `${schema}.`);
  const revision = async (name: string) => BigInt((await db.pool.query(
    `SELECT source_revision FROM ${schema}.vector_collections WHERE name=$1`, [name])).rows[0].source_revision);
  try {
    await db.pool.query(`CREATE SCHEMA ${schema}`);
    await db.pool.query(`CREATE TABLE ${schema}.vector_collections(name text PRIMARY KEY,
      dimensions integer NOT NULL,metric text NOT NULL,model text,ready boolean NOT NULL DEFAULT true);
      CREATE TABLE ${schema}.embeddings(collection text NOT NULL REFERENCES ${schema}.vector_collections(name),
      id text NOT NULL,namespace text NOT NULL DEFAULT '',embedding vector NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY(collection,id))`);
    await db.pool.query(sql(migration));
    await db.pool.query(`INSERT INTO ${schema}.vector_collections(name,dimensions,metric) VALUES ('a',3,'cosine'),('b',3,'cosine')`);
    assert.equal(await revision("a"), 0n);
    await db.pool.query(`INSERT INTO ${schema}.embeddings(collection,id,embedding) VALUES ('a','one','[1,0,0]'),('a','two','[0,1,0]')`);
    assert.equal(await revision("a"), 1n, "one revision per affected collection per statement");
    assert.equal(await revision("b"), 0n);
    await db.pool.query(`UPDATE ${schema}.embeddings SET metadata='{"eligible":false}',namespace='changed' WHERE collection='a'`);
    assert.equal(await revision("a"), 2n);
    await db.pool.query(`UPDATE ${schema}.embeddings SET collection='b' WHERE id='one'`);
    assert.equal(await revision("a"), 3n);
    assert.equal(await revision("b"), 1n, "moves fence both source and destination");
    await db.pool.query(`INSERT INTO ${schema}.embeddings(collection,id,embedding) VALUES ('b','one','[0,0,1]')
      ON CONFLICT(collection,id) DO UPDATE SET embedding=excluded.embedding`);
    assert.equal(await revision("b"), 2n);
    await db.pool.query(`DELETE FROM ${schema}.embeddings WHERE collection='a'`);
    assert.equal(await revision("a"), 4n);
    await db.pool.query(`UPDATE ${schema}.vector_collections SET model='different' WHERE name='a'`);
    assert.equal(await revision("a"), 5n);
    await db.pool.query(`UPDATE ${schema}.vector_collections SET ready=false WHERE name='a'`);
    assert.equal(await revision("a"), 5n, "readiness is independently checked, not source content");
    const client = await db.pool.connect();
    try {
      const isolated = new Proxy(client, {get(target, property) {
        if (property === "query") return (statement: string) => target.query(sql(statement));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }});
      await beginVectorRead(isolated);
      const before = await client.query(`SELECT source_revision FROM ${schema}.vector_collections WHERE name='b'`);
      const truncator = await db.pool.connect();
      try {
        await truncator.query("BEGIN");
        await truncator.query("SET LOCAL lock_timeout='50ms'");
        await assert.rejects(() => truncator.query(`TRUNCATE ${schema}.embeddings`), {code: "55P03"});
      } finally {await truncator.query("ROLLBACK"); truncator.release();}
      const within = await client.query(`SELECT source_revision FROM ${schema}.vector_collections WHERE name='b'`);
      assert.deepEqual(within.rows, before.rows, "generation fencing uses the same snapshot as source reads");
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${schema}.embeddings`)).rows[0].n, 1,
        "locking originals before the snapshot prevents TRUNCATE from emptying its source view");
      await client.query("COMMIT");
    } finally {await client.query("ROLLBACK"); client.release();}
    await db.pool.query(`TRUNCATE ${schema}.embeddings`);
    assert.equal(await revision("a"), 6n);
    assert.equal(await revision("b"), 3n);
  } finally {
    await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.close();
  }
});

test("vector generation publication requires complete original identity, digest and temporal parity", async () => {
  const migrations = await Promise.all(["0020-vector-source-revisions.sql", "0021-vector-search-generations.sql"]
    .map(name => readFile(new URL(`../postgres/${name}`, import.meta.url), "utf8")));
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const schema = `vector_generation_${crypto.randomUUID().replaceAll("-", "")}`;
  const generation = crypto.randomUUID();
  const publish = () => db.pool.query(`UPDATE ${schema}.vector_search_generations SET state='verified' WHERE id=$1`, [generation]);
  try {
    await db.pool.query(`CREATE SCHEMA ${schema}`);
    await db.pool.query(`CREATE TABLE ${schema}.vector_collections(name text PRIMARY KEY,
      dimensions integer NOT NULL,metric text NOT NULL,model text,ready boolean NOT NULL DEFAULT true);
      CREATE TABLE ${schema}.embeddings(collection text NOT NULL REFERENCES ${schema}.vector_collections(name),
      id text NOT NULL,namespace text NOT NULL DEFAULT '',embedding vector NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY(collection,id))`);
    for (const migration of migrations) await db.pool.query(migration.replaceAll("storage.", `${schema}.`));
    await db.pool.query(`INSERT INTO ${schema}.vector_collections(name,dimensions,metric) VALUES ('source',3,'cosine');
      INSERT INTO ${schema}.embeddings(collection,id,embedding,metadata) VALUES
      ('source','one','[1,0,0]','{"valid_from_epoch":0,"valid_to_epoch":10}'),
      ('source','two','[1,0,0]','{"valid_from_epoch":20,"valid_to_epoch":30}')`);
    await db.pool.query(`INSERT INTO ${schema}.vector_search_generations(id,collection,source_revision,member_count,group_count)
      SELECT $1,name,source_revision,2,1 FROM ${schema}.vector_collections WHERE name='source'`, [generation]);
    await assert.rejects(publish, /COUNT_MISMATCH/);
    await db.pool.query(`INSERT INTO ${schema}.vector_search_groups(generation_id,digest,embedding,coverage)
      VALUES ($1,sha256(vector_send('[1,0,0]'::vector)),'[0,1,0]','{[0,10)}')`, [generation]);
    await db.pool.query(`INSERT INTO ${schema}.vector_search_members(generation_id,id,digest)
      SELECT $1,id,sha256(vector_send(embedding)) FROM ${schema}.embeddings WHERE collection='source'`, [generation]);
    await assert.rejects(publish, /GROUP_INVALID/);
    await db.pool.query(`UPDATE ${schema}.vector_search_groups SET embedding='[1,0,0]' WHERE generation_id=$1`, [generation]);
    await db.pool.query(`UPDATE ${schema}.vector_search_members SET id='unknown' WHERE generation_id=$1 AND id='two'`, [generation]);
    await assert.rejects(publish, /MEMBER_INVALID/);
    await db.pool.query(`UPDATE ${schema}.vector_search_members SET id='two' WHERE generation_id=$1 AND id='unknown'`, [generation]);
    await assert.rejects(publish, /TEMPORAL_COVERAGE_INVALID/);
    await db.pool.query(`UPDATE ${schema}.vector_search_groups SET coverage='{[0,10),[20,30)}' WHERE generation_id=$1`, [generation]);
    const stalePublisher = await db.pool.connect();
    try {
      await stalePublisher.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await stalePublisher.query(`SELECT * FROM ${schema}.vector_search_groups WHERE generation_id=$1`, [generation]);
      await db.pool.query(`UPDATE ${schema}.vector_search_groups SET embedding='[0,1,0]' WHERE generation_id=$1`, [generation]);
      await assert.rejects(() => stalePublisher.query(`UPDATE ${schema}.vector_search_generations SET state='verified' WHERE id=$1`, [generation]),
        /PUBLICATION_REQUIRES_READ_COMMITTED/);
    } finally {await stalePublisher.query("ROLLBACK"); stalePublisher.release();}
    await assert.rejects(publish, /GROUP_INVALID/, "fresh publication must see the concurrent builder's invalid change");
    await db.pool.query(`UPDATE ${schema}.vector_search_groups SET embedding='[1,0,0]' WHERE generation_id=$1`, [generation]);
    await publish();
    await assert.rejects(() => db.pool.query(`UPDATE ${schema}.vector_search_groups SET embedding='[0,1,0]' WHERE generation_id=$1`, [generation]), /DATA_IMMUTABLE/);
    await assert.rejects(() => db.pool.query(`DELETE FROM ${schema}.vector_search_members WHERE generation_id=$1`, [generation]), /DATA_IMMUTABLE/);
    await assert.rejects(() => db.pool.query(`TRUNCATE ${schema}.vector_search_members`), /TRUNCATE_FORBIDDEN/);
    await assert.rejects(() => db.pool.query(`DELETE FROM ${schema}.vector_search_generations WHERE id=$1`, [generation]), /MUST_RETIRE/);
    const pending = crypto.randomUUID();
    await db.pool.query(`INSERT INTO ${schema}.vector_search_generations(id,collection,source_revision,member_count,group_count)
      SELECT $1,name,source_revision,2,1 FROM ${schema}.vector_collections WHERE name='source'`, [pending]);
    await db.pool.query(`UPDATE ${schema}.embeddings SET metadata='{}' WHERE collection='source' AND id='one'`);
    await assert.rejects(() => db.pool.query(`UPDATE ${schema}.vector_search_generations SET state='verified' WHERE id=$1`, [pending]), /SOURCE_CHANGED/);
    const usable = await db.pool.query(`SELECT g.id FROM ${schema}.vector_search_generations g
      JOIN ${schema}.vector_collections c ON c.name=g.collection AND c.source_revision=g.source_revision WHERE g.state='verified'`);
    assert.deepEqual(usable.rows, [], "the published generation becomes unusable after source mutation");
    await db.pool.query(`UPDATE ${schema}.vector_search_generations SET state='retired' WHERE id=$1`, [generation]);
    await db.pool.query(`DELETE FROM ${schema}.vector_search_generations WHERE id=$1`, [generation]);
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${schema}.vector_search_members`)).rows[0].n, 0);
  } finally {
    await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.close();
  }
});
