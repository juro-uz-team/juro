import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {readR2NativeDiscoveryMetadata,resolveR2NativeCustomEvidence,createR2NativeProvisionReader} from "../lib/legal-corpus/target-evidence";
import {customRuntimeLegalIdentitySchema} from "../lib/legal-corpus/custom-bm25-runtime";
import {MemoryEvidenceBucket,representativeProvision} from "./helpers/legal-target";
import {createDiscoveryMetadataReader} from "../lib/legal-corpus/discovery-metadata";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {createSharedSourceObservationRefresh} from "../lib/legal/shared-source-observation";
import {indexedRetrievalSignal,runIndexedRetrieval} from "../lib/runtime/indexed-retrieval";
import type {SourceObservation} from "../lib/legal/source-observation";

function fixture(fields:Record<string,unknown>={}) {
  const bytes=new TextEncoder().encode(JSON.stringify({...representativeProvision,sourceNormalizedSha256:"b".repeat(64),...fields}));
  const hash=createHash("sha256").update(bytes).digest("hex"),bucket=new MemoryEvidenceBucket();
  bucket.objects.set("provision",{bytes,customMetadata:{schemaversion:"1",sha256:hash}});
  const identity=customRuntimeLegalIdentitySchema.parse({
    legalIdentitySha256:"a".repeat(64),
    legalInstrumentId:representativeProvision.legalInstrumentId,
    officialExpressionId:representativeProvision.officialExpressionId,
    textRevisionId:representativeProvision.textRevisionId,
    provisionConceptId:representativeProvision.provisionConceptId,
    provisionRenditionId:representativeProvision.provisionRenditionId,
    languageTag:representativeProvision.languageTag,script:representativeProvision.script,
    textualAuthority:representativeProvision.textualAuthority,
    evidenceProvisionRenditionId:representativeProvision.provisionRenditionId,
    validFrom:"2026-01-01T00:00:00.000Z",validTo:null,
    evidence:{r2Key:"provision",byteCount:bytes.byteLength,sha256:hash,
      sourceNormalizedSha256:"b".repeat(64),mediaType:"application/json; charset=utf-8"},
    citation:{label:"Official provision",url:representativeProvision.sourceUrl},
  });
  return {bucket,identity};
}

test("one research reader shares authenticated provision reads across discovery and resolution",async context=>{
  const {bucket,identity}=fixture(),get=bucket.get.bind(bucket);
  let reads=0;
  context.mock.method(bucket,"get",async(...args:Parameters<typeof bucket.get>)=>{reads++;return get(...args);});
  const dependencies={bucket,currentAt:"2026-06-01T00:00:00.000Z",readProvision:createR2NativeProvisionReader()};
  const [metadata,evidence]=await Promise.all([
    readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"current"}),
    resolveR2NativeCustomEvidence(dependencies,identity,{kind:"current"}),
  ]);
  assert.equal(reads,1);
  assert.equal(evidence.controlling.provisionText,representativeProvision.provisionText);
  metadata!.actTitle="Changed caller hint";
  assert.equal((await readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"current"}))!.actTitle,representativeProvision.actTitle);
  await assert.rejects(readR2NativeDiscoveryMetadata(dependencies,{...identity,languageTag:"uz-Latn"},{kind:"current"}));
  await assert.rejects(readR2NativeDiscoveryMetadata({...dependencies,currentAt:"2025-01-01T00:00:00.000Z"},identity,{kind:"current"}));
  await assert.rejects(readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"timestamp",instant:"2025-01-01T00:00:00.000Z"}));
  const foreign=fixture();foreign.bucket.objects.get("provision")!.bytes[0]=0;
  await assert.rejects(readR2NativeDiscoveryMetadata({...dependencies,bucket:foreign.bucket},identity,{kind:"current"}));
  bucket.objects.get("provision")!.bytes[0]=0;
  await assert.rejects(readR2NativeDiscoveryMetadata({...dependencies,readProvision:createR2NativeProvisionReader()},identity,{kind:"current"}));
});

test("a failed authenticated provision read can recover within the same request",async()=>{
  const {bucket,identity}=fixture(),object=bucket.objects.get("provision")!;
  const dependencies={bucket,currentAt:"2026-06-01T00:00:00.000Z",readProvision:createR2NativeProvisionReader()};
  bucket.objects.delete("provision");
  await assert.rejects(readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"current"}));
  bucket.objects.set("provision",object);
  assert.ok(await readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"current"}));
});

test("authenticated discovery starts one publisher observation without waiting for its result",async()=>{
  const {bucket,identity}=fixture();
  const controller=new AbortController(),urls:string[]=[];
  let finish!:()=>void;
  const pending=new Promise<void>(resolve=>{finish=resolve;});
  const read=createDiscoveryMetadataReader({signal:()=>controller.signal,
    observeCurrent:async url=>{urls.push(url);await pending;}});
  try {
    const dependencies={bucket,currentAt:"2026-06-01T00:00:00.000Z"};
    assert.deepEqual(await read(dependencies,identity,{kind:"current"}),
      await readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"current"}));
    await read(dependencies,identity,{kind:"current"});
    assert.deepEqual(urls,[identity.citation.url]);
  }finally{finish();}
});

