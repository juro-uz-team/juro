import assert from "node:assert/strict";
import test from "node:test";
import {createPreparedCandidateIndex,type PreparedSearchRequest} from "../lib/legal-corpus/prepared-candidate-index";
import {createProviderCandidateIndex, parsePinnedCandidateRelease,
  toPinnedCandidateConfiguration} from "../lib/legal-corpus/legal-candidate-index";

function configuration() {
  return {backend: "prepared-corpus-v1", identity: "prepared-configuration",
    embeddingModel: "openai/text-embedding-3-large", dimensions: 3072,
    artifacts: {packageSha256: "a".repeat(64), vectorCompletionSha256: "b".repeat(64),
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
