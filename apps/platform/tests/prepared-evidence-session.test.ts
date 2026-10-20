import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createPreparedDiscoveryCatalog} from "../lib/legal-corpus/prepared-discovery-catalog";
import {createPreparedEvidenceSession} from "../lib/legal-corpus/prepared-evidence-session";
import {bindPreparedEvidenceCandidate} from "../lib/legal-corpus/prepared-evidence-candidate";
import {candidateSchema} from "../lib/legal-corpus/legal-candidate-index";
import {parseCandidatePacket,parsePinnedCandidateRelease} from "../lib/legal-corpus/legal-candidate-index";
import {createPreparedResearchRuntime} from "../lib/legal-corpus/prepared-research-runtime";
import {prepareCorpusEvidence} from "../lib/legal-chat/corpus-evidence";
import {createPreparedCorpusResearchRuntime,createPreparedNativeResearchRuntime} from "../lib/runtime/prepared-corpus";
import {preparedCandidateConfigurationSchema} from "../lib/legal-corpus/prepared-candidate-configuration";
import {classifyLegalSourceUrl,type FetchedLegalSource} from "../lib/legal/source-fetch";

const hash=(text:string|Uint8Array)=>createHash("sha256").update(text).digest("hex");
const configuration=preparedCandidateConfigurationSchema.parse({backend:"prepared-corpus-v1",navigationBackend:"pgvector",identity:"prepared-configuration",
  embeddingModel:"openai/text-embedding-3-large",dimensions:3072,
  artifacts:{packageSha256:"a".repeat(64),vectorCompletionSha256:"b".repeat(64),vectorIdentitySha256:"1".repeat(64),
    membershipSha256:"c".repeat(64),workIndexSha256:"d".repeat(64),navigationSha256:"e".repeat(64),sparseSha256:"f".repeat(64)},
  evidenceSemantics:"discovery-only",categoryRanking:{mode:"disabled"},gatewayIdentity:"gateway",providerProjectIdentity:"project",
  gatewayPayloadLogging:false,gatewayCaching:false,similarityCaching:false});
const text="The applicant must identify the requested record.";
async function fixture(url="https://lex.uz/ru/docs/777"){
  const raw={package_sha256:"a".repeat(64),vector_completion_sha256:"b".repeat(64),membership_sha256:"c".repeat(64),work_index_sha256:"d".repeat(64),
    records:[{vector_ordinal:3,membership_ordinal:7,compact_input_hash:"1".repeat(64),original_input_hash:"2".repeat(64),work:"work:1",unit:"work:1:12",status:"discovery_only",
      chunk:{id:`retrieval-chunk-v1:${"3".repeat(64)}`,work:"work:1",snapshotProvisionId:"work:1:12",officialText:text,officialTextSha256:hash(text),language:"en",script:"Latn"}}],
    sources:{"work:1":{inventory:{id:"work:1",url},prepared:{work:"work:1",assignments:[{scope:"document",inherited:true}]}}},
    units:{"work:1:12":{ordinal:12,text}},continuations:{}};
  const packet=await createPreparedDiscoveryCatalog({async readExact(){return raw;}}).read(configuration,[[3,7]]);
  const objects=new Map<string,Uint8Array>();let calls=0;
  const input={configuration,store:{namespace:"legal-prepared-"+"a".repeat(64),generationSha256:"b".repeat(64)},options:{},
    bucket:{async get(key:string){const bytes=objects.get(key);return bytes?{key,size:bytes.length,bytes:async()=>bytes}:null;},
      async put(key:string,bytes:Uint8Array){objects.set(key,new Uint8Array(bytes));}},
    async fetch(url:string):Promise<FetchedLegalSource>{calls++;assert.equal(url,"https://lex.uz/en/docs/777");
      const bytes=new TextEncoder().encode(`<html><header id="doc_header">Действующий акт</header><main><h1>Official records law</h1><p>Article 7. Records</p><p>${text}</p><p>Review follows Article 8 of this Law. The authority must provide the requested complete record unless it contains protected personal information about another individual.</p><p>Article 8. Review</p><p>The applicant may request independent review of a refusal and submit supporting evidence in the review proceedings.</p></main></html>`);
      return {...classifyLegalSourceUrl(url),bytes,contentSha256:hash(bytes),contentType:"text/html",etag:null,lastModified:null,
        fetchedAt:new Date().toISOString(),robotsUrl:"https://lex.uz/robots.txt"};}};
  return {packet,input,calls:()=>calls};
}

