import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {PostgresDatabase} from "../lib/storage/postgres";
import {activateNativeCorpus,readSelectedNativeCorpus} from "../lib/storage/native-corpus-acceptance";
import {nativeAcceptanceFixture} from "./helpers/native-corpus-acceptance";
import {programmaticAcceptanceFixture} from "./helpers/programmatic-corpus-acceptance";

for(const version of [1,2] as const){
test(`native acceptance v${version} atomically selects both fenced releases and preserves its history`,async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!);
  const schema=`acceptance_${randomUUID().replaceAll("-","")}`;
  const sql=(statement:string)=>statement.replaceAll("storage.",`${schema}.`).replaceAll("legal.",`${schema}.`);
  const query=(statement:string,values?:unknown[])=>db.pool.query(sql(statement),values);
  let onHistoryFence:(()=>void)|undefined;
  const pool=new Proxy(db.pool,{get(target,key){
    if(key==="query")return query;
    if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){
      if(property==="query")return(statement:string,values?:unknown[])=>{
        if(statement.includes("FOR SHARE OF g,c")&&values?.[0]===manifest.history.vector.generation)onHistoryFence?.();
        return connection.query(sql(statement),values);
      };
      const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;
    }});};
    const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
  }});
  const fixture=version===1?nativeAcceptanceFixture():await programmaticAcceptanceFixture(),manifest=fixture.manifest;
  const activate=()=>activateNativeCorpus({pool,...fixture,productRevision:manifest.productRevision});
  try {
    await db.pool.query(`CREATE SCHEMA ${schema}`);
    await query(`CREATE TABLE storage.vector_collections(name text PRIMARY KEY,source_revision bigint,ready boolean);
      CREATE TABLE storage.vector_search_generations(id uuid PRIMARY KEY,collection text,source_revision bigint,state text,member_count bigint);
      CREATE TABLE storage.corpus_membership_generations(id uuid PRIMARY KEY,release_id text,source_inventory_sha256 text,member_count bigint,state text);
      CREATE TABLE legal.legal_search_releases(id text PRIMARY KEY,capability text,environment text,configuration_identity text);
      CREATE TABLE legal.legal_custom_search_r2_runtime_roots(search_release_id text PRIMARY KEY,runtime_descriptor_r2_key text,runtime_descriptor_sha256 text,mapping_inventory_sha256 text,mapping_count bigint);`);
    await query(await readFile(new URL("../postgres/0031-native-corpus-acceptance.sql",import.meta.url),"utf8"));
    for(const capability of ["current","history"] as const){const selected=manifest[capability];
      await query("INSERT INTO storage.vector_collections VALUES($1,1,false)",[selected.vectorCollection]);
      await query("INSERT INTO storage.vector_search_generations VALUES($1,$2,1,'verified',1)",[selected.vector.generation,selected.vectorCollection]);
      await query("INSERT INTO storage.corpus_membership_generations VALUES($1,$2,$3,1,'verified')",[selected.membership.generation,selected.releaseId,selected.membership.sha256]);
      await query("INSERT INTO legal.legal_search_releases VALUES($1,$2,'production',$3)",[selected.releaseId,capability,selected.configurationIdentity]);
      await query("INSERT INTO legal.legal_custom_search_r2_runtime_roots VALUES($1,$2,$3,$4,1)",[selected.releaseId,selected.descriptor.key,selected.descriptor.sha256,selected.membership.sha256]);
    }
    assert.equal(await readSelectedNativeCorpus(pool,manifest.productRevision),null);
    await query("UPDATE storage.corpus_membership_generations SET state='retired' WHERE id=$1",[manifest.history.membership.generation]);
    await assert.rejects(activate,/MEMBERSHIP_CHANGED/);
    assert.equal((await query("SELECT count(*) FROM storage.vector_collections WHERE ready")).rows[0].count,0);
    assert.equal(await readSelectedNativeCorpus(pool,manifest.productRevision),null);
    await query("UPDATE storage.corpus_membership_generations SET state='verified'");
    await query("UPDATE storage.vector_collections SET source_revision=2 WHERE name=$1",[manifest.history.vectorCollection]);
    await assert.rejects(activate,/VECTOR_CHANGED/);
    await query("UPDATE storage.vector_collections SET source_revision=1");
    // A source writer must serialize behind the acceptance transaction's row fence.
    const writer=await db.pool.connect();
    await writer.query("BEGIN");
    await writer.query(sql("UPDATE storage.vector_collections SET source_revision=2 WHERE name=$1"),[manifest.history.vectorCollection]);
    let reached!:()=>void;
    const fenceReached=new Promise<void>(resolve=>{reached=resolve;});onHistoryFence=reached;
    const pending=activate();
    await fenceReached;
    const writerPid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let blocked=false;
    for(let attempt=0;attempt<50&&!blocked;attempt++){
      blocked=(await db.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",[writerPid])).rows[0].blocked;
      if(!blocked)await new Promise(resolve=>setTimeout(resolve,20));
    }
    await writer.query("COMMIT");writer.release();onHistoryFence=undefined;
    assert.equal(blocked,true,"Activation actually waits for the concurrent source writer");
    await assert.rejects(pending,/VECTOR_CHANGED/);
    await query("UPDATE storage.vector_collections SET source_revision=1");
    await query(`CREATE FUNCTION storage.reject_test_selection() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'TEST_SELECTION_FAILURE'; END; $$;
      CREATE TRIGGER reject_test_selection BEFORE INSERT ON storage.native_corpus_selections
      FOR EACH STATEMENT EXECUTE FUNCTION storage.reject_test_selection();`);
    await assert.rejects(activate,/TEST_SELECTION_FAILURE/);
    assert.equal((await query("SELECT count(*) FROM storage.vector_collections WHERE ready")).rows[0].count,0);
    assert.equal((await query("SELECT count(*) FROM storage.native_corpus_acceptances")).rows[0].count,0);
    assert.equal(await readSelectedNativeCorpus(pool,manifest.productRevision),null);
    await query("DROP TRIGGER reject_test_selection ON storage.native_corpus_selections");
    const accepted=await activate();
    assert.match(accepted,/^[a-f0-9]{64}$/u);
    assert.equal((await query("SELECT count(*) FROM storage.vector_collections WHERE ready")).rows[0].count,2);
    assert.deepEqual(await readSelectedNativeCorpus(pool,manifest.productRevision),manifest);
    await assert.rejects(readSelectedNativeCorpus(pool,"d".repeat(40)),/PRODUCT_CHANGED/);
    for(const table of ["native_corpus_acceptances","native_corpus_selections"]){
      await assert.rejects(query(`DELETE FROM storage.${table}`),/HISTORY_IMMUTABLE/);
      await assert.rejects(query(`TRUNCATE storage.${table} CASCADE`),/HISTORY_IMMUTABLE/);
    }
    assert.equal(await activate(),accepted,"Repeated activation preserves the same acceptance identity");
    assert.equal((await query("SELECT count(*) FROM storage.native_corpus_selections")).rows[0].count,2);
  } finally {await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.close();}
});
}
