import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {capturePreparedSource} from "../lib/legal-corpus/prepared-source-capture";
import {createPreparedHistoricalEvidenceReader} from "../lib/legal-corpus/prepared-historical-evidence";
import {classifyLegalSourceUrl} from "../lib/legal/source-fetch";
import {createCompleteArticleIndex} from "../lib/legal/article-context";
import {resolvePreparedSourceEvidence} from "../lib/legal-corpus/prepared-source-evidence";
import {createPreparedCorpusResearchRuntime,createPreparedCorpusResearchPairRuntime} from "../lib/runtime/prepared-corpus";
import {parsePinnedCandidateRelease} from "../lib/legal-corpus/legal-candidate-index";
import {preparedCandidateConfigurationSchema} from "../lib/legal-corpus/prepared-candidate-configuration";

const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
async function fixture(timeline=""){
  const objects=new Map<string,Uint8Array>();
  const bucket={async get(key:string){const bytes=objects.get(key);return bytes?{key,size:bytes.length,bytes:async()=>bytes}:null;},
    async put(key:string,bytes:Uint8Array){objects.set(key,new Uint8Array(bytes));}};
  const url="https://lex.uz/en/docs/777?ONDATE=01.01.2020";
  const quote="This provision applies from 1 January 2020 until 1 January 2021.";
  const edition="This text is the official edition for the period from 1 January 2020 until 1 January 2021.";
  const bytes=new TextEncoder().encode(`<html><header id="doc_header">Действующий акт${timeline}</header><main><h1>Records law</h1><p>Article 7. Records</p><p>The applicant may request a complete record from the public authority except where disclosure would reveal protected personal information. Commencement follows Article 8 of this Law.</p><p>Article 8. Commencement</p><p>${quote}</p><p>${edition}</p></main></html>`);
  const capture=await capturePreparedSource({fetched:{...classifyLegalSourceUrl(url),bytes,contentSha256:hash(bytes),
    contentType:"text/html",etag:null,lastModified:null,fetchedAt:"2026-10-20T00:00:00.000Z",robotsUrl:"https://lex.uz/robots.txt"},
    bucket,store:{namespace:"legal-prepared-"+"a".repeat(64),generationSha256:"b".repeat(64)},options:{}});
  const completeText=createCompleteArticleIndex(capture.parent.snapshot.blocks)("7").candidates[0]!.text;
  const proof={revisionId:capture.revisionId,sha256:capture.parent.sha256,officialUrl:url,quote};
  const fact={sourceRevisionId:capture.revisionId,sourceSha256:capture.parent.sha256,officialUrl:url,languageTag:"en" as const,
    completeTextSha256:hash(completeText),articleNumber:"7",
    editorial:{from:"2020-01-01T00:00:00Z",to:"2021-01-01T00:00:00Z"},editorialEvidence:{...proof,quote:edition},
    applicability:{from:"2020-01-01T00:00:00Z",to:"2021-01-01T00:00:00Z"},applicabilityEvidence:{...proof,kind:"commencement_clause" as const}};
  const publication={format:"prepared-historical-evidence-v1",packageSha256:"a".repeat(64),facts:[fact]};
  function reader(value=publication){const manifestBytes=new TextEncoder().encode(JSON.stringify(value));
    return createPreparedHistoricalEvidenceReader({manifestBytes,manifestSha256:hash(manifestBytes),packageSha256:publication.packageSha256,bucket});}
  const query={sourceRevisionId:capture.revisionId,sourceSha256:capture.parent.sha256,officialUrl:url,languageTag:"en" as const,
    completeText,articleNumber:"7",instant:"2020-06-01T00:00:00Z"};
  return {reader,publication,query,objects,capture,bucket,bytes};
}

