import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {createQuestionInterpreter} from "../lib/legal-chat/question-model";
import {interpretLegalQuestion} from "../lib/legal-chat/question-context";

test("invalid speculative research does not discard a valid question interpretation",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const interpretation={topics:["Access to a private agreement"],facts:[],temporal:{kind:"current"},
    questions:["Please provide the agreement."]};
  let text="x".repeat(101);
  let omitResearch=false;
  context.mock.method(globalThis,"fetch",async()=>Response.json({output:[{content:[{type:"output_text",
    text:JSON.stringify({interpretation,...(omitResearch?{}:{research:{queries:[{text,topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]}]}})})}]}]}));
  const input={question:"What does my agreement allow?",locale:"en" as const,priorTurns:[]};
  const result=await interpretLegalQuestion(input,createQuestionInterpreter({mode:"fast",requestId:"invalid-plan"}));
  assert.equal(result.kind,"ready");
  if(result.kind!=="ready")throw Error("Expected validated interpretation");
  assert.deepEqual(result.questions,interpretation.questions);
  assert.equal(result.initialQueries,undefined,"ordinary research formulation must handle the missing proposal");
  text="private agreement access";
  const valid=await interpretLegalQuestion(input,createQuestionInterpreter({mode:"fast",requestId:"valid-plan"}));
  assert.equal(valid.kind,"ready");
  if(valid.kind==="ready")assert.equal(valid.initialQueries?.[0]?.text,text);
  omitResearch=true;
  const missing=await interpretLegalQuestion(input,createQuestionInterpreter({mode:"fast",requestId:"missing-plan"}));
  assert.equal(missing.kind,"ready");
  if(missing.kind==="ready")assert.equal(missing.initialQueries,undefined);
});

test("Fast plans research with interpretation while Deep retains its existing interpretation contract",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const interpretation={topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]};
  const queries=[{text:"record access",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]}];
  const input={question:"Can I request my record?",locale:"en" as const,priorTurns:[],now:new Date("2026-09-27T00:00:00Z")};
  const requests:{model:string;reasoning?:unknown;schema:string}[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    requests.push({model:body.model,reasoning:body.reasoning,schema:body.text.format.name});
    assert.doesNotMatch(body.instructions,/When assessing evidence|selectedSourceIds|supportedAnswerAvailable|Return queries: \[\]/,
      "Question planning must not receive the evidence assessment contract");
    assert.deepEqual(JSON.parse(body.input),{question:input.question,locale:"en",priorTurns:[],userContext:null,
      privateDocuments:[],legalContextDate:null,now:input.now.toISOString()});
    const output=body.text.format.name==="legal_question_research"?{interpretation,research:{queries}}:interpretation;
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  for(const mode of ["fast","deep"] as const) {
    const result=await interpretLegalQuestion(input,createQuestionInterpreter({mode,requestId:mode}));
    assert.equal(result.kind,"ready");
    if(result.kind!=="ready")throw Error("Expected ready");
    assert.deepEqual(result.initialQueries,mode==="fast"?queries:undefined);
  }
  assert.deepEqual(requests,[
    {model:"gpt-5.6-terra",reasoning:{effort:"low",mode:"standard"},schema:"legal_question_research"},
    {model:"gpt-5.6-terra",reasoning:undefined,schema:"legal_question_context"},
  ]);
});

test("discarded research proposals cannot bypass fact, selection or temporal validation",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const base={topics:["Record access","Review procedure"],facts:[],temporal:{kind:"current"},questions:[]};
  let interpretation:unknown=base;
  context.mock.method(globalThis,"fetch",async()=>Response.json({output:[{content:[{type:"output_text",
    text:JSON.stringify({interpretation,research:{queries:[{text:"record access",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]}]}})}]}]}));
  const input={question:"Can I access my record and request review?",locale:"en" as const,priorTurns:[]};
  const run=()=>interpretLegalQuestion(input,createQuestionInterpreter({mode:"fast",requestId:"partial-plan"}));
  const result=await run();
  assert.equal(result.kind,"ready");
  if(result.kind==="ready") {
    assert.deepEqual(result.topics,base.topics);
    assert.equal(result.initialQueries,undefined,"a plan missing a topic must be reformulated in full");
  }
  for(const invalid of [
    {...base,facts:[{turn:0,quotation:"I received a refusal."}]},
    {...base,selectedDocumentIds:["invented"]},
    {...base,selectedMemoryIds:["invented"]},
    {...base,temporal:{kind:"invented"}},
  ]) {
    interpretation=invalid;
    assert.equal((await run()).kind,"unavailable");
  }
  interpretation={...base,temporal:{kind:"unresolved"},questions:["Which date applies?"]};
  assert.deepEqual(await run(),{kind:"clarification_required",questions:["Which date applies?"]});
});
