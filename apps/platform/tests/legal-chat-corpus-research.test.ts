import assert from "node:assert/strict";
import test from "node:test";
import {createCorpusResearch} from "../lib/legal-chat/corpus-research";
import {parsePinnedCandidateRelease, type QuestionInterpretation} from "../lib/legal-corpus/legal-candidate-index";
import {parseRevalidatedCandidates} from "../lib/legal-corpus/target-retrieval";
import {parseResolvedOfficialEvidence} from "../lib/legal-corpus/target-evidence";
import type {ResearchRequest} from "../lib/legal-chat/research";
import {researchLegalQuestion} from "../lib/legal-chat/research";
import {PostgresDatabase} from "../lib/storage/postgres";
import {createSharedSourceObservationRefresh} from "../lib/legal/shared-source-observation";
import {indexedRetrievalSignal} from "../lib/runtime/indexed-retrieval";

const instant="2026-09-20T10:00:00.000Z";
const release=(capability:"current"|"history")=>parsePinnedCandidateRelease({id:`release:${capability}`,
  environment:"development",capability,instances:[{id:"instance:one",shardId:"shard:one"}],
  configuration:{identity:"config:one",embeddingModel:"openai/text-embedding-3-large",dimensions:1536,
    keywordTokenizer:"porter",metadataSchema:["language","document_type","valid_from","valid_to"],
    gatewayIdentity:"gateway:one",providerProjectIdentity:"project:one",gatewayPayloadLogging:false,
    gatewayCaching:false,similarityCaching:false}});
const interpretation:QuestionInterpretation={id:"request:one",formulations:[{id:"query:one",text:"Synthetic record request",
  privateNameSpans:[],readingIds:["reading:one"],requirementIds:["need:one"]}]};
const request:ResearchRequest={round:0,needs:[],question:{question:"How can a record be requested?",
  topics:["Record requests"],locale:"en",mode:"fast",answerMode:"detailed",temporalScope:{kind:"current"}}};
const candidate=parseRevalidatedCandidates([{candidate:{itemKey:"item:one",instanceId:"instance:one",shardId:"shard:one",
  formulationIds:["query:one"],readingIds:["reading:one"],retrievalRequirementIds:["need:one"],
  vectorRank:1,vectorScore:1,keywordRank:1,keywordScore:1,fusionScore:1},
  canonicalChunkId:"chunk:one",provisionRenditionId:"rendition:one",textRevisionId:"revision:one",
  provisionConceptId:"concept:one",languageFamily:"en",textualAuthority:"controlling"}])[0]!;
const controlling=parseResolvedOfficialEvidence({legalInstrumentId:"instrument:one",officialExpressionId:"expression:one",
  textRevisionId:"revision:one",provisionConceptId:"concept:one",provisionRenditionId:"rendition:one",
  languageTag:"en",script:"Latn",textualAuthority:"controlling",provisionText:"Synthetic rule: a record may be requested.",
  officialCitation:{label:"Synthetic record rule",url:"https://lex.uz/docs/777"},
  evidence:{provisionRenditionId:"rendition:one",r2Key:"provision:one",byteCount:100,
    sha256:"a".repeat(64),sourceNormalizedSha256:"b".repeat(64),schemaVersion:1}});
