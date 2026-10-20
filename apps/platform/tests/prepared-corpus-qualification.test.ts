import assert from "node:assert/strict";
import test from "node:test";
import {preparedCorpusAcceptanceSchema,verifyPreparedCorpusQualification} from "../lib/storage/prepared-corpus-qualification";
import {preparedAcceptanceFixture as fixture} from "./helpers/prepared-corpus-acceptance";

test("prepared qualification authenticates complete paired measurements",async()=>{
  const f=fixture();await verifyPreparedCorpusQualification(f.manifest,f.read);
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
