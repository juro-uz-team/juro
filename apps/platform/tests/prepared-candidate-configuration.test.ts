import assert from "node:assert/strict";
import test from "node:test";
import {createPreparedCandidateIndex,preparedSearchRequestHash,type PreparedSearchRequest} from "../lib/legal-corpus/prepared-candidate-index";
import {createPreparedSearchService} from "../lib/legal-corpus/prepared-search-service";
import {prepareSparseProfile} from "../lib/legal-corpus/prepared-sparse-profile";
import {createProviderCandidateIndex, parsePinnedCandidateRelease,
  toPinnedCandidateConfiguration} from "../lib/legal-corpus/legal-candidate-index";

function configuration() {
  return {backend: "prepared-corpus-v1", navigationBackend: "pgvector", identity: "prepared-configuration",
    embeddingModel: "openai/text-embedding-3-large", dimensions: 3072,
    artifacts: {packageSha256: "a".repeat(64), vectorCompletionSha256: "b".repeat(64),
      vectorIdentitySha256: "1".repeat(64),
      membershipSha256: "c".repeat(64), workIndexSha256: "d".repeat(64),
      navigationSha256: "e".repeat(64), sparseSha256: "f".repeat(64)},
    evidenceSemantics: "discovery-only", categoryRanking: {mode: "disabled"},
    gatewayIdentity: "gateway", providerProjectIdentity: "project",
    gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false};
}

function release(){return parsePinnedCandidateRelease({id:"prepared-release",environment:"production",capability:"current",
  instances:[{id:"prepared-instance",shardId:"prepared-shard"}],configuration:configuration()});}
function response(request:PreparedSearchRequest){return {version:request.version,releaseId:request.releaseId,
  environment:request.environment,configuration:request.configuration,requestSha256:request.requestSha256,
  lanes:{dense:"complete",sparse:"complete"},hits:[{vectorOrdinal:3,membershipOrdinal:7,vectorRank:1,vectorScore:.9,
    keywordRank:2,keywordScore:2,fusionScore:.04}]};}

test("prepared search service connects unchanged formulation and production analyzer to numeric search",async()=>{
  let embedded="",calls=0;
  const service=createPreparedSearchService({release:release(),async embed(query,signal){
    signal.throwIfAborted();embedded=query;return Array(3072).fill(.01);
  },async execute(request,signal){
    signal.throwIfAborted();calls++;assert.equal("query" in request,false);
    assert.equal(request.embedding.length,3072);
    const expected=prepareSparseProfile({title:"",hierarchy:"",article:"",text:embedded},1);
    assert.deepEqual(request.termHashes,expected.postings.map(row=>row.termHash));
    return response({...request,query:embedded});
  }});
  const adapter=createPreparedCandidateIndex(service);
  const query="Mehnat шартнома шартнома — Article 7";
  const packet=await adapter.retrieve({id:"question",formulations:[{id:"q",text:query,
    privateNameSpans:[],readingIds:["reading"],requirementIds:["requirement"]}]},{kind:"current"},release());
  assert.equal(packet.availability,"available");assert.equal(embedded,query);assert.equal(calls,1);
});

test("prepared service rejects changed request before embedding and propagates incomplete lanes",async()=>{
  let embeddings=0;
  const service=createPreparedSearchService({release:release(),async embed(){embeddings++;return Array(3072).fill(.01);},
    async execute(request){return {...response({...request,query:"question"}),lanes:{dense:"complete",sparse:"partial"}};}});
  let captured:PreparedSearchRequest|undefined;
  const adapter=createPreparedCandidateIndex({async search(request){captured=request;return response(request);}});
  await adapter.retrieve({id:"question",formulations:[{id:"q",text:"question",privateNameSpans:[],
    readingIds:["reading"],requirementIds:["requirement"]}]},{kind:"current"},release());
  assert.ok(captured);
  await assert.rejects(service.search({...captured,query:"different"}),/REQUEST_MISMATCH/u);
  await assert.rejects(service.search({...captured,endpoint:{kind:"timestamp",instant:"2020-01-01T00:00:00.000Z"}}),/REQUEST_MISMATCH/u);
  assert.equal(embeddings,0);
  await assert.rejects(service.search(captured));assert.equal(embeddings,1);
  await assert.rejects(service.search(captured,AbortSignal.abort()));assert.equal(embeddings,1);
});

test("historical discovery request identity does not depend on endpoint property insertion order",async()=>{
  const history=parsePinnedCandidateRelease({...release(),capability:"history"});
  const request={version:"prepared-search-v1" as const,releaseId:history.id,environment:history.environment,
    configuration:configuration() as PreparedSearchRequest["configuration"],
    endpoint:{instant:"2020-01-01T00:00:00.000Z",kind:"timestamp" as const},query:"question",limit:50 as const};
  const requestSha256=preparedSearchRequestHash(request);
  assert.equal(requestSha256,preparedSearchRequestHash({...request,endpoint:{kind:"timestamp",instant:request.endpoint.instant}}));
  const service=createPreparedSearchService({release:history,async embed(){return Array(3072).fill(.01);},
    async execute(value){return response({...value,query:"question"});}});
  assert.equal((await service.search({...request,requestSha256})).requestSha256,requestSha256);
});