function fixture() {
  const calls:{releases:number;comparisons:number;reads:number;searches:string[];times:string[]}=
    {releases:0,comparisons:0,reads:0,searches:[],times:[]};
  const services:Parameters<typeof createCorpusResearch>[0]["services"]={
    releaseResolver:{resolve:async endpoint=>{calls.releases++;return release(endpoint.kind==="current"?"current":"history");},
      resolveComparison:async(left,right)=>{calls.comparisons++;return {left:release(left.kind==="current"?"current":"history"),
        right:release(right.kind==="current"?"current":"history")};}},
    candidateIndex:{retrieve:async(_plan,endpoint,pinned,context)=>{
      calls.searches.push(pinned.id);calls.times.push(context!.currentAt);
      return {availability:"available",releaseId:pinned.id,endpoint,requiredInstanceIds:[pinned.instances[0]!.id],
        candidates:[candidate.candidate],partialErrors:[]};}},
    candidateCatalog:{revalidate:async()=>[candidate]},
    evidenceResolver:{resolveControlling:async()=>{calls.reads++;return {controlling,materialCitation:controlling.officialCitation};}},
    referenceDiscovery:async()=>({candidates:[],unresolved:[]}),
    verifyCurrentSource:async()=>({pinnedTextSha256:"b".repeat(64),observation:{version:2,observedAt:instant,
      officialUrl:controlling.officialCitation.url,current:true,normalizedTextSha256:"b".repeat(64),rawContentSha256:"c".repeat(64)}}),
  };
  return {services,calls,search:createCorpusResearch({services,formulate:async()=>interpretation,now:()=>Date.parse(instant)})};
}

test("incremental formulations start candidate retrieval before the final plan but release no early evidence",async()=>{
  const {services,calls}=fixture();
  const searching=Promise.withResolvers<void>(),finish=Promise.withResolvers<QuestionInterpretation>();
  const original=services.candidateIndex.retrieve;
  services.candidateIndex.retrieve=async(...args)=>{searching.resolve();return original(...args);};
  const search=createCorpusResearch({services,now:()=>Date.parse(instant),formulate:async(_request,emit)=>{
    assert.ok(emit,"The reader must accept incremental formulations");
    await emit({interpretationId:interpretation.id,formulation:interpretation.formulations[0]!});
    return finish.promise;
  }});
  const result=search(request);
  await Promise.race([searching.promise,result]);
  assert.equal(calls.reads,0,"No evidence is admitted before the full plan validates");
  finish.resolve(interpretation);
  const packet=await result;
  assert.equal(packet.evidence.length,1);
  assert.equal(calls.searches.length,1,"Finalization reuses the in-flight candidate search");
});

test("an invalid final plan cannot admit evidence from an earlier streamed formulation",async()=>{
  const {services,calls}=fixture();
  const search=createCorpusResearch({services,now:()=>Date.parse(instant),formulate:async(_request,emit)=>{
    await emit?.({interpretationId:interpretation.id,formulation:interpretation.formulations[0]!});
    return {...interpretation,formulations:[{...interpretation.formulations[0]!,text:"A silently replaced qualification"}]};
  }});
  await assert.rejects(search(request),/FRAGMENT_INVALID/);
  assert.equal(calls.searches.length,1);
  assert.equal(calls.reads,0);
});

test("bounded repair searches reuse the pinned release, time filter and authenticated evidence",async()=>{
  const {search,calls}=fixture();
  const first=await search(request);
  const second=await search({...request,round:1,needs:[{reason:"missing_rule",detail:"A qualification is missing."}]});
  assert.equal(calls.releases,1);
  assert.equal(calls.reads,1);
  assert.deepEqual(first,second);
  assert.equal(first.evidence.length,1);
  assert.deepEqual(calls.times,[instant,instant]);
});

test("the indexed corpus receives the exact request-local formulation without content redaction",async()=>{
  const {services}=fixture();
  const plan:QuestionInterpretation={...interpretation,formulations:[{...interpretation.formulations[0]!,
    text:"Alice Example account 123456789012 record access",privateNameSpans:["Alice Example"]}]};
  let received:QuestionInterpretation|undefined;
  const retrieve=services.candidateIndex.retrieve;
  services.candidateIndex.retrieve=async(...args)=>{received=args[0];return retrieve(...args);};
  await createCorpusResearch({services,formulate:async()=>plan})(request);
  assert.deepEqual(received,plan);
});

