import assert from "node:assert/strict";
import test from "node:test";
import {verifyNativeCorpusQualification} from "../lib/storage/native-corpus-acceptance";
import {programmaticAcceptanceFixture as fixture,type ProgrammaticFixtureProofs} from "./helpers/programmatic-corpus-acceptance";

test("programmatic qualification admits visible partial answers using total chat latency",async()=>{
  const valid=await fixture();await verifyNativeCorpusQualification(valid.manifest,valid.read);
});

test("programmatic qualification rejects failed, missing or falsely certified chat evidence",async()=>{
  const failures:Array<(proofs:ProgrammaticFixtureProofs)=>void>=[
    p=>{p.chat.results.pop();},
    p=>{p.chat.results[1].id=p.chat.results[0].id;},
    p=>{p.chat.results[0].outcome="unavailable";},
    p=>{p.chat.results[0].gapCount=0;},
    p=>{p.chat.results[0].findingCount=0;},
    p=>{p.chat.results[0].sourceCount=0;},
    p=>{p.chat.results[0].reloadPassed=false;},
    p=>{p.chat.results[0].sourceChecksPassed=false;},
    p=>{p.chat.results[0].verificationModelCalls=1;},
    p=>{p.chat.results[0].interpretationIndependentlyReviewed=true;},
    p=>{p.chat.results[0].complete=true;},
    p=>{p.chat.results[0].modelCalls[0].model="gpt-5.6-terra";},
    p=>{p.chat.results[0].modelCalls.pop();},
    p=>{p.chat.results[0].concurrency=1;},
    p=>{p.chat.results.forEach(r=>{r.locale="en";});},
    p=>{p.chat.results.forEach(r=>{r.actor="signed";});},
    p=>{p.chat.results.slice(0,20).forEach(r=>{r.milliseconds=15001;});},
    p=>{p.chat.results[0].milliseconds=31000;p.chat.results[1].milliseconds=31000;},
    p=>{p.native.requests[0].milliseconds=15001;},
    p=>{p.dense.results[0].recall=.94;},
    p=>{p.integrity.verifiedScopes=1;},
    p=>{p.verification.results.pop();},
  ];
  for(const change of failures){const invalid=await fixture(change);await assert.rejects(verifyNativeCorpusQualification(invalid.manifest,invalid.read));}
});

test("programmatic qualification retains exact revision and proof integrity fences",async()=>{
  const changed=await fixture();changed.manifest.productRevision="d".repeat(40);
  await assert.rejects(verifyNativeCorpusQualification(changed.manifest,changed.read),/PROOF_BINDING/);
  const corrupt=await fixture();
  await assert.rejects(verifyNativeCorpusQualification(corrupt.manifest,async()=>Buffer.from("corrupt")),/PROTOCOL_CORRUPT/);
  const missingCheck=await fixture(undefined,protocol=>{protocol.requiredChecks=protocol.requiredChecks.filter(id=>id!=="browser");});
  await assert.rejects(verifyNativeCorpusQualification(missingCheck.manifest,missingCheck.read),/NATIVE_CHAT_CHECK_MISSING/);
  const wrongVersion=await fixture(undefined,protocol=>{protocol.version="native-indexed-retrieval-v1";});
  await assert.rejects(verifyNativeCorpusQualification(wrongVersion.manifest,wrongVersion.read));
});

test("programmatic qualification pins the questions, dimensions and held-out partition",async()=>{
  const substituted=await fixture(p=>{
    p.chat.expectedCaseIds[0]="fast:easier-question";
    p.chat.results[0].id="fast:easier-question";
  },p=>{p.chatCaseIds[0]="fast:easier-question";});
  await assert.rejects(verifyNativeCorpusQualification(substituted.manifest,substituted.read),/WORKLOAD_CHANGED/);
  const replacedHash=await fixture(undefined,p=>{p.workloadSha256="0".repeat(64);});
  await assert.rejects(verifyNativeCorpusQualification(replacedHash.manifest,replacedHash.read),/WORKLOAD_CHANGED/);
  const changedInput=await fixture(p=>{p.chat.results[0].inputSha256="0".repeat(64);});
  await assert.rejects(verifyNativeCorpusQualification(changedInput.manifest,changedInput.read),/WORKLOAD_CHANGED/);
  const swappedLocales=await fixture(p=>{p.chat.results[0].locale="en";});
  await assert.rejects(verifyNativeCorpusQualification(swappedLocales.manifest,swappedLocales.read),/WORKLOAD_CHANGED/);
  const changedPartition=await fixture(p=>{p.chat.heldOutCaseIds.pop();},p=>{p.heldOutChatCaseIds.pop();});
  await assert.rejects(verifyNativeCorpusQualification(changedPartition.manifest,changedPartition.read),/WORKLOAD_CHANGED/);
});
