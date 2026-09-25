import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {PostgresDatabase} from "../lib/storage/postgres";
import {PostgresVectorIndex} from "../lib/storage/vectors";
import {createHash} from "node:crypto";

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
    await index.upsert([
      {id:"one",values:vector,metadata:{valid_from_epoch:10,valid_to_epoch:20}},
      {id:"two",values:vector,metadata:{valid_from_epoch:30,valid_to_epoch:40}},
    ]);
    await db.pool.query(`INSERT INTO storage.vector_search_generations(id,collection,source_revision,member_count,group_count)
      SELECT $1,name,source_revision,2,1 FROM storage.vector_collections WHERE name=$2`,[generation,name]);
    await db.pool.query(`INSERT INTO storage.vector_search_groups(generation_id,digest,embedding,coverage)
      SELECT DISTINCT $1::uuid,sha256(vector_send(embedding)),embedding,NULL::nummultirange FROM storage.embeddings WHERE collection=$2`,[generation,name]);
    await db.pool.query(`INSERT INTO storage.vector_search_members(generation_id,id,digest)
      SELECT $1,id,sha256(vector_send(embedding)) FROM storage.embeddings WHERE collection=$2`,[generation,name]);
    await db.pool.query("UPDATE storage.vector_search_generations SET state='verified' WHERE id=$1",[generation]);
    assert.equal(await run(),0);
    const path=join(directory,generation,"checkpoint.json"),first=JSON.parse(await readFile(path,"utf8"));
    assert.equal(first.phase,"complete");
    const metadata=JSON.parse(await readFile(join(directory,generation,first.pages[0].metadata.file),"utf8"));
    assert.equal(metadata[0].coverage,"{[10,20),[30,40)}");
    assert.equal((await db.pool.query("SELECT coverage FROM storage.vector_search_groups WHERE generation_id=$1",[generation])).rows[0].coverage,null);
    // Upgrade an authenticated legacy export whose verified database groups
    // have no coverage. Reuse the exact vector bytes and preserve the gap.
    const legacyBytes=Buffer.from(JSON.stringify(metadata.map((row:{digest:string})=>({...row,coverage:null})))+"\n");
    const legacyHash=createHash("sha256").update(legacyBytes).digest("hex");
    await writeFile(join(directory,generation,legacyHash+".json"),legacyBytes);
    const legacyPage={...first.pages[0],coverageVersion:undefined,
      metadata:{file:legacyHash+".json",sha256:legacyHash,sizeBytes:legacyBytes.length}};
    await writeFile(path,JSON.stringify({...first,pages:[legacyPage]}));
    const vectorPath=join(directory,generation,first.pages[0].vectors.file);
    const vectorBytes=await readFile(vectorPath);
    await rm(vectorPath);
    assert.equal(await run(),0);
    const upgraded=JSON.parse(await readFile(path,"utf8"));
    assert.deepEqual(upgraded.pages,first.pages);assert.deepEqual(upgraded.matrix,first.matrix);
    await writeFile(vectorPath,vectorBytes);
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