test("comparison resolves its release pair atomically and retains evidence at both endpoints",async()=>{
  const {search,calls}=fixture();
  const result=await search({...request,question:{...request.question,temporalScope:{kind:"comparison",
    left:{kind:"timestamp",instant:"2025-01-01T00:00:00.000Z"},right:{kind:"current"}}}});
  assert.equal(calls.comparisons,1);
  assert.equal(calls.releases,0);
  assert.equal(result.evidence.length,2);
  assert.notEqual(result.evidence[0]!.source.id,result.evidence[1]!.source.id);
  assert.deepEqual(calls.searches,["release:history","release:current"]);
});

test("partial retrieval cannot reach the source reader or masquerade as evidence",async()=>{
  const {services,search,calls}=fixture();
  const retrieve=services.candidateIndex.retrieve;
  services.candidateIndex.retrieve=async(...args)=>({...await retrieve(...args),partialErrors:[{code:"CANDIDATE_PARTIAL_RESPONSE"}]});
  const result=await search(request);
  assert.equal(calls.reads,0);
  assert.equal(result.evidence.length,0);
  assert.ok(result.needs.some(need=>need.reason==="source_unavailable"));
});

test("unresolved explicit references survive even when the referring rule was retrieved",async()=>{
  const {services,search}=fixture();
  services.referenceDiscovery=async()=>({candidates:[],unresolved:[{reason:"member_budget",
    query:{article:"12",textRevisionId:controlling.textRevisionId,languageTag:"en"}}]});
  const result=await search(request);
  assert.equal(result.evidence.length,1);
  assert.match(result.needs[0]!.detail,/Article 12/);
  assert.equal(result.needs[0]!.reason,"unresolved_reference");
});

test("request-local caches cannot be reused by a different question",async()=>{
  const {search,calls}=fixture();
  await search(request);
  await assert.rejects(search({...request,question:{...request.question,question:"A different dispute"}}),/REQUEST_MISMATCH/);
  assert.equal(calls.searches.length,1);
});

test("cancellation after retrieval prevents authentication, source reads and publication",async()=>{
  const {services,search,calls}=fixture();
  const controller=new AbortController();
  const retrieve=services.candidateIndex.retrieve;
  services.candidateIndex.retrieve=async(...args)=>{const packet=await retrieve(...args);controller.abort();return packet;};
  await assert.rejects(search({...request,question:{...request.question,signal:controller.signal}}),{name:"AbortError"});
  assert.equal(calls.reads,0);
});

test("unknown source authority preserves metadata and verifies current publication before admitting evidence",async()=>{
  const {services,search}=fixture();
  let observations=0;
  const original={...controlling,textualAuthority:"unknown" as const};
  services.evidenceResolver.resolveControlling=async()=>({controlling:original,
    materialCitation:controlling.officialCitation});
  const verify=services.verifyCurrentSource;
  services.verifyCurrentSource=async evidence=>{observations++;assert.equal(evidence.textualAuthority,"unknown");return verify(evidence);};
  const result=await search(request);
  assert.equal(result.evidence.length,1);
  assert.equal(result.evidence[0]!.text,controlling.provisionText);
  assert.equal(result.needs.some(need=>need.reason==="source_unavailable"),false);
  assert.equal(observations,1);
  assert.equal(original.textualAuthority,"unknown");
});

test("unknown source authority cannot bypass an unavailable current publication check",async()=>{
  const {services,search}=fixture();
  services.evidenceResolver.resolveControlling=async()=>({controlling:{...controlling,textualAuthority:"unknown"},
    materialCitation:controlling.officialCitation});
  let observations=0;
  services.verifyCurrentSource=async()=>{observations++;throw new Error("Publisher unavailable");};
  const result=await search(request);
  assert.equal(observations,1);
  assert.equal(result.evidence.length,0);
  assert.ok(result.needs.some(need=>need.reason==="source_unavailable"));
});

test("indexed retrieval expires after one total deadline and cannot publish late results",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  const {services,calls}=fixture();
  let started!:()=>void, finish!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const blocked=new Promise<void>(resolve=>{finish=resolve;});
  let signal:AbortSignal|undefined;
  const search=createCorpusResearch({services,formulate:async input=>{
    signal=input.question.signal;started();await blocked;return interpretation;
  }});
  const pending=search(request);
  const rejected=assert.rejects(pending,{name:"TimeoutError"});
  await entered;
  context.mock.timers.tick(10_000);
  await rejected;
  assert.equal(signal?.aborted,true);
  finish();
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.searches,[]);
  assert.equal(calls.reads,0);
});

