import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createPreparedDiscoveryCatalog} from "../lib/legal-corpus/prepared-discovery-catalog";
import {preparedCandidateConfigurationSchema} from "../lib/legal-corpus/prepared-candidate-configuration";

const configuration=preparedCandidateConfigurationSchema.parse({backend:"prepared-corpus-v1",navigationBackend:"pgvector",identity:"prepared-configuration",
  embeddingModel:"openai/text-embedding-3-large",dimensions:3072,
  artifacts:{packageSha256:"a".repeat(64),vectorCompletionSha256:"b".repeat(64),vectorIdentitySha256:"1".repeat(64),
    membershipSha256:"c".repeat(64),workIndexSha256:"d".repeat(64),navigationSha256:"e".repeat(64),sparseSha256:"f".repeat(64)},
  evidenceSemantics:"discovery-only",categoryRanking:{mode:"disabled"},gatewayIdentity:"gateway",providerProjectIdentity:"project",
  gatewayPayloadLogging:false,gatewayCaching:false,similarityCaching:false});
function packet(){return {package_sha256:"a".repeat(64),vector_completion_sha256:"b".repeat(64),membership_sha256:"c".repeat(64),work_index_sha256:"d".repeat(64),
  records:[{vector_ordinal:3,membership_ordinal:7,compact_input_hash:"1".repeat(64),original_input_hash:"2".repeat(64),work:"work:1",unit:"work:1:12",status:"discovery_only",
    chunk:{id:`retrieval-chunk-v1:${"3".repeat(64)}`,work:"work:1",snapshotProvisionId:"work:1:12",officialText:"Exact rule",officialTextSha256:createHash("sha256").update("Exact rule").digest("hex"),language:"ru",script:"Cyrl",articleNumber:"publisher-position-999"}}],
  sources:{"work:1":{inventory:{id:"work:1",url:"https://lex.uz/ru/docs/6257291"},prepared:{work:"work:1",
    assignments:[{scheme:"LBC",node:"12",scope:"document",inherited:true,historical_validity:"not_established"}],
    gaps:[{kind:"missing_region"}],selected_edition:["2020-01-01"]}}},units:{"work:1:12":{ordinal:12,text:"Exact rule"}},continuations:{}};}

test("catalog handoff retains publisher classifications and extraction gaps without eligibility claims",async()=>{
  const source=packet();const catalog=createPreparedDiscoveryCatalog({async readExact(request){
    assert.deepEqual(request.references,[[3,7]]);assert.deepEqual(request.artifacts,configuration.artifacts);return source;}});
  const actual=await catalog.read(configuration,[[3,7]]);
  assert.deepEqual(actual,source);
  assert.equal(actual.records[0]!.chunk.articleNumber,"publisher-position-999");
});

test("catalog rejects generation, reference, source, unit and text mismatches",async()=>{
  const changes:Array<(value:ReturnType<typeof packet>)=>void>=[
    value=>{value.package_sha256="f".repeat(64);},value=>{value.records[0]!.vector_ordinal=4;},
    value=>{value.records[0]!.membership_ordinal=8;},value=>{value.records[0]!.chunk.officialText="Changed rule";},
    value=>{value.sources["work:1"].inventory.id="other";},value=>{value.units["work:1:12"].ordinal=13;},
    value=>{value.sources["work:1"].inventory.url="https://example.com/law";},
  ];
  for(const change of changes){const source=packet();change(source);
    await assert.rejects(createPreparedDiscoveryCatalog({async readExact(){return source;}}).read(configuration,[[3,7]]));}
});
