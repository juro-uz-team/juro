import {createHash} from "node:crypto";
import {preparedCorpusAcceptanceSchema,preparedCorpusBinding} from "../../lib/storage/prepared-corpus-qualification";
import {nativeChatWorkload,nativeChatWorkloadSha256} from "../../lib/storage/native-chat-workload";

const digest=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
const checks=["tests","typecheck","build","browser","model_only_modes","no_model_verification","citation_integrity",
  "tenant_isolation","saved_replay","historical_questions","comparison_questions","private_context","retired_citations",
  "complementary_provisions","classification_provenance","category_ranking","original_coordinates","worker_generation",
  "private_data_preserved","historical_applicability"];
export function preparedAcceptanceFixture(){
  const blobs=new Map<string,Uint8Array>();
  const put=(key:string,value:unknown)=>{
    const bytes=Buffer.from(JSON.stringify(value));blobs.set(key,bytes);
    return {bucket:"qualification",key,sha256:digest(bytes),sizeBytes:bytes.length};
  };
  const artifacts={packageSha256:"a".repeat(64),vectorCompletionSha256:"b".repeat(64),
    vectorIdentitySha256:"c".repeat(64),membershipSha256:"d".repeat(64),workIndexSha256:"e".repeat(64),
    navigationSha256:"f".repeat(64),sparseSha256:"1".repeat(64)};
  const storeBytes=Buffer.from(JSON.stringify({packageSha256:artifacts.packageSha256}));
  const selected=(capability:"current"|"history")=>{
    const release={id:`prepared-${capability}`,environment:"production",capability,
      instances:[{id:`instance-${capability}`,shardId:"prepared-shard"}],
      configuration:{backend:"prepared-corpus-v1",navigationBackend:"pgvector",identity:"prepared-configuration",
        embeddingModel:"openai/text-embedding-3-large",dimensions:3072,artifacts,evidenceSemantics:"discovery-only",
        categoryRanking:{mode:"disabled"},gatewayIdentity:"gateway",providerProjectIdentity:"project",
        gatewayPayloadLogging:false,gatewayCaching:false,similarityCaching:false}};
    return {release,worker:put(`worker-${capability}`,{format:"prepared-numeric-worker-v1",release,
      paths:Object.fromEntries(["package","vectors","identities","works","memberships","profiles","sparse","navigation"]
        .map(key=>[key,`/fixture/${key}`])),profilesSha256:"7".repeat(64),analyzerSha256:"8".repeat(64),probes:64,candidates:5000}),
      evidenceStore:{namespace:`legal-prepared-${"a".repeat(64)}`,generationSha256:digest(storeBytes)}};
  };
  const protocol={version:"prepared-pgvector-qualification-v1",tuningQueryIds:["tuning"],heldOutQueryIds:["held-out"],
    firstTouchIds:["cold"],warmIds:Array.from({length:30},(_,i)=>`warm-${i}`),
    chatCaseIds:nativeChatWorkload.map(row=>row.id),heldOutChatCaseIds:nativeChatWorkload.filter(row=>row.heldOut).map(row=>row.id),
    workloadSha256:nativeChatWorkloadSha256,evidenceCaseIds:["current","history","comparison"],requiredChecks:checks};
  const placeholder=put("placeholder",{});
  const manifest=preparedCorpusAcceptanceSchema.parse({version:"prepared-pgvector-v1",environment:"production",
    productRevision:"a".repeat(40),current:selected("current"),history:selected("history"),
    historicalEvidence:{...put("historical",{format:"prepared-historical-evidence-v1",packageSha256:artifacts.packageSha256,
      facts:[{sourceRevisionId:`prepared-normalized-${"9".repeat(64)}`,sourceSha256:"9".repeat(64),
        officialUrl:"https://lex.uz/docs/123",languageTag:"uz-Latn",completeTextSha256:"a".repeat(64),articleNumber:"7",
        editorial:{from:"2020-01-01T00:00:00Z",to:null},applicability:{from:"2020-01-01T00:00:00Z",to:null},
        editorialEvidence:{revisionId:`prepared-normalized-${"9".repeat(64)}`,sha256:"9".repeat(64),
          officialUrl:"https://lex.uz/docs/123",quote:"Fixture editorial evidence"},
        applicabilityEvidence:{revisionId:`prepared-normalized-${"9".repeat(64)}`,sha256:"9".repeat(64),
          officialUrl:"https://lex.uz/docs/123",quote:"Fixture applicability evidence",kind:"commencement_clause"}}]}),
      bucket:`legal-prepared-${"a".repeat(64)}`},protocol:put("protocol",protocol),
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
  return {manifest,protocol,proofValues,storage,publish,put,blobs,storeBytes,
    read:async(reference:{key:string})=>blobs.get(reference.key)!};
}

