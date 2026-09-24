import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {PostgresDatabase} from "../lib/storage/postgres";
import {PostgresVectorIndex} from "../lib/storage/vectors";

test("candidate preparation resumes authenticated pages and rejects corrupted checkpoints",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!),name=`test-${crypto.randomUUID()}`,generation=crypto.randomUUID();
  const directory=await mkdtemp(join(tmpdir(),"juro-vector-export-"));
  const run=()=>new Promise<number|null>((resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx","scripts/prepare-vector-candidates.mts",directory,generation],
      {cwd:process.cwd(),env:process.env,stdio:["ignore","ignore","pipe"]});
    child.stderr.on("data",()=>{});child.on("error",reject);child.on("exit",resolve);
  });
  try{
    const index=new PostgresVectorIndex(db.pool,name);
    await index.create({dimensions:1536,metric:"cosine"});
    const vector=Array(1536).fill(0);vector[0]=1;
    await index.upsert([{id:"one",values:vector}]);
    await db.pool.query(`INSERT INTO storage.vector_search_generations(id,collection,source_revision,member_count,group_count)
      SELECT $1,name,source_revision,1,1 FROM storage.vector_collections WHERE name=$2`,[generation,name]);
    await db.pool.query(`INSERT INTO storage.vector_search_groups(generation_id,digest,embedding,coverage)
      SELECT $1,sha256(vector_send(embedding)),embedding,NULL FROM storage.embeddings WHERE collection=$2`,[generation,name]);
    await db.pool.query(`INSERT INTO storage.vector_search_members(generation_id,id,digest)
      SELECT $1,id,sha256(vector_send(embedding)) FROM storage.embeddings WHERE collection=$2`,[generation,name]);
    await db.pool.query("UPDATE storage.vector_search_generations SET state='verified' WHERE id=$1",[generation]);
    assert.equal(await run(),0);
    const path=join(directory,generation,"checkpoint.json"),first=JSON.parse(await readFile(path,"utf8"));
    assert.equal(first.phase,"complete");
    // Simulate an interruption after the final page but before publication.
    await writeFile(path,JSON.stringify({...first,phase:"exporting",matrix:undefined}));
    assert.equal(await run(),0);
    const resumed=JSON.parse(await readFile(path,"utf8"));
    assert.deepEqual(resumed.matrix,first.matrix);assert.deepEqual(resumed.pages,first.pages);
    await writeFile(join(directory,generation,first.pages[0].metadata.file),"[]");
    assert.notEqual(await run(),0);
  }finally{
    await db.pool.query("UPDATE storage.vector_search_generations SET state='retired' WHERE id=$1",[generation]);
    await db.pool.query("DELETE FROM storage.vector_search_generations WHERE id=$1",[generation]);
    await db.pool.query("DELETE FROM storage.embeddings WHERE collection=$1",[name]);
    await db.pool.query("DELETE FROM storage.vector_collections WHERE name=$1",[name]);
    await db.close();
    assert.ok(directory.startsWith(join(tmpdir(),"juro-vector-export-")));
    await rm(directory,{recursive:true,force:true});
  }
});