test("session reuses one durable capture and preserves discovery provenance and reference budget",async()=>{
  const f=await fixture();const session=createPreparedEvidenceSession(f.input);
  const [left,right]=await Promise.all([session.resolve(f.packet,[3,7]),session.resolve(f.packet,[3,7])]);
  assert.equal(f.calls(),1);assert.equal(left.capture,right.capture);
  assert.equal(left.discovery.originalUrl,"https://lex.uz/ru/docs/777");
  assert.equal(left.source.resolution.controlling.officialCitation.url,"https://lex.uz/en/docs/777");
  assert.deepEqual(left.discovery.publisherMetadata,f.packet.sources["work:1"]!.prepared);
  assert.match(left.source.resolution.articleContext!.provisionText,/unless/);
  assert.deepEqual((await left.references(0)).unresolved,[{article:"8",reason:"lookup_budget"}]);
  assert.equal((await left.references(1)).resolved[0]!.article,"8");
  assert.equal((await left.references(1,["8"])).resolved[0]!.article,"8");
  await assert.rejects(left.references(1,["9"]),/REFERENCE_SELECTION_INVALID/);
  await assert.rejects(left.references(1,["8","8"]),/REFERENCE_SELECTION_INVALID/);
  const candidate=candidateSchema.parse({itemKey:"search-releases/prepared-release/prepared/3/7",instanceId:"prepared-instance",shardId:"prepared-shard",
    formulationIds:["formulation"],readingIds:["reading"],retrievalRequirementIds:["requirement"],
    vectorRank:1,vectorScore:.9,keywordRank:1,keywordScore:2,fusionScore:.03});
  const bound=bindPreparedEvidenceCandidate(candidate,left);
  assert.equal(bound.candidate.textRevisionId,left.capture.revisionId);
  assert.equal(bound.candidate.provisionRenditionId,left.source.resolution.controlling.provisionRenditionId);
  assert.equal(bound.candidate.textualAuthority,"unknown");
  assert.deepEqual(bound.candidate.candidate,candidate);
  assert.match(bound.provisionText,/unless/);
  assert.throws(()=>bindPreparedEvidenceCandidate({...candidate,itemKey:"search-releases/prepared-release/prepared/3/8"},left),/CANDIDATE_MISMATCH/);
});