test("cancelling indexed retrieval stops its active database read",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!);
  const {services}=fixture();
  const controller=new AbortController();
  const retrieve=services.candidateIndex.retrieve;
  services.candidateIndex.retrieve=async(...args)=>{
    await db.prepare("SELECT pg_sleep(30)").first();
    return retrieve(...args);
  };
  const search=createCorpusResearch({services,formulate:async()=>interpretation});
  const pending=search({...request,question:{...request.question,signal:controller.signal}});
  const rejected=assert.rejects(pending,{name:"AbortError"});
  const active=async()=>Number((await db.pool.query(
    "SELECT count(*) n FROM pg_stat_activity WHERE query=$1 AND state='active'",["SELECT pg_sleep(30)"])).rows[0].n);
  try {
    const waitUntil=Date.now()+3000;
    while(!await active()&&Date.now()<waitUntil)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(await active(),1);
    controller.abort();
    await rejected;
    const cancelledBy=Date.now()+1000;
    while(await active()&&Date.now()<cancelledBy)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(await active(),0,"fallback must not leave the database executing abandoned retrieval");
  }finally{controller.abort();await db.close();}
});

test("cancelled retrieval waiting for a database connection never starts its read",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!);
  const held=await Promise.all(Array.from({length:8},()=>db.pool.connect()));
  const {services}=fixture();
  const controller=new AbortController();
  let entered!:()=>void,completed=false;
  const queued=new Promise<void>(resolve=>{entered=resolve;});
  const retrieve=services.candidateIndex.retrieve;
  services.candidateIndex.retrieve=async(...args)=>{
    entered();await db.prepare("SELECT pg_sleep(30)").first();completed=true;
    return retrieve(...args);
  };
  const search=createCorpusResearch({services,formulate:async()=>interpretation});
  const rejected=assert.rejects(search({...request,question:{...request.question,signal:controller.signal}}),{name:"AbortError"});
  try {
    await queued;
    assert.equal(db.pool.waitingCount,1);
    controller.abort();await rejected;
    held.splice(0).forEach(client=>client.release());
    const waitUntil=Date.now()+1000;
    while(db.pool.idleCount!==db.pool.totalCount&&Date.now()<waitUntil)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(db.pool.waitingCount,0);
    assert.equal(db.pool.idleCount,db.pool.totalCount);
    assert.equal(completed,false);
  }finally{controller.abort();held.forEach(client=>client.release());await db.close();}
});

test("cancelled publisher verification releases its owned refresh lease",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!,"legal");
  const url=`https://lex.uz/ru/docs/${Date.now()}`;
  const {services}=fixture();
  const controller=new AbortController();
  let started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const refresh=createSharedSourceObservationRefresh({db:db as unknown as D1Database,readPublisher:async()=>{
    const signal=indexedRetrievalSignal()!;
    started();
    return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));
  }});
  let refreshing:Promise<unknown>|undefined;
  services.verifyCurrentSource=async()=>{
    refreshing=refresh(url);await refreshing;throw new Error("cancelled observation cannot complete");
  };
  const search=createCorpusResearch({services,formulate:async()=>interpretation});
  const rejected=assert.rejects(search({...request,question:{...request.question,signal:controller.signal}}),{name:"AbortError"});
  try {
    await entered;
    controller.abort();await rejected;
    await assert.rejects(refreshing!);
    assert.equal((await db.prepare("SELECT count(*) AS count FROM legal_source_observation_refresh_leases WHERE official_url=?").bind(url).first<{count:number}>())!.count,0);
  }finally{
    controller.abort();await db.prepare("DELETE FROM legal_source_observation_refresh_leases WHERE official_url=?").bind(url).run();await db.close();
  }
});