test("versioned historical proof authenticates raw editorial controls and every applicability source",async()=>{
  const f=await fixture(`<div class="lx_date_selected">01.01.2020</div>
    <div class="lx_date_link" onclick="lxOpenUrl('/en/docs/777?ONDATE=01.01.2021')">01.01.2021</div>`);
  const original=f.publication.facts[0]!;
  const publication={...f.publication,format:"prepared-historical-evidence-v2",facts:[{...original,
    editorial:{from:"2020-01-01T00:00:00Z",to:"2020-12-31T19:00:00Z"},
    editorialEvidence:{kind:"publisher_timeline",rawSha256:hash(f.bytes),officialUrl:f.query.officialUrl,
      selectedDate:"2020-01-01",nextDate:"2021-01-01"},
    applicabilityEvidence:[original.applicabilityEvidence,{...original.editorialEvidence,kind:"amendment_act"}]}]};
  const rawKey=`corpus/publisher/${hash(f.bytes)}.html`;f.objects.set(rawKey,f.bytes);
  function reader(value=publication){const manifestBytes=Buffer.from(JSON.stringify(value));return createPreparedHistoricalEvidenceReader({
    manifestBytes,manifestSha256:hash(manifestBytes),packageSha256:f.publication.packageSha256,bucket:f.bucket});}
  assert.equal((await reader().resolve(f.query)).fact.articleNumber,"7");
  assert.throws(()=>reader({...publication,format:"prepared-historical-evidence-v1"}));
  for(const change of [
    (value:typeof publication)=>{value.facts[0]!.editorialEvidence.nextDate="2022-01-01";},
    (value:typeof publication)=>{value.facts[0]!.editorial.from="2019-01-01T00:00:00Z";},
    (value:typeof publication)=>{value.facts[0]!.editorial.to="2021-01-01T00:00:00Z";},
    (value:typeof publication)=>{value.facts[0]!.applicabilityEvidence[1]!.quote="This separate source does not contain this required assertion.";},
  ]){const invalid=structuredClone(publication);change(invalid);await assert.rejects(reader(invalid).resolve(f.query));}
  f.objects.set(rawKey,Buffer.from("changed"));
  await assert.rejects(reader().resolve(f.query),/SOURCE_MISMATCH/);
  f.objects.delete(rawKey);
  await assert.rejects(reader().resolve(f.query),/SOURCE_UNAVAILABLE/);
});

test("historical admission authenticates exact complete rule and independent interval evidence",async()=>{
  const f=await fixture();const result=await f.reader().resolve(f.query);
  assert.equal(result.fact.completeTextSha256,hash(f.query.completeText));assert.equal(result.instant,f.query.instant);
  for(const changes of [{instant:"2019-12-31T23:59:59.9999999Z"},{instant:"2021-01-01T00:00:00Z"},
    {articleNumber:"8"},{completeText:"partial record rule"},{languageTag:"ru" as const},
    {officialUrl:"https://lex.uz/en/docs/777"}]){
    await assert.rejects(f.reader().resolve({...f.query,...changes}),/APPLICABILITY_REQUIRED/);
  }
  await assert.rejects(f.reader({...f.publication,facts:[...f.publication.facts,...f.publication.facts]}).resolve(f.query),/AMBIGUOUS/);
});

test("historical discovery resolves complete evidence only with its matching applicability publication",async()=>{
  const f=await fixture();
  const input={capture:f.capture,bucket:f.bucket,discovery:{officialUrl:f.query.officialUrl,
    languageTag:f.query.languageTag,text:f.query.completeText,textSha256:hash(f.query.completeText)}};
  await assert.rejects(resolvePreparedSourceEvidence(input),/APPLICABILITY_REQUIRED/);
  const result=await resolvePreparedSourceEvidence({...input,history:{instant:f.query.instant,reader:f.reader()}});
  assert.equal(result.resolution.articleContext!.provisionText,f.query.completeText);
  assert.equal(result.historicalApplicability!.instant,f.query.instant);
  await assert.rejects(resolvePreparedSourceEvidence({...input,history:{instant:"2021-01-01T00:00:00Z",reader:f.reader()}}),/APPLICABILITY_REQUIRED/);
});

test("ONDATE and pinned text cannot replace missing or corrupted applicability evidence",async()=>{
  const f=await fixture();const invalid=structuredClone(f.publication);
  invalid.facts[0]!.applicabilityEvidence.quote="An unsupported commencement assertion that does not occur in the source.";
  await assert.rejects(f.reader(invalid).resolve(f.query),/PROOF_UNAVAILABLE/);
  const wrongScope=structuredClone(f.publication);wrongScope.facts[0]!.completeTextSha256=hash("fragment");
  await assert.rejects(f.reader(wrongScope).resolve({...f.query,completeText:"fragment"}),/RULE_MISMATCH/);
  f.objects.set(f.capture.parent.r2Key,new Uint8Array([1,2,3]));
  await assert.rejects(f.reader().resolve(f.query),/REVISION_INVALID/);
});