test("publisher prefetch is bounded across distinct authenticated documents",async()=>{
  const urls:string[]=[],controller=new AbortController();
  const read=createDiscoveryMetadataReader({signal:()=>controller.signal,
    observeCurrent:async url=>{urls.push(url);throw Error("Publisher unavailable");}});
  for(let index=0;index<7;index++) {
    const url=`https://lex.uz/ru/docs/${100+index}`;
    const {bucket,identity}=fixture({sourceUrl:url});
    identity.citation.url=url;
    const metadata=await read({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"});
    assert.equal(metadata?.actTitle,representativeProvision.actTitle);
  }
  assert.deepEqual(urls,["https://lex.uz/ru/docs/100","https://lex.uz/ru/docs/101",
    "https://lex.uz/ru/docs/102","https://lex.uz/ru/docs/103"]);
});

test("unusable metadata, historical reads and absent or cancelled scopes never start publisher prefetch",async()=>{
  const controller=new AbortController();let calls=0;
  for(const state of ["foreign","corrupt","no-heading","historical","no-scope","cancelled"] as const) {
    const {bucket,identity}=fixture(state==="foreign"?{sourceUrl:"https://lex.uz/ru/docs/999"}
      :state==="no-heading"?{articleTitle:42}:{});
    if(state==="corrupt")bucket.objects.get("provision")!.bytes[0]=0;
    if(state==="cancelled")controller.abort();
    const read=createDiscoveryMetadataReader({signal:()=>state==="no-scope"?undefined:controller.signal,
      observeCurrent:async()=>{calls++;}});
    const operation=read({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,
      state==="historical"?{kind:"timestamp",instant:"2026-05-01T00:00:00.000Z"}:{kind:"current"});
    if(state==="foreign"||state==="corrupt")await assert.rejects(operation,/SOURCE_UNAVAILABILITY/);
    else await operation;
    assert.equal(calls,0,state);
  }
});

test("finishing or cancelling retrieval aborts unused publisher prefetch and releases its refresh lease",{timeout:5000},async()=>{
  const sqlite=new DatabaseSync(":memory:");
  const db={prepare(sql:string){return {bind(...values:(string|number)[]){return {
    async first(){indexedRetrievalSignal();return sqlite.prepare(sql).get(...values)??null;},
    async run(){indexedRetrievalSignal();return {meta:{changes:sqlite.prepare(sql).run(...values).changes}};},
  };}};}} as unknown as D1Database;
  try {
    for(const file of ["0032_public_source_observations","0033_publisher_status_observations"])
      sqlite.exec(readFileSync(`legal-drizzle/${file}.sql`,"utf8"));
    for(const file of ["0025-publisher-normalization-fingerprint","0026-publisher-fingerprint-observation-binding"])
      sqlite.exec(readFileSync(`postgres/${file}.sql`,"utf8").replace("legal.legal_publisher_status_observations","legal_publisher_status_observations"));
    sqlite.exec("ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy text; ALTER TABLE legal_publisher_status_observations ADD COLUMN normalization_policy_observed_at text;");
    for(const cancel of [false,true]) {
      const url=`https://lex.uz/ru/docs/${cancel?102:101}`;
      const {bucket,identity}=fixture({sourceUrl:url});identity.citation.url=url;
      const controller=new AbortController();let entered!:()=>void,aborted=false;
      const started=new Promise<void>(resolve=>{entered=resolve;});
      let pending:Promise<SourceObservation>|undefined;
      const observe=createSharedSourceObservationRefresh({db,readPublisher:async()=>{
        const signal=indexedRetrievalSignal()!;
        entered();
        return new Promise<SourceObservation>((_resolve,reject)=>signal.addEventListener("abort",()=>{
          aborted=true;reject(signal.reason);
        },{once:true}));
      }});
      const read=createDiscoveryMetadataReader({signal:indexedRetrievalSignal,observeCurrent:sourceUrl=>{
        pending=observe(sourceUrl);return pending;
      }});
      const retrieval=runIndexedRetrieval(controller.signal,async()=>{
        await read({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"});
        await started;
        if(cancel)controller.abort();
      });
      if(cancel)await assert.rejects(retrieval);else await retrieval;
      assert.ok(pending);await assert.rejects(pending);assert.equal(aborted,true);
      const observation:SourceObservation={version:2,officialUrl:url,observedAt:new Date().toISOString(),
        current:true,normalizedTextSha256:"a".repeat(64),rawContentSha256:"b".repeat(64)};
      assert.deepEqual(await createSharedSourceObservationRefresh({db,
        wait:async()=>assert.fail("A completed prefetch must not retain the refresh lease"),
        readPublisher:async()=>observation})(url),observation);
    }
  }finally{sqlite.close();}
});

test("discovery receives authenticated headings without legal text or an evidence approval",async()=>{
  const {bucket,identity}=fixture();
  assert.deepEqual(await readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"}),{
    actTitle:representativeProvision.actTitle,articleTitle:representativeProvision.articleTitle,
    languageTag:"ru",
  });
});

test("unusable optional headings do not change immutable legal evidence compatibility",async()=>{
  const {bucket,identity}=fixture({articleTitle:42});
  const dependencies={bucket,currentAt:"2026-06-01T00:00:00.000Z"};
  assert.equal(await readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"current"}),null);
  assert.equal((await resolveR2NativeCustomEvidence(dependencies,identity,{kind:"current"})).controlling.provisionText,representativeProvision.provisionText);
});

test("discovery rejects foreign identities, corrupt receipts and out-of-scope revisions",async()=>{
  for(const fields of [
    {sourceUrl:"https://lex.uz/ru/docs/999"}, {languageTag:"uz-Latn"},
    {provisionRenditionId:"rendition:foreign"}, {sourceNormalizedSha256:"c".repeat(64)},
  ]) {
    const {bucket,identity}=fixture(fields);
    await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"}),/SOURCE_UNAVAILABILITY/);
  }
  const {bucket,identity}=fixture();
  await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2025-06-01T00:00:00.000Z"},identity,{kind:"current"}));
  await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"timestamp",instant:"2025-06-01T00:00:00.000Z"}));
  bucket.objects.get("provision")!.bytes[0]=0;
  await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"}),/SOURCE_UNAVAILABILITY/);
});