test("prepared research joins discovery to captured evidence and resolves complementary provisions in that capture",async()=>{
  const f=await fixture();
  const release=parsePinnedCandidateRelease({id:"prepared-release",environment:"production",capability:"current",configuration,
    instances:[{id:"prepared-instance",shardId:"prepared-shard"}]});
  const runtime=createPreparedResearchRuntime({release,session:createPreparedEvidenceSession(f.input),
    catalog:createPreparedDiscoveryCatalog({async readExact(){return f.packet;}})});
  const endpoint={kind:"current"} as const;const currentAt=new Date().toISOString();
  const packet=parseCandidatePacket({availability:"available",releaseId:release.id,endpoint,
    requiredInstanceIds:["prepared-instance"],partialErrors:[],candidates:[{
      itemKey:"search-releases/prepared-release/prepared/3/7",instanceId:"prepared-instance",shardId:"prepared-shard",
      formulationIds:["formulation"],readingIds:["reading"],retrievalRequirementIds:["requirement"],
      vectorRank:1,vectorScore:.9,keywordRank:1,keywordScore:2,fusionScore:.03}]});
  const discoveries=await runtime.candidateCatalog.revalidate(packet,endpoint,release,currentAt);
  assert.equal(f.calls(),0);assert.equal(discoveries[0]!.kind,"prepared-discovery");
  assert.equal("textRevisionId" in discoveries[0]!,false);
  const bound=await runtime.evidenceResolver.resolveDiscovery(discoveries[0]!.discoveryId,endpoint,{release,currentAt});
  assert.equal(f.calls(),1);assert.equal(bound.candidate.textRevisionId,bound.resolution.controlling.textRevisionId);
  const selected={candidate:bound.candidate,citationLabel:bound.resolution.materialCitation.label,
    provisionText:bound.resolution.articleContext!.provisionText};
  const references=await runtime.referenceDiscovery([selected],endpoint,release,currentAt);
  assert.deepEqual(references.unresolved,[]);assert.equal(references.candidates.length,1);
  const reference=references.candidates[0]!;
  assert.deepEqual(reference.candidate.referenceOrigin,{itemKey:packet.candidates[0]!.itemKey,article:"8"});
  assert.equal(reference.textRevisionId,bound.candidate.textRevisionId);
  const target=await runtime.evidenceResolver.resolveControlling(reference.provisionRenditionId,endpoint,{release,currentAt});
  assert.match(target.articleContext!.provisionText,/independent review/);assert.equal(f.calls(),1);
  const currentSourceStatus=await runtime.verifyCurrentSource(target.controlling);
  const prepared=await prepareCorpusEvidence({resolution:target,endpoint});
  const admitted=prepared.finalize({currentAt:new Date().toISOString(),currentSourceStatus});
  assert.equal(admitted.source.status,"current");
  assert.equal(admitted.source.citationEvidenceReceipt!.version,2);
  assert.deepEqual(admitted.source.citationEvidenceReceipt!.store,f.input.store);
  assert.throws(()=>prepared.finalize({currentAt:new Date(Date.now()+6*60_000).toISOString(),currentSourceStatus}),/CURRENT_SOURCE_UNCONFIRMED/);
  await assert.rejects(runtime.verifyCurrentSource({...target.controlling,evidence:{...target.controlling.evidence,
    store:{...f.input.store,generationSha256:"0".repeat(64)}}}),/GENERATION_MISMATCH/);
  const targetSelected={candidate:reference,citationLabel:target.materialCitation.label,provisionText:target.articleContext!.provisionText};
  assert.deepEqual(await runtime.referenceDiscovery([selected,targetSelected],endpoint,release,currentAt),{candidates:[],unresolved:[]});
  // The target's references must use the target provision, not its origin's closure.
  assert.deepEqual(await runtime.referenceDiscovery([targetSelected],endpoint,release,currentAt),{candidates:[],unresolved:[]});
  const ambiguous=createPreparedResearchRuntime({release,catalog:createPreparedDiscoveryCatalog({async readExact(){return f.packet;}}),
    session:{...createPreparedEvidenceSession(f.input),references:async()=>({resolved:[],unresolved:[{article:"8",reason:"reference_ambiguous"}]})}});
  const ambiguousDiscoveries=await ambiguous.candidateCatalog.revalidate(packet,endpoint,release,currentAt);
  await ambiguous.evidenceResolver.resolveDiscovery(ambiguousDiscoveries[0]!.discoveryId,endpoint,{release,currentAt});
  assert.equal((await ambiguous.referenceDiscovery([selected],endpoint,release,currentAt)).unresolved[0]!.reason,"reference_ambiguous");
  await assert.rejects(runtime.evidenceResolver.resolveControlling(reference.provisionRenditionId,endpoint,
    {release:parsePinnedCandidateRelease({...release,id:"another-release"}),currentAt}),/RELEASE_MISMATCH/);
  await assert.rejects(runtime.candidateCatalog.revalidate({...packet,candidates:[{...packet.candidates[0]!,
    itemKey:"search-releases/prepared-release/prepared/03/7"}]},endpoint,release,currentAt),/MEMBER_INVALID/);
});

