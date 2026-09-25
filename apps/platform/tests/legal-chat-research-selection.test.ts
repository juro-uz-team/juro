import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {env} from "./helpers/runtime-env";
import {selectResearchEvidence} from "../lib/legal-chat/research-selection";
import type {ResearchRequest,ResearchPacket} from "../lib/legal-chat/research";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";
import {runIndexedRetrieval} from "../lib/runtime/indexed-retrieval";

const request:ResearchRequest={round:0,needs:[],question:{question:"What conditions govern a record request?",
  topics:["Record access","Exceptions"],locale:"en",mode:"fast",answerMode:"detailed",temporalScope:{kind:"current"}}};
function source(index:number,text=`Article ${index+1}. Complete unrelated rule.`):LegalEvidence {
  const textSha256=createHash("sha256").update(text).digest("hex");
  return {source:{id:`source:${index}`,actTitle:"Synthetic rules",article:String(index+1),actIdentifier:null,
    officialUrl:"https://lex.uz/docs/777",revisionDate:null,publishedAt:null,lastCheckedAt:"2026-09-25",locale:"en",
    sourceType:"lex",sourceClass:"OFFICIAL_LEGISLATION",status:"current",verificationState:"verified",
    verifiedAt:"2026-09-25",contentSha256:"a".repeat(64),citationEvidenceReceipt:{version:1,capability:"current",
      kind:"normalized-article",r2Key:"parent",byteCount:1024,sha256:"a".repeat(64),officialUrl:"https://lex.uz/docs/777",
      languageTag:"en",articleNumber:String(index+1),textSha256}},text,
    textSha256,endpoint:{kind:"current"},origin:"indexed"};
}

test("selection preserves complete connected context, all topics and operational gaps",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const evidence=Array.from({length:10},(_,index)=>source(index));
  evidence[0]=source(0,"An applicant may request a record subject to Article 9 of this Code.");
  const outage={reason:"source_unavailable" as const,detail:"One publisher was unavailable."};
  const packet:ResearchPacket={evidence,needs:[outage],resolved:[{need:{reason:"missing_rule",detail:"Another rule"},sourceIds:["source:5"]}]};
  const seen:number[][]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.input);
    assert.equal(body.model,"gpt-6-luna");assert.deepEqual(body.reasoning,{effort:"none"});
    assert.deepEqual(payload.topics,request.question.topics);
    assert.ok(payload.primarySourceIndices.length<=8);assert.ok(payload.evidence.length<=24);
    if(payload.primarySourceIndices.includes(0))assert.ok(payload.evidence.some((s:{sourceIndex:number})=>s.sourceIndex===8));
    if(payload.primarySourceIndices.includes(8))assert.ok(payload.evidence.some((s:{sourceIndex:number})=>s.sourceIndex===0));
    seen.push(payload.primarySourceIndices);
    return Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify({
      decisions:payload.primarySourceIndices.map((sourceIndex:number)=>({sourceIndex,relevant:sourceIndex===0,reason:"Scope assessed from complete rule."}))})}]}]});
  });
  const result=await selectResearchEvidence(request,packet,{requestId:"selection"});
  assert.equal(seen.length,2);assert.deepEqual(result.evidence,[evidence[0],evidence[8]]);
  assert.deepEqual(result.needs,[outage]);assert.deepEqual(result.resolved,[]);
  assert.deepEqual(result.selection?.find(item=>item.sourceId==="source:8"),{
    sourceId:"source:8",relevant:false,retained:true,reason:"Scope assessed from complete rule."});
});

test("duplicate, missing and invented selection decisions fail rather than choosing a prefix",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let indices=[0,0];
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify({
    decisions:indices.map(sourceIndex=>({sourceIndex,relevant:true,reason:"Required rule."}))})}]}]}));
  for(const invalid of [[0,0],[0],[0,2]]) {
    indices=invalid;
    await assert.rejects(selectResearchEvidence(request,{evidence:[source(0),source(1)],needs:[]},{requestId:"invalid"}));
  }
});

test("relevance never conceals forged or oversized evidence and cancellation prevents provider work",async context=>{
  context.mock.method(globalThis,"fetch",async()=>assert.fail("Invalid evidence cannot reach selection"));
  const original=source(0);
  await assert.rejects(selectResearchEvidence(request,{evidence:[{...original,text:"Tampered"}],needs:[]},{requestId:"forged"}),/TEXT_HASH/);
  await assert.rejects(selectResearchEvidence(request,{evidence:[source(0,"x".repeat(64001))],needs:[]},{requestId:"oversized"}),/CONTEXT_EXCEEDED/);
  await assert.rejects(selectResearchEvidence({...request,question:{...request.question,signal:AbortSignal.abort()}},
    {evidence:[original],needs:[]},{requestId:"cancelled"}));
});

test("a reference cannot connect a different temporal endpoint or language",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const evidence=[source(0,"The conditions are in Article 2 of this Code."),
    {...source(1),source:{...source(1).source,locale:"ru",citationEvidenceReceipt:{...source(1).source.citationEvidenceReceipt!,languageTag:"ru" as const}}},
    {...source(2),source:{...source(2).source,article:"2",status:"historical" as const,
      citationEvidenceReceipt:{...source(2).source.citationEvidenceReceipt!,capability:"history" as const,articleNumber:"2"}},
      endpoint:{kind:"timestamp" as const,instant:"2020-01-01T00:00:00Z"}}];
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify({
    decisions:[0,1,2].map(sourceIndex=>({sourceIndex,relevant:sourceIndex===0,reason:"Scope assessed."}))})}]}]}));
  const result=await selectResearchEvidence({...request,question:{...request.question,temporalScope:{kind:"comparison",
    left:evidence[2]!.endpoint,right:{kind:"current"}}}},{evidence,needs:[]},{requestId:"endpoints"});
  assert.deepEqual(result.evidence,[evidence[0]]);
});

test("identical URL and endpoint cannot join references across authenticated parent snapshots",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const first=source(0,"The conditions are in Article 2 of this Code."),other=source(1);
  other.source={...other.source,contentSha256:"b".repeat(64),citationEvidenceReceipt:{
    ...other.source.citationEvidenceReceipt!,r2Key:"another-parent",sha256:"b".repeat(64)}};
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify({
    decisions:[0,1].map(sourceIndex=>({sourceIndex,relevant:sourceIndex===0,reason:"Scope assessed."}))})}]}]}));
  const result=await selectResearchEvidence(request,{evidence:[first,other],needs:[]},{requestId:"revisions"});
  assert.deepEqual(result.evidence,[first]);
});

test("selection consumes the remaining indexed deadline and cancels provider work",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.timers.enable({apis:["setTimeout"]});
  const retrieved=Promise.withResolvers<void>(),started=Promise.withResolvers<void>();
  let providerSignal:AbortSignal|undefined,failure:unknown;
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    providerSignal=init?.signal??undefined;started.resolve();
    return new Promise<Response>((_resolve,reject)=>providerSignal!.addEventListener("abort",()=>reject(providerSignal!.reason),{once:true}));
  });
  const pending=runIndexedRetrieval(undefined,async signal=>{
    await retrieved.promise;
    return selectResearchEvidence({...request,question:{...request.question,signal}},
      {evidence:[source(0)],needs:[]},{requestId:"deadline"});
  }).catch(error=>{failure=error;});
  context.mock.timers.tick(6000);retrieved.resolve();await started.promise;
  context.mock.timers.tick(4000);await pending;
  assert.ok(failure instanceof DOMException&&failure.name==="TimeoutError");
  assert.equal(providerSignal?.aborted,true);
});
