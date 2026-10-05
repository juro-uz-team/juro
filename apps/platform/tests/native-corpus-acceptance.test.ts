import assert from "node:assert/strict";
import test from "node:test";
import {verifyNativeCorpusQualification,readSelectedNativeCorpus} from "../lib/storage/native-corpus-acceptance";
import {createHash} from "node:crypto";
import type {Pool} from "pg";

import {nativeAcceptanceFixture as fixture} from "./helpers/native-corpus-acceptance";

test("operator compatibility retains measured revision and rejects changed selection or candidate",async()=>{
 const {manifest}=fixture();const bytes=Buffer.from(JSON.stringify(manifest));
 const sha256=createHash("sha256").update(bytes).digest("hex");
 let rows=[{sha256,manifest_bytes:bytes}];
 const pool={query:async()=>({rows})} as unknown as Pool;
 const candidate="e".repeat(40);
 const approval={version:1 as const,environment:"production" as const,revision:candidate,acceptedRevision:manifest.productRevision,acceptanceSha256:sha256,reviewSha256:"f".repeat(64)};
 await assert.rejects(readSelectedNativeCorpus(pool,candidate),/PRODUCT_CHANGED/);
 assert.equal((await readSelectedNativeCorpus(pool,candidate,approval))?.productRevision,manifest.productRevision);
 for(const changed of [{...approval,revision:"d".repeat(40)},{...approval,acceptedRevision:candidate},{...approval,acceptanceSha256:"f".repeat(64)}])await assert.rejects(readSelectedNativeCorpus(pool,candidate,changed),/COMPATIBILITY_CHANGED/);
 rows=[];await assert.rejects(readSelectedNativeCorpus(pool,candidate,approval),/COMPATIBILITY_CHANGED/);
});


test("native qualification requires every declared query, cold attempt, complete outcome and check",async()=>{
  const valid=fixture();await verifyNativeCorpusQualification(valid.manifest,valid.read);
  const failures:Array<(p:Record<string,any>)=>void>=[
    p=>{p.dense.results[1].recall=.94;},
    p=>{p.dense.results.pop();},
    p=>{p.dense.heldOutQueryIds=["unmeasured"];},
    p=>{p.native.requests[0].outcome="timeout";},
    p=>{p.native.requests[1].milliseconds=10001;},
    p=>{p.native.requests=p.native.requests.filter((r:any)=>r.phase!=="expired_observation");},
    p=>{p.native.requests[2].concurrency=4;},
    p=>{p.native.requests.pop();},
    p=>{p.native.requests[3].id=p.native.requests[2].id;},
    p=>{p.native.requests[3].id="substituted";},
    p=>{for(const r of p.native.requests)if(r.phase==="warm")r.milliseconds=5001;},
    p=>{p.semantic.results[0].completed=false;},
    p=>{p.semantic.results[0].unresolvedNeeds=1;},
    p=>{p.semantic.results[0].sourceUnavailable=true;},
    p=>{p.integrity.verifiedScopes=1;},
    p=>{p.verification.results.pop();},
  ];
  for(const change of failures){const bad=fixture(change);await assert.rejects(verifyNativeCorpusQualification(bad.manifest,bad.read));}
});

test("native proofs reject corruption and different source or implementation bindings",async()=>{
  const valid=fixture();
  await assert.rejects(verifyNativeCorpusQualification(valid.manifest,async()=>Buffer.from("corrupt")),/PROTOCOL_CORRUPT/);
  valid.manifest.history.vector.sourceRevision="2";
  await assert.rejects(verifyNativeCorpusQualification(valid.manifest,valid.read),/PROOF_BINDING/);
  const other=fixture();other.manifest.productRevision="d".repeat(40);
  await assert.rejects(verifyNativeCorpusQualification(other.manifest,other.read),/PROOF_BINDING/);
});