test("prepared read groups retain exact membership identities and distinct publisher units",async()=>{
  const f=await fixture();
  const release=parsePinnedCandidateRelease({id:"prepared-release",environment:"production",capability:"current",configuration,
    instances:[{id:"prepared-instance",shardId:"prepared-shard"}]});
  const runtime=createPreparedResearchRuntime({release,session:createPreparedEvidenceSession(f.input),
    catalog:createPreparedDiscoveryCatalog({async readExact(request){return {...f.packet,
      units:{...f.packet.units,"work:1:13":{ordinal:13,text}},
      records:request.references.map(([vector,member])=>({...f.packet.records[0]!,vector_ordinal:vector,membership_ordinal:member,
        unit:member===9?"work:1:13":"work:1:12",
        chunk:{...f.packet.records[0]!.chunk,snapshotProvisionId:member===9?"work:1:13":"work:1:12"}}))};}})});
  const endpoint={kind:"current"} as const;
  const candidates=[7,8,9].map(member=>candidateSchema.parse({itemKey:`search-releases/prepared-release/prepared/3/${member}`,
    instanceId:"prepared-instance",shardId:"prepared-shard",formulationIds:["query"],readingIds:["reading"],
    retrievalRequirementIds:["requirement"],vectorRank:member-6,vectorScore:.9,keywordRank:member-6,keywordScore:2,fusionScore:.03}));
  const found=await runtime.candidateCatalog.revalidate({availability:"available",releaseId:release.id,endpoint,
    requiredInstanceIds:[release.instances[0]!.id],partialErrors:[],candidates},endpoint,release,new Date().toISOString());
  assert.notEqual(found[0]!.discoveryId,found[1]!.discoveryId);
  assert.equal(found[0]!.discoveryGroupId,found[1]!.discoveryGroupId);
  assert.notEqual(found[1]!.discoveryGroupId,found[2]!.discoveryGroupId);
});

test("session does not turn historical discovery into current evidence or exceed failed-fetch budget",async()=>{
  const history=await fixture("https://lex.uz/en/docs/777?ONDATE=01.01.2020");
  await assert.rejects(createPreparedEvidenceSession(history.input).resolve(history.packet,[3,7]),/HISTORICAL_APPLICABILITY_REQUIRED/);
  assert.equal(history.calls(),0);
  const f=await fixture();const session=createPreparedEvidenceSession({...f.input,captureLimit:1,fetch:async()=>{throw Error("upstream unavailable");}});
  await assert.rejects(session.resolve(f.packet,[3,7]),/upstream unavailable/);
  await assert.rejects(session.resolve(f.packet,[3,7]),/CAPTURE_BUDGET_EXHAUSTED/);
});

test("native prepared session delivers verified complete rules and complementary evidence through chat research",async()=>{
  const f=await fixture();let searches=0;
  const release=parsePinnedCandidateRelease({id:"prepared-release",environment:"production",capability:"current",configuration,
    instances:[{id:"prepared-instance",shardId:"prepared-shard"}]});
  const runtime=createPreparedCorpusResearchRuntime({release,capture:f.input,fetch:f.input.fetch,
    readExact:async request=>{assert.deepEqual(request.references,[[3,7]]);return f.packet;},
    search:async(request,signal)=>{
      searches++;assert.ok(signal);assert.equal(request.query,"How can an applicant challenge a refused record request?");
      return {version:request.version,releaseId:request.releaseId,environment:request.environment,
        configuration:request.configuration,requestSha256:request.requestSha256,lanes:{dense:"complete",sparse:"complete"},
        hits:[{vectorOrdinal:3,membershipOrdinal:7,vectorRank:1,vectorScore:.9,keywordRank:1,keywordScore:2,fusionScore:.03}]};
    }});
  const scope={requestId:"prepared-turn",environment:release.environment,temporalScope:{kind:"current"} as const};
  const session=await runtime.openLegalResearch(scope);
  const plan={id:"prepared-plan",formulations:[{id:"records-query",text:"How can an applicant challenge a refused record request?",
    privateNameSpans:[],readingIds:["applicant"],requirementIds:["records","review"]}]};
  const result=await session.search({round:0,plan});
  assert.deepEqual(result.needs,[]);assert.equal(result.evidence.length,2);
  assert.deepEqual(result.evidence.map(row=>row.source.article).sort(),["7","8"]);
  assert.ok(result.evidence.some(row=>row.text.includes("unless it contains protected personal information")));
  assert.ok(result.evidence.some(row=>row.text.includes("independent review")));
  for(const row of result.evidence){
    assert.equal(row.source.status,"current");assert.equal(row.source.citationEvidenceReceipt!.version,2);
    assert.deepEqual(row.source.citationEvidenceReceipt!.store,f.input.store);
  }
  assert.equal(f.calls(),1);assert.equal(searches,1);
  await session.cancel();await assert.rejects(session.search({round:1,plan}));
  await assert.rejects(runtime.openLegalResearch({...scope,temporalScope:{kind:"timestamp",instant:"2020-01-01T00:00:00.000Z"}}),/HISTORICAL_APPLICABILITY_REQUIRED/);
});

