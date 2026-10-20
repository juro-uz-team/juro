import assert from "node:assert/strict";
import test from "node:test";
import {preparedCorpusAcceptanceSchema,preparedCorpusBinding,verifyPreparedCorpusQualification} from "../lib/storage/prepared-corpus-qualification";
import {preparedAcceptanceFixture as fixture} from "./helpers/prepared-corpus-acceptance";

test("prepared qualification authenticates complete paired measurements",async()=>{
  const f=fixture();await verifyPreparedCorpusQualification(f.manifest,f.read);
});

test("prepared qualification permits measured latency only under a bound explicit policy",async()=>{
  const f=fixture("measured");
  for(const row of f.proofValues.retrieval.results)row.milliseconds=120000;
  for(const row of f.proofValues.chat.results)row.milliseconds=240000;
  f.publish();
  await verifyPreparedCorpusQualification(f.manifest,f.read);
  f.proofValues.retrieval.results[0]!.dense="partial";
  f.publish();
  await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read));
});

test("measured latency policy preserves recall and requires finite measurements",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.proofValues.dense.results[1]!.recallAt50=.94;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.retrieval.results[0]!.milliseconds=Infinity;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.chat.results[0]!.reloadPassed=false;},
  ]){const f=fixture("measured");mutate(f);f.publish();await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read));}
});

test("prepared qualification rejects corruption and proofs rebound to another release",async()=>{
  const f=fixture();f.blobs.set("storage",Buffer.from("{}"));
  await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read),/ARTIFACT_CORRUPT/);
  const changed=fixture();changed.manifest.productRevision="b".repeat(40);
  await assert.rejects(verifyPreparedCorpusQualification(changed.manifest,changed.read),/BINDING/);
});

test("prepared qualification requires actual corpus counts, pins and preservation receipts",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.storage.vectorRows++;},
    (f:ReturnType<typeof fixture>)=>{f.storage.navigationSha256="0".repeat(64);},
    (f:ReturnType<typeof fixture>)=>{f.storage.freeBytesAfterBuild--;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.checks.results=f.proofValues.checks.results.filter(row=>row.id!=="private_data_preserved");},
  ]){const f=fixture();mutate(f);f.publish();await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read));}
});

test("prepared qualification rejects weak recall, missing held-out queries and slow or incomplete retrieval",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.proofValues.dense.results[1]!.recallAt50=.94;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.dense.results[1]!.heldOut=false;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.retrieval.results[0]!.milliseconds=10001;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.retrieval.results[1]!.concurrency=1;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.retrieval.results.pop();},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.retrieval.results[1]!.sparse="partial";},
  ]){const f=fixture();mutate(f);f.publish();await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read));}
});

test("prepared qualification rejects unbound historical evidence and incomplete chat delivery",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof fixture>)=>{f.proofValues.evidence.historicalManifestSha256="0".repeat(64);},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.evidence.results[1]!.capability="current";},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.evidence.results[2]!.complementaryProvisionsVerified=false;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.chat.results[0]!.reloadPassed=false;},
    (f:ReturnType<typeof fixture>)=>{f.proofValues.chat.results[1]=f.proofValues.chat.results[0]!;},
  ]){const f=fixture();mutate(f);f.publish();await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read));}
});

test("prepared qualification rejects tuning/held-out overlap before reading proofs",async()=>{
  const f=fixture();f.protocol.heldOutQueryIds=["tuning"];f.manifest.protocol=f.put("protocol",f.protocol);
  await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read),/PROTOCOL/);
});

test("prepared admission cannot enable category ranking with a generic passed check",()=>{
  const f=fixture();
  f.manifest.current.release.configuration.categoryRanking={mode:"qualified",
    policySha256:"5".repeat(64),qualificationSha256:"6".repeat(64)};
  assert.throws(()=>preparedCorpusAcceptanceSchema.parse(f.manifest));
});

function providerFreeFixture(){
  const f=fixture("measured");
  const cases=["fast","deep"].flatMap(mode=>["current","history","comparison"].map((capability,index)=>({
    id:`${mode}-${capability}`,inputSha256:"7".repeat(64),mode,capability,
    locale:["en","ru","uz"][index],actor:index===0?"guest":"signed",
  })));
  const workload=f.put("provider-free-workload",{format:"prepared-provider-free-chat-workload-v1",cases});
  const protocol={...f.protocol,providerFreeChatWorkload:workload,workloadSha256:workload.sha256,
    chatCaseIds:cases.map(row=>row.id),heldOutChatCaseIds:[cases[0]!.id]};
  f.manifest.protocol=f.put("protocol",protocol);
  const bindingSha256=preparedCorpusBinding(f.manifest);
  f.storage.bindingSha256=bindingSha256;
  for(const proof of Object.values(f.proofValues))proof.bindingSha256=bindingSha256;
  const chat={bindingSha256,format:"prepared-provider-free-chat-proof-v1",workloadSha256:workload.sha256,
    providerNetworkCalls:0,liveModelQualityVerified:false,
    results:cases.map(row=>({...row,milliseconds:120000,model:row.mode==="fast"?"gpt-5.6-terra":"gpt-6-luna",
      providerFixture:{kind:"synthetic",artifact:f.put(`fixture-${row.id}`,{synthetic:true})},
      retrievalBackend:"pgvector",retrievalComplete:true,sourceCount:1,sourceChecksPassed:true,reloadPassed:true,tenantIsolationPassed:true,
      transcript:f.put(`transcript-${row.id}`,{syntheticUnitTest:true})})),
  };
  const publish=()=>{f.publish();f.manifest.proofs.chat=f.put("provider-free-chat",chat);};
  publish();
  return {...f,chat,publish};
}

test("provider-free admission is explicit and authenticates separate fixture and transcript artifacts",async()=>{
  const f=providerFreeFixture();await verifyPreparedCorpusQualification(f.manifest,f.read);
  f.blobs.set(f.chat.results[0]!.transcript.key,Buffer.from("{}"));
  await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read),/ARTIFACT_CORRUPT/);
});

test("provider-free admission cannot claim live quality or waive integration coverage",async()=>{
  for(const mutate of [
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.liveModelQualityVerified=true;},
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.providerNetworkCalls=1;},
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.results[0]!.model="gpt-6-luna";},
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.results[0]!.retrievalComplete=false;},
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.results[0]!.sourceCount=0;},
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.results[0]!.reloadPassed=false;},
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.results[0]!.tenantIsolationPassed=false;},
    (f:ReturnType<typeof providerFreeFixture>)=>{f.chat.results.pop();},
  ]){const f=providerFreeFixture();mutate(f);f.publish();await assert.rejects(verifyPreparedCorpusQualification(f.manifest,f.read));}
});
