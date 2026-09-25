import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../lib/storage/postgres";
import { PostgresVectorIndex } from "../lib/storage/vectors";

test("vector upsert preserves every float32 coordinate bit including signed zero", async () => {
  const db=new PostgresDatabase(process.env.DATABASE_URL!);
  const name=`test-${crypto.randomUUID()}`,index=new PostgresVectorIndex(db.pool,name);
  const values=new Float32Array([1,-0,0.1234567]);
  try {
    await index.create({dimensions:3,metric:"cosine"});
    await index.upsert([{id:"original",values}]);
    const actual=(await db.pool.query("SELECT vector_send(embedding) AS bytes FROM storage.embeddings WHERE collection=$1 AND id='original'",[name])).rows[0].bytes;
    const expected=Buffer.alloc(16);expected.writeUInt16BE(3,0);
    values.forEach((value,i)=>expected.writeFloatBE(value,4+i*4));
    assert.deepEqual(actual,expected);
  } finally {
    await db.pool.query("DELETE FROM storage.embeddings WHERE collection=$1",[name]);
    await db.pool.query("DELETE FROM storage.vector_collections WHERE name=$1",[name]);
    await db.close();
  }
});

test("compact generations expand original identities and become unusable after source changes", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const name = `test-${crypto.randomUUID()}`;
  const generation = crypto.randomUUID();
  const original = Array(1536).fill(0); original[1] = 1;
  const question = Array(1536).fill(0); question[0] = 1; question[1] = 0.0001234567;
  let groupReads = 0;
  let eligibilityProbes = 0;
  const pool = new Proxy(db.pool, {get(target, property) {
    if (property === "connect") return async () => {
      const client = await target.connect();
      return new Proxy(client, {get(connection, member) {
        if (member === "query") return (sql: string, parameters?: unknown[]) => {
          if (sql.includes("FROM storage.vector_search_groups g")) groupReads++;
          if (sql.startsWith("SELECT id FROM storage.embeddings")) eligibilityProbes++;
          return connection.query(sql, parameters);
        };
        const value = Reflect.get(connection, member);
        return typeof value === "function" ? value.bind(connection) : value;
      }});
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  const index = new PostgresVectorIndex(pool, name);
  try {
    await index.create({dimensions: 1536, metric: "cosine"});
    await db.pool.query(`INSERT INTO storage.embeddings(collection,id,embedding,metadata)
      SELECT $1,lpad(n::text,5,'0'),$2::vector,
        jsonb_build_object('valid_from_epoch',0,'valid_to_epoch',20,'originalId',n)
      FROM generate_series(1,10002) n`, [name, JSON.stringify(original)]);
    await db.pool.query(`INSERT INTO storage.vector_search_generations(id,collection,source_revision,member_count,group_count)
      SELECT $1,name,source_revision,10002,1 FROM storage.vector_collections WHERE name=$2`, [generation, name]);
    await db.pool.query(`INSERT INTO storage.vector_search_groups(generation_id,digest,embedding,coverage)
      VALUES ($1,sha256(vector_send($2::vector)),$2::vector,'{[0,20)}')`, [generation, JSON.stringify(original)]);
    await db.pool.query(`INSERT INTO storage.vector_search_members(generation_id,id,digest)
      SELECT $1,id,sha256(vector_send(embedding)) FROM storage.embeddings WHERE collection=$2`, [generation, name]);
    await db.pool.query("UPDATE storage.vector_search_generations SET state='verified' WHERE id=$1", [generation]);
    const filter = {valid_from_epoch: {$lte: 10}, valid_to_epoch: {$gt: 10}};
    const result = await index.query(question, {topK: 50, filter, returnMetadata: "all", returnValues: true});
    assert.equal(groupReads, 1, "the real adapter must execute prepared group search");
    assert.deepEqual(result.matches.map(row => row.id), Array.from({length: 50}, (_, i) => String(i + 1).padStart(5, "0")));
    const exactScore = (await db.pool.query("SELECT 1-($1::vector <=> $2::vector) AS score",
      [JSON.stringify(original), JSON.stringify(question)])).rows[0].score;
    assert.equal(result.matches[0]!.score, exactScore, "query coordinates must not be rounded through halfvec before full-precision scoring");
    assert.equal(result.matches[0]!.metadata!.originalId, 1);
    assert.deepEqual(result.matches[0]!.values, original);
    const digest=(await db.pool.query("SELECT encode(digest,'hex') AS digest FROM storage.vector_search_groups WHERE generation_id=$1",[generation])).rows[0].digest;
    let candidateCalls=0;
    const accelerated=new PostgresVectorIndex(pool,name,async request=>{
      candidateCalls++;
      assert.equal(request.collection,name);assert.equal(request.generation,generation);
      assert.equal(request.instant,10);assert.equal(request.values[1],question[1]);
      assert.match(request.sourceRevision,/^\d+$/u);
      return [digest];
    });
    const probesBefore = eligibilityProbes;
    assert.deepEqual((await accelerated.query(question,{topK:50,filter,returnMetadata:"all",returnValues:true})).matches,result.matches);
    assert.equal(eligibilityProbes,probesBefore,"verified exhaustive candidates skip the redundant eligibility scan");
    await accelerated.query(question,{topK:1,namespace:"",filter});
    assert.equal(eligibilityProbes,probesBefore+1,"unsupported scopes retain the eligibility scan");
    assert.equal(candidateCalls,1,"unsupported scopes cannot use prepared candidates");
    await assert.rejects(new PostgresVectorIndex(db.pool,name,async()=>{throw Error("Candidate offline");}).query(question,{topK:50,filter}),/Candidate offline/);
    await index.query(question, {topK: 1, namespace: "", filter});
    await index.query(question, {topK: 1, filter: {$and: [filter]}});
    assert.equal(groupReads, 2, "unqualified namespace/nested scopes must retain the generic path");
    for (const coordinate of [1_000_000, 1e-9]) {
      const outsideHalf = Array(1536).fill(0); outsideHalf[0] = coordinate;
      assert.equal((await index.query(outsideHalf, {topK: 1, filter})).count, 1);
    }
    assert.equal(groupReads, 2, "valid original queries outside halfvec representation must use the generic path");
    await db.pool.query("UPDATE storage.embeddings SET embedding=$3::vector WHERE collection=$1 AND id=$2",
      [name, "10002", JSON.stringify(question)]);
    const refreshed = await index.query(question, {topK: 1, filter});
    assert.equal(groupReads, 2, "a changed source cannot use the old generation");
    assert.equal(refreshed.matches[0]!.id, "10002");
    assert.equal(refreshed.matches[0]!.score, 1);
    assert.equal((await accelerated.query(question,{topK:1,filter})).matches[0]!.id,"10002");
    assert.equal(candidateCalls,1,"a stale generation cannot be sent to the candidate service");
  } finally {
    await db.pool.query("UPDATE storage.vector_search_generations SET state='retired' WHERE id=$1", [generation]);
    await db.pool.query("DELETE FROM storage.vector_search_generations WHERE id=$1", [generation]);
    await db.pool.query("DELETE FROM storage.embeddings WHERE collection=$1", [name]);
    await db.pool.query("DELETE FROM storage.vector_collections WHERE name=$1", [name]);
    await db.close();
  }
});

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
    const broad=await index.query([1,0,0],{topK:1});
    assert.equal(broad.count,1,"oversampling must preserve the requested result limit");
    assert.equal(broad.matches.length,1);
    assert.equal(broad.matches[0]!.score,1);
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
