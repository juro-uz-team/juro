import assert from "node:assert/strict";
import test from "node:test";
import {privateDocumentContext} from "./helpers/private-document-context";
import {env} from "./helpers/runtime-env";
import {createLegalResearchModel} from "../lib/legal-chat/research-model";
import type {ResearchRequest} from "../lib/legal-chat/research";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";

const query={text:"record access",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]};
const request:ResearchRequest={round:0,needs:[{reason:"missing_rule",detail:"The eligibility condition is missing."}],
  question:{question:"How can I request a record?",topics:["Record access"],locale:"en",mode:"fast",
    answerMode:"detailed",temporalScope:{kind:"current"}}};
const evidence:LegalEvidence={source:{id:"source:one",actTitle:"Synthetic rules",actIdentifier:null,
  officialUrl:"https://lex.uz/docs/777",revisionDate:null,lastCheckedAt:"2026-09-20",locale:"en",publishedAt:null,
  sourceType:"lex",status:"current",verificationState:"verified",verifiedAt:"2026-09-20",contentSha256:"private-parent-hash"},
  text:"A qualifying applicant may request the record.",textSha256:"private-text-hash",endpoint:{kind:"current"},origin:"indexed"};

test("research pins Luna/Terra, reuses assessment queries and excludes source locators from model context",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const payloads:Array<{model:string;input:string}> = [];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));payloads.push(body);
    const assessment=JSON.parse(body.input).evidence.length>0;
    const output=assessment?{needs:[],resolved:[{needIndex:0,sourceIds:["source:one"]}],
      queries:[{...query,text:"eligibility of a record applicant"}]}:{queries:[query]};
    return Response.json({id:"response",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  for(const mode of ["fast","deep"] as const) {
    const model=createLegalResearchModel({requestId:"request"});
    const input={...request,question:{...request.question,mode,documents:[privateDocumentContext()]}};
    await model.formulate(input);
    await model.formulate(input);
    const assessment=await model.assess({...input,evidence:[evidence]});
    assert.deepEqual(assessment.resolved,[{need:request.needs[0],sourceIds:["source:one"]}]);
    const next=await model.formulate({...input,round:1});
    assert.equal(next.formulations[0]!.text,"eligibility of a record applicant");
  }
  assert.deepEqual(payloads.map(value=>value.model),["gpt-5.6-luna","gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-terra"]);
  for(const payload of payloads) {
    assert.ok(!payload.input.includes("private-parent-hash"));
    assert.ok(!payload.input.includes("private-text-hash"));
    assert.ok(!payload.input.includes("https://lex.uz"));
    assert.deepEqual(JSON.parse(payload.input).privateDocuments,[{id:privateDocumentContext().source.id,
      title:"Uploaded agreement",text:privateDocumentContext().text}]);
    assert.doesNotMatch(payload.input,/juro-private:|private-object-checksum/);
  }
});

test("research rejects fabricated resolution source IDs and operational-gap approvals",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let sourceId="invented";
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{
    type:"output_text",text:JSON.stringify({needs:[],resolved:[{needIndex:0,sourceIds:[sourceId]}],queries:[query]})}]}]}));
  await assert.rejects(createLegalResearchModel({requestId:"request"}).assess({...request,evidence:[evidence]}),/RESOLUTION_INVALID/);
  sourceId="source:one";
  await assert.rejects(createLegalResearchModel({requestId:"request"}).assess({...request,
    needs:[{reason:"source_unavailable",detail:"The source reader failed."}],evidence:[evidence]}),/RESOLUTION_INVALID/);
});

test("initial formulations must account for every independent topic",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{
    type:"output_text",text:JSON.stringify({queries:[query]})}]}]}));
  await assert.rejects(createLegalResearchModel({requestId:"request"}).formulate({...request,
    question:{...request.question,topics:["Record access","A separate remedy"]}}),/TOPIC_MISSING/);
});

test("oversized model context fails before transport without truncating supplied sources",async()=>{
  await assert.rejects(createLegalResearchModel({requestId:"request"}).assess({...request,
    evidence:[{...evidence,text:"x".repeat(200_001)}]}),/CONTEXT_EXCEEDED/);
});

test("the model cannot invent a source outage or budget exhaustion",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{
    type:"output_text",text:JSON.stringify({needs:[{reason:"source_unavailable",detail:"Invented outage."}],resolved:[],queries:[query]})}]}]}));
  await assert.rejects(createLegalResearchModel({requestId:"request"}).assess({...request,evidence:[evidence]}));
});


test("research planning and coverage receive the selected private context with rejection labels",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const userContext={confirmedFacts:["A material confirmed circumstance"],rejectedFacts:["A rejected older circumstance"],
    memories:[{id:"selected",category:"legal_context" as const,statement:"A selected relevant private memory"}]};
  const payloads:unknown[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);payloads.push(input.userContext);
    const output=input.evidence.length?{needs:[],resolved:[],queries:[query]}:{queries:[query]};
    return Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  const model=createLegalResearchModel({requestId:"context"}),input={...request,question:{...request.question,userContext}};
  await model.formulate(input);await model.assess({...input,evidence:[evidence]});
  assert.deepEqual(payloads,[userContext,userContext]);
  await assert.rejects(model.formulate({...input,question:{...input.question,userContext:{...userContext,rejectedFacts:[]}}}),/RESEARCH_MODEL_REQUEST_MISMATCH/);
});