const anotherCandidate=(id:string)=>parseRevalidatedCandidates([{...candidate,
  provisionRenditionId:id,canonicalChunkId:`chunk:${id}`,provisionConceptId:`concept:${id}`,
  candidate:{...candidate.candidate,itemKey:`item:${id}`}}])[0]!;
function articleResolution(id:string,article="7") {
  const original=parseResolvedOfficialEvidence({...controlling,provisionRenditionId:id,
    provisionText:"An applicant may request a record.",officialCitation:{...controlling.officialCitation,label:`Synthetic rules — Article ${article}`},
    evidence:{...controlling.evidence,provisionRenditionId:id}});
  return {controlling:original,materialCitation:original.officialCitation,articleContext:{...original,
    provisionText:`Article ${article}. Records. An applicant may request a record. The application must identify the record.`,
    evidence:{...original.evidence,r2Key:`corpus/normalized/${article}`,sha256:original.evidence.sourceNormalizedSha256}}};
}

test("independent evidence reads overlap while ranked admission waits for the earlier source",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>Array.from({length:6},(_,index)=>anotherCandidate(`rendition:${index}`));
  let releaseFirst!:()=>void;
  const first=new Promise<void>(resolve=>{releaseFirst=resolve;});
  const started:string[]=[];
  services.evidenceResolver.resolveControlling=async id=>{
    started.push(id);
    if(id==="rendition:0")await first;
    return articleResolution(id,id.split(":")[1]!);
  };
  let completed=false;
  const pending=search(request).then(result=>{completed=true;return result;});
  try {
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(started.length>1,"An independent source must start while the first is pending");
    assert.ok(started.length<6,"Pending source reads must be bounded");
    assert.equal(completed,false);
  } finally {releaseFirst();}
  const result=await pending;
  assert.deepEqual(result.evidence.map(item=>item.source.article),["0","1","2","3","4","5"]);
  assert.deepEqual(result.needs,[]);
});

test("overlapping article fragments retain the first ranked canonical source despite reverse completion",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>[anotherCandidate("rendition:first"),anotherCandidate("rendition:later")];
  let releaseFirst!:()=>void;
  const first=new Promise<void>(resolve=>{releaseFirst=resolve;});
  services.evidenceResolver.resolveControlling=async id=>{
    if(id==="rendition:first")await first;
    return articleResolution(id);
  };
  const checked:string[]=[];
  const verify=services.verifyCurrentSource;
  services.verifyCurrentSource=async source=>{checked.push(source.provisionRenditionId);return verify(source);};
  const pending=search(request);
  await new Promise(resolve=>setImmediate(resolve));
  releaseFirst();
  const result=await pending;
  assert.equal(result.evidence.length,1);
  assert.deepEqual(checked,["rendition:first"]);
  const {services:baseline,search:baselineSearch}=fixture();
  baseline.candidateCatalog.revalidate=async()=>[anotherCandidate("rendition:first")];
  baseline.evidenceResolver.resolveControlling=async id=>articleResolution(id);
  assert.deepEqual(result.evidence,(await baselineSearch(request)).evidence);
});

test("a failed later source is retained as a gap and can retry after ordered reads finish",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>[anotherCandidate("rendition:0"),anotherCandidate("rendition:1")];
  let releaseFirst!:()=>void,fail=true;
  const first=new Promise<void>(resolve=>{releaseFirst=resolve;});
  services.evidenceResolver.resolveControlling=async id=>{
    if(id==="rendition:0")await first;
    if(id==="rendition:1"&&fail)throw new Error("Transient source failure");
    return articleResolution(id,id.split(":")[1]!);
  };
  const pending=search(request);
  await new Promise(resolve=>setImmediate(resolve));
  releaseFirst();
  const failed=await pending;
  assert.equal(failed.needs.length,1);
  assert.equal(failed.needs[0]!.reason,"source_unavailable");
  fail=false;
  const recovered=await search({...request,round:1,needs:failed.needs});
  assert.deepEqual(recovered.needs,[]);
  assert.deepEqual(recovered.evidence.map(item=>item.source.article),["0","1"]);
  assert.deepEqual(recovered.resolved?.map(item=>item.need),failed.needs);
});

