import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {PostgresDatabase} from "../lib/storage/postgres";
import {activatePreparedCorpus} from "../lib/storage/prepared-corpus-acceptance";
import {readSelectedCorpus} from "../lib/storage/native-corpus-acceptance";
import {preparedAcceptanceFixture} from "./helpers/prepared-corpus-acceptance";

test("prepared activation commits both endpoints together and rolls back rejected selection",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!),schema=`prepared_${randomUUID().replaceAll("-","")}`;
  const sql=(statement:string)=>statement.replaceAll("storage.",`${schema}.`);
  const query=(statement:string,values?:unknown[])=>db.pool.query(sql(statement),values);
  const pool=new Proxy(db.pool,{get(target,key){
    if(key==="query")return query;
    if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){
      if(property==="query")return(statement:string,values?:unknown[])=>connection.query(sql(statement),values);
      const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;
    }});};
    const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
  }});
  const f=preparedAcceptanceFixture(),activate=()=>activatePreparedCorpus({...f,pool,productRevision:f.manifest.productRevision});
  try{
    await db.pool.query(`CREATE SCHEMA ${schema}`);
    await query(`CREATE TABLE storage.vector_collections(name text PRIMARY KEY);
      CREATE TABLE storage.vector_search_generations(id uuid PRIMARY KEY);
      CREATE TABLE storage.corpus_membership_generations(id uuid PRIMARY KEY);
      CREATE TABLE storage.objects(bucket text);
      CREATE TABLE storage.embeddings(collection text);`);
    for(const migration of ["0031-native-corpus-acceptance","0062-corpus-retirement",
      "0063-corpus-evidence-stores","0064-prepared-corpus-acceptance"]){
      await query(await readFile(new URL(`../postgres/${migration}.sql`,import.meta.url),"utf8"));
    }
    assert.equal(await readSelectedCorpus(pool,f.manifest.productRevision),null);
    await assert.rejects(activate,/EVIDENCE_STORE_UNREGISTERED/);
    await query("INSERT INTO storage.corpus_evidence_stores(generation_sha256,namespace,manifest) VALUES($1,$2,$3)",
      [f.manifest.current.evidenceStore.generationSha256,f.manifest.current.evidenceStore.namespace,f.storeBytes]);
    await query(`CREATE FUNCTION storage.reject_test_selection() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'selection rejected'; END $$;
      CREATE TRIGGER reject_test_selection BEFORE INSERT ON storage.native_corpus_selections
      FOR EACH ROW EXECUTE FUNCTION storage.reject_test_selection();`);
    await assert.rejects(activate,/selection rejected/);
    assert.equal(Number((await query("SELECT count(*) FROM storage.prepared_corpus_acceptances")).rows[0].count),0);
    assert.equal(await readSelectedCorpus(pool,f.manifest.productRevision),null);
    await query("DROP TRIGGER reject_test_selection ON storage.native_corpus_selections");
    const accepted=await activate();
    assert.match(accepted,/^[a-f0-9]{64}$/);
    assert.deepEqual(await readSelectedCorpus(pool,f.manifest.productRevision),f.manifest);
    await assert.rejects(query("INSERT INTO storage.native_corpus_selections DEFAULT VALUES"),/exactly_one/);
    for(const table of ["prepared_corpus_acceptances","native_corpus_selections"]){
      await assert.rejects(query(`DELETE FROM storage.${table}`),/IMMUTABLE/);
      await assert.rejects(query(`TRUNCATE storage.${table} CASCADE`),/IMMUTABLE/);
    }
    assert.equal(await activate(),accepted);
    assert.equal(Number((await query("SELECT count(*) FROM storage.prepared_corpus_acceptances")).rows[0].count),1);
    assert.equal(Number((await query("SELECT count(*) FROM storage.native_corpus_selections")).rows[0].count),2);
  }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.pool.end();}
});
