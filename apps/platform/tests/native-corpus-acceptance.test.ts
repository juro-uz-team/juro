import assert from "node:assert/strict";
import test from "node:test";
import {verifyNativeCorpusQualification} from "../lib/storage/native-corpus-acceptance";

import {nativeAcceptanceFixture as fixture} from "./helpers/native-corpus-acceptance";


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