test("cancellation stops all overlapping evidence reads before starting more or admitting sources",async()=>{
  const {services,search}=fixture();
  const controller=new AbortController();
  services.candidateCatalog.revalidate=async()=>Array.from({length:6},(_,index)=>anotherCandidate(`rendition:${index}`));
  let started=0,verified=0;
  services.evidenceResolver.resolveControlling=async()=>{
    started++;
    const signal=indexedRetrievalSignal()!;
    await new Promise<void>((_resolve,reject)=>{signal.addEventListener("abort",()=>reject(signal.reason),{once:true});});
    throw new Error("Aborted evidence read resumed");
  };
  const verify=services.verifyCurrentSource;
  services.verifyCurrentSource=async(...args)=>{verified++;return verify(...args);};
  const rejected=assert.rejects(search({...request,question:{...request.question,signal:controller.signal}}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(started>1&&started<6);
  const before=started;
  controller.abort();
  await rejected;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,before);
  assert.equal(verified,0);
});

test("rediscovering an article in a later round preserves canonical metadata despite a later clock",async()=>{
  const {services}=fixture();
  let time=Date.parse(instant),round=0;
  services.candidateCatalog.revalidate=async()=>[anotherCandidate(`rendition:${round++}`)];
  services.evidenceResolver.resolveControlling=async id=>articleResolution(id);
  const search=createCorpusResearch({services,formulate:async()=>interpretation,now:()=>time});
  const gap={reason:"missing_rule" as const,detail:"A different issue still needs a source."};
  let assessment=0;
  const result=await researchLegalQuestion(request.question,{indexed:async input=>{
    time+=1000;return search(input);
  },official:async()=>({evidence:[],needs:[]}),assess:async()=>++assessment<3?[gap]:
    {needs:[],resolved:assessment===3?[{need:gap,sourceIds:[(await search({...request,round:1})).evidence[0]!.source.id]}]:[]}});
  assert.equal(result.evidence.length,1);
  assert.equal(result.rounds,2);
  assert.deepEqual(result.needs,[]);
});

test("a retried authenticated article read closes its original gap through the research coordinator",async()=>{
  const {services,search}=fixture();
  let reads=0;
  services.evidenceResolver.resolveControlling=async id=>{
    const resolution=articleResolution(id);
    return ++reads===1?{...resolution,articleContext:undefined}:resolution;
  };
  const result=await researchLegalQuestion(request.question,{indexed:search,
    official:async()=>({evidence:[],needs:[]}),assess:async()=>[]});
  assert.equal(result.rounds,2);
  assert.equal(result.evidence.length,1);
  assert.deepEqual(result.needs,[]);
});

test("recovered explicit reference clears only the matching revision, language and endpoint gap",async()=>{
  const {services,search}=fixture();
  let calls=0;
  services.evidenceResolver.resolveControlling=async id=>{
    const resolution=articleResolution(id,id==="rendition:reference"?"12":"7");
    if(id!=="rendition:reference")resolution.articleContext.provisionText+=" Eligibility is governed by article 12 of this Act.";
    return resolution;
  };
  services.referenceDiscovery=async()=>++calls===1?{candidates:[],unresolved:[{reason:"reference_not_found",
    query:{article:"12",textRevisionId:controlling.textRevisionId,languageTag:"en"}}]}:
    {candidates:[anotherCandidate("rendition:reference")],unresolved:[]};
  const result=await researchLegalQuestion(request.question,{indexed:search,
    official:async()=>({evidence:[],needs:[]}),assess:async()=>[]});
  assert.equal(result.rounds,2);
  assert.equal(result.evidence.length,2);
  assert.deepEqual(result.needs,[]);
});

test("a large ranked pool cannot consume the read and context capacity reserved for explicit references",async()=>{
  const {services,search}=fixture();
  const readIds:string[]=[];
  services.candidateCatalog.revalidate=async()=>Array.from({length:48},(_,index)=>anotherCandidate(`rendition:${index}`));
  services.evidenceResolver.resolveControlling=async id=>{
    readIds.push(id);const resolution=articleResolution(id,id.split(":")[1]!);
    if(id==="rendition:0")resolution.articleContext.provisionText+=" Eligibility is governed by article 99 of this Act.";
    return resolution;
  };
  services.referenceDiscovery=async()=>({candidates:[anotherCandidate("rendition:99")],unresolved:[]});
  const result=await search(request);
  assert.equal(readIds.length,37);
  assert.ok(readIds.includes("rendition:99"));
  assert.ok(result.evidence.some(item=>item.source.article==="99"));
  assert.ok(result.observations?.some(item=>item.kind==="candidate_read_limit"));
  assert.ok(result.observations?.some(item=>item.kind==="candidate_context_limit"));
});

test("ordinary candidate saturation is visible to assessment without manufacturing a missing legal rule",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>Array.from({length:48},(_,index)=>anotherCandidate(`rendition:${index}`));
  services.evidenceResolver.resolveControlling=async id=>articleResolution(id,id.split(":")[1]!);
  const result=await researchLegalQuestion(request.question,{indexed:search,
    official:async()=>assert.fail("No missing coverage was assessed"),assess:async input=>{
      assert.ok(input.observations?.some(item=>item.kind==="candidate_read_limit"));return [];
    }});
  assert.equal(result.rounds,1);
  assert.deepEqual(result.needs,[]);
  assert.equal(result.evidence.length,24);
});