test("native gateway composes budgeted embeddings and numeric transport with complete chat evidence",async t=>{
  const f=await fixture();const calls:string[]=[];
  const release=parsePinnedCandidateRelease({id:"prepared-release",environment:"production",capability:"current",configuration,
    instances:[{id:"prepared-instance",shardId:"prepared-shard"}]});
  const query="How can an applicant challenge a refused record request?";
  t.mock.method(globalThis,"fetch",async(url:URL,init:RequestInit)=>{
    assert.equal(url.origin,"http://127.0.0.1:43210");
    const body=JSON.parse(String(init.body));
    const headers={"X-Juro-Worker-Sha256":"a".repeat(64)};
    if(url.pathname==="/read-exact"){calls.push("catalog");return Response.json(f.packet,{headers});}
    calls.push("numeric");assert.equal(body.embedding.length,3072);assert.equal("query" in body,false);
    assert.ok(body.termHashes.length>0);
    return Response.json({version:body.version,releaseId:body.releaseId,environment:body.environment,
      configuration:body.configuration,requestSha256:body.requestSha256,lanes:{dense:"complete",sparse:"complete"},
      hits:[{vectorOrdinal:3,membershipOrdinal:7,vectorRank:1,vectorScore:.9,keywordRank:1,keywordScore:2,fusionScore:.03}]},{headers});
  });
  const budgetDatabase={prepare(){return {bind(){return {async run(){calls.push("budget");return {success:true};}};}};}} as unknown as D1Database;
  const runtime=createPreparedNativeResearchRuntime({release,capture:f.input,fetch:f.input.fetch,
    numeric:{url:"http://127.0.0.1:43210",token:"test-token-".repeat(5),workerSha256:"a".repeat(64)},
    embedding:{apiKey:"test-only-key",budgetDatabase,budgetMode:"metered",fetch:async(_url,init)=>{
      calls.push("embedding");assert.deepEqual(JSON.parse(String(init!.body)).input,[query]);
      return Response.json({model:"text-embedding-3-large",data:[{index:0,embedding:Array.from({length:3072},(_,i)=>i===0?1:0)}],
        usage:{prompt_tokens:12,total_tokens:12}});
    }}});
  const session=await runtime.openLegalResearch({requestId:"native-turn",environment:release.environment,temporalScope:{kind:"current"}});
  const result=await session.search({round:0,plan:{id:"native-plan",formulations:[{id:"query",text:query,
    privateNameSpans:[],readingIds:["applicant"],requirementIds:["records","review"]}]}});
  assert.deepEqual(calls,["budget","embedding","numeric","catalog"]);
  assert.deepEqual(result.needs,[]);assert.deepEqual(result.evidence.map(row=>row.source.article).sort(),["7","8"]);
  assert.ok(result.evidence.every(row=>row.source.status==="current"&&row.source.citationEvidenceReceipt!.version===2));
});