test("historical half-open intervals preserve sub-millisecond precision",async()=>{
  const f=await fixture();const precise=structuredClone(f.publication);
  precise.facts[0]!.applicability={from:"2020-06-01T00:00:00.1234567Z",to:"2020-06-01T00:00:00.1234569Z"};
  const reader=f.reader(precise);
  await reader.resolve({...f.query,instant:"2020-06-01T00:00:00.12345670Z"});
  await assert.rejects(reader.resolve({...f.query,instant:"2020-06-01T00:00:00.1234566Z"}),/APPLICABILITY_REQUIRED/);
  await assert.rejects(reader.resolve({...f.query,instant:"2020-06-01T00:00:00.1234569Z"}),/APPLICABILITY_REQUIRED/);
});

test("manifest pins and editorial validity are independent admission requirements",async()=>{
  const f=await fixture();const manifestBytes=new TextEncoder().encode(JSON.stringify(f.publication));
  const input={manifestBytes,manifestSha256:hash(manifestBytes),packageSha256:f.publication.packageSha256,bucket:f.bucket};
  assert.throws(()=>createPreparedHistoricalEvidenceReader({...input,manifestSha256:"0".repeat(64)}),/MANIFEST_MISMATCH/);
  assert.throws(()=>createPreparedHistoricalEvidenceReader({...input,packageSha256:"0".repeat(64)}),/PACKAGE_MISMATCH/);
  const otherEdition=structuredClone(f.publication);
  otherEdition.facts[0]!.editorial.to="2020-05-01T00:00:00Z";
  await assert.rejects(f.reader(otherEdition).resolve(f.query),/APPLICABILITY_REQUIRED/);
  await f.reader().resolve({...f.query,instant:"2020-06-01T00:00Z"});
});

async function historicalRuntimeFixture(discoveryUrl?:string){
  const f=await fixture();
  const configuration=preparedCandidateConfigurationSchema.parse({backend:"prepared-corpus-v1",navigationBackend:"pgvector",identity:"history-configuration",
    embeddingModel:"openai/text-embedding-3-large",dimensions:3072,evidenceSemantics:"discovery-only",categoryRanking:{mode:"disabled"},
    artifacts:{packageSha256:"a".repeat(64),vectorCompletionSha256:"b".repeat(64),vectorIdentitySha256:"1".repeat(64),
      membershipSha256:"c".repeat(64),workIndexSha256:"d".repeat(64),navigationSha256:"e".repeat(64),sparseSha256:"f".repeat(64)},
    gatewayIdentity:"gateway",providerProjectIdentity:"project",gatewayPayloadLogging:false,gatewayCaching:false,similarityCaching:false});
  const release=parsePinnedCandidateRelease({id:"history-release",environment:"production",capability:"history",configuration,
    instances:[{id:"history-instance",shardId:"history-shard"}]});
  const packet={package_sha256:configuration.artifacts.packageSha256,vector_completion_sha256:configuration.artifacts.vectorCompletionSha256,
    membership_sha256:configuration.artifacts.membershipSha256,work_index_sha256:configuration.artifacts.workIndexSha256,
    records:[{vector_ordinal:3,membership_ordinal:7,compact_input_hash:"1".repeat(64),original_input_hash:"2".repeat(64),work:"work:1",unit:"work:1:12",status:"discovery_only",
      chunk:{id:`retrieval-chunk-v1:${"3".repeat(64)}`,work:"work:1",snapshotProvisionId:"work:1:12",officialText:f.query.completeText,
        officialTextSha256:hash(f.query.completeText),language:"en",script:"Latn"}}],
    sources:{"work:1":{inventory:{id:"work:1",url:discoveryUrl??f.query.officialUrl},prepared:{work:"work:1"}}},
    units:{"work:1:12":{ordinal:12,text:f.query.completeText}},continuations:{}};
  const complete=structuredClone(f.publication);
  const target=createCompleteArticleIndex(f.capture.parent.snapshot.blocks)("8").candidates[0]!.text;
  complete.facts.push({...complete.facts[0]!,articleNumber:"8",completeTextSha256:hash(target)});
  function dependencies(publication:typeof complete):Parameters<typeof createPreparedCorpusResearchRuntime>[0]{
    const manifestBytes=new TextEncoder().encode(JSON.stringify(publication));
    return {release,history:{manifestBytes,manifestSha256:hash(manifestBytes)},
      capture:{bucket:f.bucket,store:f.capture.store,options:{}},fetch:async()=>{throw Error("Historical evidence must not fetch current text");},
      readExact:async()=>packet,search:async request=>({version:request.version,releaseId:request.releaseId,environment:request.environment,
        configuration:request.configuration,requestSha256:request.requestSha256,lanes:{dense:"complete",sparse:"complete"},
        hits:[{vectorOrdinal:3,membershipOrdinal:7,vectorRank:1,vectorScore:.9,keywordRank:1,keywordScore:2,fusionScore:.03}]})};
  }
  async function run(publication:typeof complete,instant=f.query.instant){
    const runtime=createPreparedCorpusResearchRuntime(dependencies(publication));
    const session=await runtime.openLegalResearch({requestId:"history-turn",environment:release.environment,temporalScope:{kind:"timestamp",instant}});
    return session.search({round:0,plan:{id:"history-plan",formulations:[{id:"query",text:"What rule applied to records?",
      privateNameSpans:[],readingIds:["applicant"],requirementIds:["records"]}]}});
  }
  return {f,complete,dependencies,run};
}

