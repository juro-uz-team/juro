import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "pg";
import {createHash} from "node:crypto";
import {activatePreparedCorpus,readPreparedAdmissionArtifacts} from "../lib/storage/prepared-corpus-acceptance";
import {readSelectedCorpus,readSelectedNativeCorpus} from "../lib/storage/native-corpus-acceptance";
import {preparedAcceptanceFixture} from "./helpers/prepared-corpus-acceptance";
import {createNativeCorpusService} from "../lib/runtime/native-corpus";
import {LocalObjectStore} from "../lib/storage/objects";
import type {PostgresDatabase} from "../lib/storage/postgres";

test("prepared admission authenticates worker release and historical publication before transactions",async()=>{
  const f=preparedAcceptanceFixture();
  await readPreparedAdmissionArtifacts(f.manifest,f.read);
  const worker=JSON.parse(Buffer.from(f.blobs.get("worker-current")!).toString());
  worker.release.id="another-release";f.manifest.current.worker=f.put("worker-current",worker);
  await assert.rejects(readPreparedAdmissionArtifacts(f.manifest,f.read),/WORKER_MISMATCH/);
  // Any changed acceptance invalidates the measured binding before mutation.
  const pool={connect:async()=>{assert.fail("must not connect before admission");}} as unknown as Pool;
  await assert.rejects(activatePreparedCorpus({...f,pool,productRevision:f.manifest.productRevision}),/BINDING/);
  const corrupt=preparedAcceptanceFixture();corrupt.blobs.set("historical",Buffer.from("{}"));
  await assert.rejects(readPreparedAdmissionArtifacts(corrupt.manifest,corrupt.read),/ARTIFACT_CORRUPT/);
});

test("prepared selection is read as a pair and legacy-only readers fail closed",async()=>{
  const f=preparedAcceptanceFixture(),bytes=Buffer.from(JSON.stringify(f.manifest));
  const sha256=createHash("sha256").update(bytes).digest("hex");
  const pool={query:async()=>({rows:[{sha256,manifest_bytes:bytes,prepared_acceptance_sha256:sha256}]})} as unknown as Pool;
  assert.deepEqual(await readSelectedCorpus(pool,f.manifest.productRevision),f.manifest);
  await assert.rejects(readSelectedNativeCorpus(pool,f.manifest.productRevision),/RUNTIME_REQUIRED/);
  await assert.rejects(readSelectedCorpus(pool,"f".repeat(40)),/PRODUCT_CHANGED/);
});

test("native dispatch retries failed prepared initialization and never falls back to retired runtime",async t=>{
  const f=preparedAcceptanceFixture(),bytes=Buffer.from(JSON.stringify(f.manifest));
  const sha256=createHash("sha256").update(bytes).digest("hex");
  const pool={query:async()=>({rows:[{sha256,manifest_bytes:bytes,prepared_acceptance_sha256:sha256}]})} as unknown as Pool;
  let failed=false,reads=0;
  t.mock.method(LocalObjectStore.prototype,"get",async(key:string)=>{
    reads++;if(!failed){failed=true;throw Error("temporary object failure");}
    const value=f.blobs.get(key)!;return {size:value.length,bytes:async()=>value};
  });
  const endpoint=(capability:"current"|"history")=>({url:"http://127.0.0.1:43210",token:"t".repeat(32),
    workerSha256:f.manifest[capability].worker.sha256});
  const service=createNativeCorpusService({pool,catalog:{} as PostgresDatabase,objectRoot:"unused",
    apiKey:"unused",candidateUrl:"",environment:"production",productRevision:f.manifest.productRevision,
    preparedTransport:{current:endpoint("current"),history:endpoint("history")},
    fallback:{fetch:async()=>{assert.fail("legacy fetch");},openLegalResearch:async()=>{assert.fail("legacy research");}}});
  const scope={requestId:"prepared-native",environment:"production" as const,temporalScope:{kind:"current" as const}};
  await assert.rejects(service.openLegalResearch(scope),/temporary object failure/);
  const session=await service.openLegalResearch(scope);
  const completedReads=reads;
  assert.ok(completedReads>1);
  await service.openLegalResearch({...scope,requestId:"next-request"});
  assert.equal(reads,completedReads);
  await session.cancel();
  const response=await service.fetch("https://internal/ready");
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,"PREPARED_CORPUS_SESSION_REQUIRED");
});