test("a required reference denied the bounded read allowance remains an explicit unresolved need",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>Array.from({length:36},(_,index)=>anotherCandidate(`rendition:${index}`));
  services.evidenceResolver.resolveControlling=async id=>articleResolution(id,id.split(":")[1]!);
  services.referenceDiscovery=async()=>({candidates:Array.from({length:13},(_,index)=>anotherCandidate(`rendition:${index+50}`)),unresolved:[]});
  const result=await search(request);
  assert.ok(result.needs.some(need=>need.reason==="unresolved_reference"&&need.detail.includes("rendition:62")));
  assert.ok(!result.evidence.some(item=>item.source.article==="62"));
});

test("a reference target already in the ranked pool retains priority before context admission",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>Array.from({length:36},(_,index)=>anotherCandidate(`rendition:${index}`));
  services.evidenceResolver.resolveControlling=async id=>{
    const resolution=articleResolution(id,id.split(":")[1]!);
    if(id==="rendition:0")resolution.articleContext.provisionText+=" Eligibility is governed by article 35 of this Act.";
    return resolution;
  };
  // The retained discovery service skips targets already found in this pool.
  services.referenceDiscovery=async()=>({candidates:[],unresolved:[]});
  const result=await search(request);
  assert.ok(result.evidence.some(item=>item.source.article==="35"));
});


test("publisher checks run only after deterministic context admission and never replace failed evidence",async()=>{
  const {services,search}=fixture();
  const candidates=parseRevalidatedCandidates(Array.from({length:3},(_,index)=>({...candidate,
    provisionRenditionId:`rendition:${index}`,candidate:{...candidate.candidate,itemKey:`item:${index}`,
      fusionScore:3-index}})));
  services.candidateCatalog.revalidate=async()=>candidates;
  services.evidenceResolver.resolveControlling=async id=>({controlling:parseResolvedOfficialEvidence({...controlling,
    provisionRenditionId:id,provisionText:id+"x".repeat(31_000)}),materialCitation:controlling.officialCitation});
  const checked:string[]=[];
  const verify=services.verifyCurrentSource;
  services.verifyCurrentSource=async source=>{
    checked.push(source.provisionRenditionId);
    if(source.provisionRenditionId==="rendition:0")throw new Error("Publisher unavailable");
    return verify(source);
  };
  const packet=await search(request);
  assert.deepEqual(checked,["rendition:0","rendition:1"]);
  assert.equal(packet.evidence.length,1);
  assert.ok(packet.evidence[0]!.text.startsWith("rendition:1"));
  assert.ok(packet.needs.some(need=>need.reason==="source_unavailable"));
  assert.deepEqual(packet.observations,[{kind:"candidate_context_limit",lane:"indexed",omitted:1}]);
});

