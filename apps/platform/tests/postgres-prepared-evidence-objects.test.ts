import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import type {Pool} from "pg";
import {PostgresDatabase} from "../lib/storage/postgres";
import {PreparedEvidenceStore,preparedEvidenceStoreFormat} from "../lib/storage/prepared-evidence-objects";
import {capturePreparedSource} from "../lib/legal-corpus/prepared-source-capture";
import {classifyLegalSourceUrl} from "../lib/legal/source-fetch";
import {resolvePreparedSourceEvidence} from "../lib/legal-corpus/prepared-source-evidence";
import {prepareCorpusEvidence} from "../lib/legal-chat/corpus-evidence";
import {publisherTextFingerprint} from "../lib/legal/lex-document-status";
import {resolveCitationEvidence} from "../lib/legal-corpus/citation-evidence";

test("capture role can append registered public evidence but cannot change retained or private objects",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!),suffix=randomUUID().replaceAll("-","");
  const schema=`prepared_objects_${suffix}`,role=`capture_${suffix}`;
  const rewrite=(statement:string)=>statement.replaceAll("storage.",`${schema}.`);
  const client=await db.pool.connect();
  const query=(statement:string,values?:unknown[])=>client.query(rewrite(statement),values);
  const pool={query} as unknown as Pool;
  const descriptor=Buffer.from(JSON.stringify({format:preparedEvidenceStoreFormat,packageSha256:"a".repeat(64)}));
  const generation=createHash("sha256").update(descriptor).digest("hex"),namespace=`legal-prepared-${generation}`;
  let roleCreated=false;
  try{
    await query(`CREATE SCHEMA ${schema};
      CREATE TABLE storage.objects(bucket text PRIMARY KEY,content text);
      INSERT INTO storage.objects VALUES('application','private retained bytes');
      CREATE FUNCTION storage.guard_native_corpus_acceptance_history() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'HISTORY_IMMUTABLE'; END $$;`);
    for(const name of ["0063-corpus-evidence-stores","0065-prepared-evidence-objects"]){
      await query(await readFile(new URL(`../postgres/${name}.sql`,import.meta.url),"utf8"));
    }
    await query("INSERT INTO storage.corpus_evidence_stores(generation_sha256,namespace,manifest) VALUES($1,$2,$3)",
      [generation,namespace,descriptor]);
    await query(`CREATE ROLE ${role} NOLOGIN`);roleCreated=true;
    await query(`GRANT USAGE ON SCHEMA ${schema} TO ${role};
      GRANT SELECT ON storage.prepared_evidence_objects TO ${role};
      GRANT EXECUTE ON FUNCTION storage.append_prepared_evidence(text,text,bytea) TO ${role};
      SET ROLE ${role}`);
    const store=new PreparedEvidenceStore(pool,namespace);
    assert.equal(await store.get("parent"),null);
    await store.put("parent",Buffer.from("complete public source"));
    await store.put("parent",Buffer.from("complete public source"));
    assert.deepEqual(await store.head("parent"),{key:"parent",size:22});
    const object=await store.get("parent");
    const first=await object!.bytes();first[0]=0;
    assert.equal(Buffer.from(await object!.bytes()).toString(),"complete public source");
    await assert.rejects(store.put("parent",Buffer.from("different source")),/PREPARED_EVIDENCE_CONFLICT/);
    await assert.rejects(new PreparedEvidenceStore(pool,`legal-prepared-${"b".repeat(64)}`).put("parent",Buffer.from("unknown")),/foreign key/);
    await assert.rejects(query("INSERT INTO storage.prepared_evidence_objects SELECT * FROM storage.prepared_evidence_objects"),/permission denied/);
    await assert.rejects(query("UPDATE storage.prepared_evidence_objects SET key='other'"),/permission denied/);
    await assert.rejects(query("DELETE FROM storage.prepared_evidence_objects"),/permission denied/);
    await assert.rejects(query("UPDATE storage.objects SET content='changed'"),/permission denied/);
    await assert.rejects(new PreparedEvidenceStore(pool,namespace,true).put("other",Buffer.from("x")),/READ_ONLY/);
    const text="An applicant may request a complete copy of the public record and receive it within ten days.";
    const bytes=Buffer.from(`<html><header id="doc_header">Действующий акт</header><main><h1>Records law</h1>
      <p>Article 7. Access to records</p><p>${text}</p>
      <p>The authority must withhold protected personal information concerning another person.</p></main></html>`);
    const fetched={...classifyLegalSourceUrl("https://lex.uz/en/docs/777"),bytes,
      contentSha256:createHash("sha256").update(bytes).digest("hex"),contentType:"text/html",etag:null,
      lastModified:null,fetchedAt:"2026-10-20T00:00:00.000Z",robotsUrl:"https://lex.uz/robots.txt"};
    const capture=await capturePreparedSource({fetched,bucket:store,store:{namespace,generationSha256:generation},options:{}});
    const resolved=await resolvePreparedSourceEvidence({capture,bucket:store,discovery:{officialUrl:fetched.canonicalUrl,
      languageTag:"en",text,textSha256:createHash("sha256").update(text).digest("hex")}});
    const evidence=await prepareCorpusEvidence({resolution:resolved.resolution,endpoint:{kind:"current"}});
    const answer=evidence.finalize({currentAt:fetched.fetchedAt,currentSourceStatus:{observation:capture.observation!,
      pinnedTextSha256:await publisherTextFingerprint(capture.parent.snapshot)}});
    const receipt=answer.source.citationEvidenceReceipt!;
    assert.equal((await resolveCitationEvidence(new PreparedEvidenceStore(pool,namespace,true),receipt)).text,answer.text);
    await query("RESET ROLE");
    assert.deepEqual((await query("SELECT * FROM storage.objects")).rows,[{bucket:"application",content:"private retained bytes"}]);
    assert.equal((await query("SELECT count(*)::int AS n FROM storage.prepared_evidence_objects")).rows[0].n,2);
    for(const statement of ["UPDATE storage.prepared_evidence_objects SET key='changed'","DELETE FROM storage.prepared_evidence_objects",
      "TRUNCATE storage.prepared_evidence_objects"]){
      await assert.rejects(query(statement),/HISTORY_IMMUTABLE/);
    }
  }finally{
    await client.query("RESET ROLE");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    if(roleCreated)await client.query(`DROP ROLE ${role}`);
    client.release();await db.pool.end();
  }
});