test("prepared adapter preserves formulation provenance and bounds concurrent searches",async()=>{
  let active=0,peak=0;const queries:string[]=[];
  const adapter=createPreparedCandidateIndex({async search(request){
    active++;peak=Math.max(peak,active);queries.push(request.query);
    await new Promise<void>(resolve=>setImmediate(resolve));active--;return response(request);
  }});
  const formulations=Array.from({length:4},(_,index)=>({id:`q${index}`,text:`Unmodified question ${index}`,
    privateNameSpans:[],readingIds:["reading"],requirementIds:[`requirement${index}`]}));
  const packet=await adapter.retrieve({id:"interpretation",formulations},{kind:"current"},release());
  assert.equal(peak,2);assert.deepEqual(queries,formulations.map(item=>item.text));
  assert.equal(packet.availability,"available");assert.equal(packet.candidates.length,1);
  assert.equal(packet.candidates[0]!.itemKey,"search-releases/prepared-release/prepared/3/7");
  assert.deepEqual(packet.candidates[0]!.formulationIds,["q0","q1","q2","q3"]);
  assert.equal(packet.candidates[0]!.formulationMatches!.length,4);
  assert.equal(packet.candidates[0]!.providerMetadata,undefined);
});

test("prepared adapter rejects incomplete lanes, stale pins, wrong requests and duplicate memberships",async()=>{
  const mutations=[
    (value:ReturnType<typeof response>)=>({...value,lanes:{dense:"complete",sparse:"partial"}}),
    (value:ReturnType<typeof response>)=>({...value,requestSha256:"0".repeat(64)}),
    (value:ReturnType<typeof response>)=>({...value,environment:"staging"}),
    (value:ReturnType<typeof response>)=>({...value,configuration:{...value.configuration,navigationBackend:"faiss"}}),
    (value:ReturnType<typeof response>)=>({...value,configuration:{...value.configuration,artifacts:{...value.configuration.artifacts,sparseSha256:"0".repeat(64)}}}),
    (value:ReturnType<typeof response>)=>({...value,hits:[...value.hits,...value.hits]}),
  ];
  for(const mutate of mutations){
    const adapter=createPreparedCandidateIndex({async search(request){return mutate(response(request));}});
    const packet=await adapter.retrieve({id:"question",formulations:[{id:"q",text:"question",privateNameSpans:[],
      readingIds:["reading"],requirementIds:["requirement"]}]},{kind:"current"},release());
    assert.equal(packet.availability,"unavailable");assert.equal(packet.candidates.length,0);
  }
});

test("prepared release preserves every artifact pin and rejects legacy or incomplete configuration", () => {
  const input = configuration();
  assert.deepEqual(toPinnedCandidateConfiguration(input), input);
  for (const changed of [
    {...input, dimensions: 1536},
    {...input, backend: "prepared-corpus-v2"},
    {...input, navigationBackend: undefined},
    {...input, navigationBackend: "faiss"},
    {...input, evidenceSemantics: "eligible"},
    {...input, gatewayCaching: true},
    {...input, metadataSchema: ["valid_from", "valid_to"]},
    {...input, artifacts: {...input.artifacts, sparseSha256: undefined}},
    {...input, categoryRanking: {mode: "qualified"}},
  ]) assert.throws(() => toPinnedCandidateConfiguration(changed));
  const qualified = {...input, categoryRanking: {mode: "qualified",
    policySha256: "1".repeat(64), qualificationSha256: "2".repeat(64)}};
  assert.deepEqual(toPinnedCandidateConfiguration(qualified), qualified);
});

test("legacy provider rejects a prepared release before attestation or search", async () => {
  let calls = 0;
  const provider = createProviderCandidateIndex({
    async attest() { calls++; throw Error("Unexpected legacy attestation"); },
    async search() { calls++; throw Error("Unexpected legacy search"); },
  }, {});
  const release = parsePinnedCandidateRelease({id: "prepared-release", environment: "production",
    capability: "current", instances: [{id: "prepared-instance", shardId: "prepared-shard"}],
    configuration: configuration()});
  const result = await provider.retrieve({id: "question", formulations: [{id: "formulation",
    text: "Which provisions apply?", privateNameSpans: [], readingIds: ["reading"],
    requirementIds: ["requirement"]}]}, {kind: "current"}, release);
  assert.equal(result.availability, "unavailable");
  assert.equal(result.candidates.length, 0);
  assert.equal(calls, 0);
});