test("historical chat reads retained captures and separately proves complementary provisions",async()=>{
  const {f,complete,run}=await historicalRuntimeFixture();
  const result=await run(complete);
  assert.deepEqual(result.needs,[]);assert.deepEqual(result.evidence.map(row=>row.source.article).sort(),["7","8"]);
  assert.ok(result.evidence.every(row=>row.source.status==="historical"&&row.source.citationEvidenceReceipt?.capability==="history"
    &&row.source.citationEvidenceReceipt.version===2));
  const missingReference=await run(f.publication);
  assert.equal(missingReference.evidence.some(row=>row.source.article==="8"),false);
  assert.ok(missingReference.needs.some(row=>row.reason==="unresolved_reference"));
  assert.equal((await run(complete,"2021-01-01T00:00:00Z")).evidence.length,0);
});

test("historical discovery selects the proved revision at the requested instant, independently of discovery edition",async()=>{
  for(const discoveryUrl of ["https://lex.uz/en/docs/777","https://lex.uz/en/docs/777?ONDATE=01.01.2019"]){
    const {f,complete,run}=await historicalRuntimeFixture(discoveryUrl);
    const result=await run(complete);
    assert.deepEqual(result.evidence.map(row=>row.source.article).sort(),["7","8"]);
    assert.ok(result.evidence.every(row=>row.source.officialUrl===f.query.officialUrl));
    assert.equal((await run(complete,"2021-01-01T00:00:00Z")).evidence.length,0);
  }
});

test("historical capture selection rejects another instrument, language and ambiguous applicable revision",async()=>{
  const f=await fixture();const query={officialUrl:"https://lex.uz/en/docs/777",languageTag:"en" as const,instant:f.query.instant};
  assert.equal((await f.reader().readCapture(query)).revisionId,f.capture.revisionId);
  for(const changes of [{officialUrl:"https://lex.uz/en/docs/778"},{officialUrl:"https://lex.uz/ru/docs/777"},{languageTag:"ru" as const}]){
    await assert.rejects(f.reader().readCapture({...query,...changes}),/APPLICABILITY_REQUIRED/);
  }
  const ambiguous=structuredClone(f.publication);
  ambiguous.facts.push({...ambiguous.facts[0]!,sourceRevisionId:`prepared-normalized-${"f".repeat(64)}`,sourceSha256:"f".repeat(64),officialUrl:"https://lex.uz/en/docs/777?ONDATE=01.02.2020"});
  await assert.rejects(f.reader(ambiguous).readCapture(query),/HISTORY_AMBIGUOUS/);
});


