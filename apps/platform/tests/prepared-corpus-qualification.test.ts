import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {preparedCorpusAcceptanceSchema,preparedCorpusBinding,verifyPreparedCorpusQualification}
  from "../lib/storage/prepared-corpus-qualification";
import {nativeChatWorkload,nativeChatWorkloadSha256} from "../lib/storage/native-chat-workload";

const digest=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
const checks=["tests","typecheck","build","browser","model_only_modes","no_model_verification","citation_integrity",
  "tenant_isolation","saved_replay","historical_questions","comparison_questions","private_context","retired_citations",
  "complementary_provisions","classification_provenance","category_ranking","original_coordinates","worker_generation",
  "private_data_preserved","historical_applicability"];
function fixture(){
  const blobs=new Map<string,Uint8Array>();
  const put=(key:string,value:unknown)=>{
    const bytes=Buffer.from(JSON.stringify(value));blobs.set(key,bytes);
    return {bucket:"qualification",key,sha256:digest(bytes),sizeBytes:bytes.length};
  };
  const artifacts={packageSha256:"a".repeat(64),vectorCompletionSha256:"b".repeat(64),
    vectorIdentitySha256:"c".repeat(64),membershipSha256:"d".repeat(64),workIndexSha256:"e".repeat(64),
    navigationSha256:"f".repeat(64),sparseSha256:"1".repeat(64)};
  const selected=(capability:"current"|"history")=>({
    release:{id:`prepared-${capability}`,environment:"production",capability,
      instances:[{id:`instance-${capability}`,shardId:"prepared-shard"}],
      configuration:{backend:"prepared-corpus-v1",navigationBackend:"pgvector",identity:"prepared-configuration",
        embeddingModel:"openai/text-embedding-3-large",dimensions:3072,artifacts,evidenceSemantics:"discovery-only",
        categoryRanking:{mode:"disabled"},gatewayIdentity:"gateway",providerProjectIdentity:"project",
        gatewayPayloadLogging:false,gatewayCaching:false,similarityCaching:false}},
    worker:put(`worker-${capability}`,{}),evidenceStore:{namespace:`legal-prepared-${"a".repeat(64)}`,generationSha256:"a".repeat(64)},
  });
  const protocol={version:"prepared-pgvector-qualification-v1",tuningQueryIds:["tuning"],heldOutQueryIds:["held-out"],
    firstTouchIds:["cold"],warmIds:Array.from({length:30},(_,i)=>`warm-${i}`),
    chatCaseIds:nativeChatWorkload.map(row=>row.id),heldOutChatCaseIds:nativeChatWorkload.filter(row=>row.heldOut).map(row=>row.id),
    workloadSha256:nativeChatWorkloadSha256,evidenceCaseIds:["current","history","comparison"],requiredChecks:checks};
  const placeholder=put("placeholder",{});
  const manifest=preparedCorpusAcceptanceSchema.parse({version:"prepared-pgvector-v1",environment:"production",
    productRevision:"a".repeat(40),current:selected("current"),history:selected("history"),
    historicalEvidence:{...put("historical",{}),bucket:`legal-prepared-${"a".repeat(64)}`},protocol:put("protocol",protocol),
    population:{vectors:100,memberships:200,shards:2},
    proofs:{storage:placeholder,dense:placeholder,retrieval:placeholder,chat:placeholder,evidence:placeholder,checks:placeholder}});
  const bindingSha256=preparedCorpusBinding(manifest);
  const proofValues={
    storage:{bindingSha256,...artifacts,completionSha256:artifacts.vectorCompletionSha256,vectorRows:100,membershipRows:200,
      verifiedShards:2,originalCoordinatesAuthenticated:true,roundTripVerified:true,sealedReadRoleVerified:true,
      importReceiptSha256:"2".repeat(64),peakBytes:1000,freeBytesAfterBuild:60*1024**3},
    dense:{bindingSha256,goldSha256:"3".repeat(64),completionSha256:artifacts.vectorCompletionSha256,
      results:[{id:"tuning",heldOut:false,recallAt50:1},{id:"held-out",heldOut:true,recallAt50:.96}]},
    retrieval:{bindingSha256,results:[{id:"cold",phase:"first_touch",concurrency:1},
      ...protocol.warmIds.map(id=>({id,phase:"warm",concurrency:5}))].map(row=>({...row,milliseconds:100,
        dense:"complete",sparse:"complete",originalRerank:true}))},
    chat:{bindingSha256,expectedCaseIds:protocol.chatCaseIds,heldOutCaseIds:protocol.heldOutChatCaseIds,
      results:nativeChatWorkload.map(row=>({id:row.id,inputSha256:row.inputSha256,mode:row.mode,locale:row.locale,
        actor:row.actor,concurrency:5,milliseconds:100,outcome:"answered",gapCount:0,findingCount:1,sourceCount:1,
        validationMethod:"programmatic",interpretationIndependentlyReviewed:false,sourceChecksPassed:true,reloadPassed:true,
        verificationModelCalls:0,modelCalls:["interpreting","writing"].map(stage=>({stage,
          model:row.mode==="fast"?"gpt-5.6-terra":"gpt-6-luna"}))}))},
    evidence:{bindingSha256,historicalManifestSha256:manifest.historicalEvidence.sha256,
      results:protocol.evidenceCaseIds.map(capability=>({id:capability,capability,passed:true,completeRules:true,
        applicabilityVerified:true,complementaryProvisionsVerified:true,citationReloadVerified:true}))},
    checks:{bindingSha256,results:checks.map(id=>({id,passed:true,evidenceSha256:"4".repeat(64)}))},
  };
  // The storage proof uses the completion field, not the configuration's field name.
  const {vectorCompletionSha256:_,...storage}=proofValues.storage;
  function publish(){
    manifest.proofs.storage=put("storage",storage);
    for(const key of ["dense","retrieval","chat","evidence","checks"] as const)manifest.proofs[key]=put(key,proofValues[key]);
  }
  publish();
  return {manifest,protocol,proofValues,storage,publish,put,blobs,
    read:async(reference:{key:string})=>blobs.get(reference.key)!};
}

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