test("admitted current evidence is withheld while its publisher check is pending",async()=>{
  const {services,search}=fixture();
  const entered=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
  const verify=services.verifyCurrentSource;
  services.verifyCurrentSource=async source=>{entered.resolve();await finish.promise;return verify(source);};
  let published=false;
  const result=search(request).then(packet=>{published=true;return packet;});
  await entered.promise;
  assert.equal(published,false);
  finish.resolve();
  assert.equal((await result).evidence.length,1);
});


test("references of an omitted primary cannot displace an independent formulation",async()=>{
  const {services}=fixture();
  const plan={...interpretation,formulations:[interpretation.formulations[0]!,
    {...interpretation.formulations[0]!,id:"query:two",text:"An independent requirement",requirementIds:["need:two"]}]};
  const primary=anotherCandidate("rendition:0"),independent=anotherCandidate("rendition:1");
  independent.candidate.formulationIds=["query:two"];
  services.candidateCatalog.revalidate=async()=>[primary,independent];
  services.evidenceResolver.resolveControlling=async id=>{
    const resolution=articleResolution(id,id.split(":")[1]!);
    resolution.articleContext.provisionText+=(id==="rendition:0"?" Conditions under article 99 of this Act. "+"x".repeat(40_000):
      id==="rendition:99"?"x".repeat(30_000):" The independent rule applies.");
    return resolution;
  };
  services.referenceDiscovery=async()=>({candidates:[anotherCandidate("rendition:99")],unresolved:[]});
  const result=await createCorpusResearch({services,formulate:async()=>plan,now:()=>Date.parse(instant)})(request);
  assert.deepEqual(result.evidence.map(item=>item.source.article),["1"]);
  assert.ok(result.needs.some(need=>need.reason==="context_budget"));
});

test("a wholly omitted connected group that fits alone remains a discovery observation",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>[anotherCandidate("rendition:0"),anotherCandidate("rendition:1")];
  services.evidenceResolver.resolveControlling=async id=>{
    const resolution=articleResolution(id,id.split(":")[1]!);
    resolution.articleContext.provisionText+=id==="rendition:0"?"x".repeat(40_000):
      id==="rendition:1"?" Conditions under article 99 of this Act. "+"x".repeat(15_000):"x".repeat(15_000);
    return resolution;
  };
  services.referenceDiscovery=async()=>({candidates:[anotherCandidate("rendition:99")],unresolved:[]});
  const result=await search(request);
  assert.deepEqual(result.evidence.map(item=>item.source.article),["0"]);
  assert.deepEqual(result.needs,[]);
  assert.deepEqual(result.observations,[{kind:"candidate_context_limit",lane:"indexed",omitted:1}]);
});

test("cyclic and shared references enter once with their primary rule",async()=>{
  const {services,search}=fixture();
  services.candidateCatalog.revalidate=async()=>[anotherCandidate("rendition:0"),anotherCandidate("rendition:1")];
  services.evidenceResolver.resolveControlling=async id=>{
    const resolution=articleResolution(id,id.split(":")[1]!);
    resolution.articleContext.provisionText+=" Conditions under article "+(id==="rendition:99"?"0":"99")+" of this Act.";
    return resolution;
  };
  services.referenceDiscovery=async()=>({candidates:[anotherCandidate("rendition:99")],unresolved:[]});
  const result=await search(request);
  assert.deepEqual(result.evidence.map(item=>item.source.article),["0","99","1"]);
  assert.deepEqual(result.needs,[]);
});