test("prepared comparisons pin both releases and keep concurrent endpoint evidence separate",async()=>{
  const {f,complete,dependencies}=await historicalRuntimeFixture();
  const history=dependencies(complete);const search=history.search;
  const started:string[]=[],finished:string[]=[];const both=Promise.withResolvers<void>();
  const overlapped:typeof search=async(request,signal)=>{
    started.push(request.releaseId);if(started.length===2)both.resolve();
    await both.promise;
    if(request.endpoint.kind==="timestamp")await new Promise(resolve=>setTimeout(resolve,20));
    finished.push(request.releaseId);return search(request,signal);
  };
  history.search=overlapped;
  const current={...dependencies(complete),release:parsePinnedCandidateRelease({...history.release,id:"current-release",capability:"current"}),
    search:overlapped,fetch:async(url:string)=>({...classifyLegalSourceUrl(url),bytes:f.bytes,contentSha256:hash(f.bytes),
      contentType:"text/html",etag:null,lastModified:null,fetchedAt:new Date().toISOString(),robotsUrl:"https://lex.uz/robots.txt"}),
    readExact:async()=>{
      const packet=await dependencies(complete).readExact({artifacts:preparedCandidateConfigurationSchema.parse(history.release.configuration).artifacts,references:[[3,7]]});
      const cloned=structuredClone(packet) as {sources:Record<string,{inventory:{url:string}}>};
      cloned.sources["work:1"]!.inventory.url="https://lex.uz/en/docs/777";return cloned;
    }};
  const runtime=createPreparedCorpusResearchPairRuntime({current,history});
  // Caller mutation cannot replace the already selected release pair.
  current.release=parsePinnedCandidateRelease({...current.release,id:"later-current-release"});
  const scope={requestId:"comparison-turn",environment:"production" as const,temporalScope:{kind:"comparison" as const,
    left:{kind:"timestamp" as const,instant:f.query.instant},right:{kind:"current" as const}}};
  const session=await runtime.openLegalResearch(scope);
  const plan={id:"comparison-plan",formulations:[{id:"query",text:"Compare the records rule then and now.",
    privateNameSpans:[],readingIds:["applicant"],requirementIds:["records"]}]};
  const result=await session.search({round:0,plan});
  assert.deepEqual(started,["history-release","current-release"]);assert.deepEqual(finished,["current-release","history-release"]);
  assert.deepEqual(result.needs,[]);assert.equal(result.evidence.length,4);
  for(const capability of ["current","history"]){
    const evidence=result.evidence.filter(row=>row.source.citationEvidenceReceipt?.capability===capability);
    assert.deepEqual(evidence.map(row=>row.source.article).sort(),["7","8"]);
    assert.ok(evidence.every(row=>row.endpoint.kind===(capability==="current"?"current":"timestamp")));
  }
  await (await runtime.openLegalResearch({...scope,requestId:"comparison-next-turn"})).search({round:0,plan});
  assert.deepEqual(started.slice(2),["history-release","current-release"]);
  assert.throws(()=>createPreparedCorpusResearchPairRuntime({current:history,history}),/PAIR_INVALID/);
  assert.throws(()=>createPreparedCorpusResearchPairRuntime({current,history:{...history,
    release:parsePinnedCandidateRelease({...history.release,environment:"staging"})}}),/PAIR_INVALID/);
});

test("two historical endpoints keep separate applicability sessions within one release",async()=>{
  const {f,complete,dependencies}=await historicalRuntimeFixture();
  const runtime=createPreparedCorpusResearchRuntime(dependencies(complete));
  const later="2020-12-01T00:00:00Z";
  const session=await runtime.openLegalResearch({requestId:"two-dates",environment:"production",temporalScope:{kind:"comparison",
    left:{kind:"timestamp",instant:f.query.instant},right:{kind:"timestamp",instant:later}}});
  const result=await session.search({round:0,plan:{id:"dates-plan",formulations:[{id:"query",text:"Compare the rule on these dates.",
    privateNameSpans:[],readingIds:["applicant"],requirementIds:["records"]}]}});
  assert.deepEqual(result.needs,[]);assert.equal(result.evidence.length,4);
  for(const instant of [f.query.instant,later]){
    assert.equal(result.evidence.filter(row=>row.endpoint.kind==="timestamp"&&row.endpoint.instant===instant).length,2);
  }
});
