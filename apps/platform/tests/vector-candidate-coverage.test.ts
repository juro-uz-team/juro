import assert from "node:assert/strict";
import test from "node:test";
import {PostgresDatabase} from "../lib/storage/postgres";
import {PostgresVectorIndex} from "../lib/storage/vectors";
import {readVectorCandidateCoverage} from "../lib/storage/vector-candidate-coverage";

test("candidate coverage merges overlapping bounds and keeps invalid members universal",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!),name=`test-${crypto.randomUUID()}`,generation=crypto.randomUUID();
  const vector=(coordinate:number)=>Array.from({length:1536},(_,i)=>Number(i===coordinate));
  const specifications=[
    {id:"overlap-a",group:0,metadata:{valid_from_epoch:0.1,valid_to_epoch:20}},
    {id:"overlap-b",group:0,metadata:{valid_from_epoch:10,valid_to_epoch:30}},
    {id:"valid",group:1,metadata:{valid_from_epoch:0,valid_to_epoch:10}},
    {id:"missing",group:1,metadata:{}},
    {id:"reversed",group:2,metadata:{valid_from_epoch:20,valid_to_epoch:10}},
    {id:"wrong-type",group:3,metadata:{valid_from_epoch:"0",valid_to_epoch:10}},
  ];
  try{
    const index=new PostgresVectorIndex(db.pool,name);await index.create({dimensions:1536,metric:"cosine"});
    await index.upsert(specifications.map(({id,group,metadata})=>({id,values:vector(group),metadata})));
    await db.pool.query(`INSERT INTO storage.vector_search_generations(id,collection,source_revision,member_count,group_count)
      SELECT $1,name,source_revision,6,4 FROM storage.vector_collections WHERE name=$2`,[generation,name]);
    await db.pool.query(`INSERT INTO storage.vector_search_groups(generation_id,digest,embedding)
      SELECT DISTINCT $1::uuid,sha256(vector_send(embedding)),embedding FROM storage.embeddings WHERE collection=$2`,[generation,name]);
    await db.pool.query(`INSERT INTO storage.vector_search_members(generation_id,id,digest)
      SELECT $1,id,sha256(vector_send(embedding)) FROM storage.embeddings WHERE collection=$2`,[generation,name]);
    await db.pool.query("UPDATE storage.vector_search_generations SET state='verified' WHERE id=$1",[generation]);
    const rows=(await db.pool.query("SELECT id,encode(digest,'hex') digest FROM storage.vector_search_members WHERE generation_id=$1",[generation])).rows;
    const coverage=await readVectorCandidateCoverage(db.pool,generation,name,[...new Set<string>(rows.map(row=>row.digest))]);
    for(const row of rows)assert.equal(coverage.get(row.digest),row.id.startsWith("overlap")?"{[0.1,30)}":null);
    await assert.rejects(readVectorCandidateCoverage(db.pool,generation,name,["0".repeat(64)]),/COVERAGE_INCOMPLETE/);
    await assert.rejects(readVectorCandidateCoverage(db.pool,generation,"missing-collection",[rows[0]!.digest]),/COVERAGE_INCOMPLETE/);
  }finally{
    await db.pool.query("UPDATE storage.vector_search_generations SET state='retired' WHERE id=$1",[generation]);
    await db.pool.query("DELETE FROM storage.vector_search_generations WHERE id=$1",[generation]);
    await db.pool.query("DELETE FROM storage.embeddings WHERE collection=$1",[name]);
    await db.pool.query("DELETE FROM storage.vector_collections WHERE name=$1",[name]);
    await db.close();
  }
});
