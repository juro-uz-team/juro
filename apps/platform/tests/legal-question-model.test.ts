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
  let text="x".repeat(901);
  let omitResearch=false;
  context.mock.method(globalThis,"fetch",async()=>Response.json({output:[{content:[{type:"output_text",
    text:JSON.stringify({interpretation,...(omitResearch?{}:{research:{directQueries:[{text,topicIndices:[0]}],underlyingRuleQueries:[]}})})}]}]}));
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
  for(const length of [102,900]) {
    text="private agreement access ".padEnd(length,"x");
    const indexed=await interpretLegalQuestion(input,createQuestionInterpreter({mode:"fast",requestId:"indexed-plan"}));
    assert.equal(indexed.kind,"ready");
    if(indexed.kind==="ready")assert.equal(indexed.initialQueries?.[0]?.text,text,
      "Indexed queries must survive unchanged beyond the public publisher's 100-character limit");
  }
  omitResearch=true;
  const missing=await interpretLegalQuestion(input,createQuestionInterpreter({mode:"fast",requestId:"missing-plan"}));
  assert.equal(missing.kind,"ready");
  if(missing.kind==="ready")assert.equal(missing.initialQueries,undefined);
});



test("discarded research proposals cannot bypass fact, selection or temporal validation",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const base={topics:["Record access","Review procedure"],facts:[],temporal:{kind:"current"},questions:[]};
  let interpretation:unknown=base;
  context.mock.method(globalThis,"fetch",async()=>Response.json({output:[{content:[{type:"output_text",
    text:JSON.stringify({interpretation,research:{directQueries:[{text:"record access",topicIndices:[0]}],underlyingRuleQueries:[]}})}]}]}));
  const input={question:"Can I access my record and request review?",locale:"en" as const,priorTurns:[]};
  const run=()=>interpretLegalQuestion(input,createQuestionInterpreter({mode:"fast",requestId:"partial-plan"}));
  const result=await run();
  assert.equal(result.kind,"ready");
  if(result.kind==="ready") {
    assert.deepEqual(result.topics,base.topics);
    assert.equal(result.initialQueries,undefined,"a plan missing a topic must be reformulated in full");
  }
  interpretation={...base,facts:[{turn:0,quotation:"I received a refusal."}]};
  const unmatched=await run();
  assert.equal(unmatched.kind,"ready");
  if(unmatched.kind!=="ready")throw Error("Expected original question");
  assert.deepEqual(unmatched.caseFacts,[]);
  assert.equal(unmatched.question,input.question);
  for(const invalid of [
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


test("combined interpretation stages closed queries before the final provider response",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const interpretation={topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]};
  const first={text:"record access ".padEnd(102,"x"),topicIndices:[0]},second={text:"review procedure",topicIndices:[0]};
  const firstStaged=Promise.withResolvers<void>();let completed=false;
  const prefix=JSON.stringify({interpretation}).slice(0,-1)+',"research":{"directQueries":['+JSON.stringify(first)+',';
  const tail=JSON.stringify(second)+'],"underlyingRuleQueries":[]}}';
  const encoder=new TextEncoder();
  const event=(type:string,value:object)=>encoder.encode(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    assert.equal(JSON.parse(String(init?.body)).stream,true);
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(event("response.output_text.delta",{delta:prefix}));
      void firstStaged.promise.then(()=>{
        controller.enqueue(event("response.output_text.delta",{delta:tail}));completed=true;
        controller.enqueue(event("response.completed",{response:{id:"response",status:"completed",
          output:[{content:[{type:"output_text",text:prefix+tail}]}]}}));controller.close();
      });
    }}),{headers:{"content-type":"text/event-stream"}});
  });
  const sizes:number[]=[];
  const result=await interpretLegalQuestion({question:"Can I request a record?",locale:"en",priorTurns:[]},
    createQuestionInterpreter({mode:"fast",requestId:"stream",initialResearch:{discard:async()=>assert.fail("Valid plan discarded"),
      stage:async({context,queries})=>{assert.equal(context.kind,"ready");sizes.push(queries.length);
        if(queries.length===1){assert.equal(completed,false);firstStaged.resolve();}}}}));
  assert.deepEqual(sizes,[1,2]);assert.equal(result.kind,"ready");
  if(result.kind==="ready")assert.deepEqual(result.initialQueries?.map(query=>query.text),[first.text,second.text]);
});

test("changed final interpretation or query discards speculative work but retains validated final intent",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const interpretation={topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]};
  const first={text:"record access",topicIndices:[0]};
  let change:"interpretation"|"query"="interpretation",discarded=0,staged=0;
  context.mock.method(globalThis,"fetch",async()=>{
    const initial={interpretation,research:{directQueries:[first],underlyingRuleQueries:[]}};
    const final=change==="interpretation"?{...initial,interpretation:{...interpretation,topics:["Review procedure"]}}
      :{...initial,research:{...initial.research,directQueries:[{...first,text:"changed query"}]}};
    const event=(type:string,value:object)=>`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
    return new Response(event("response.output_text.delta",{delta:JSON.stringify(initial)})+
      event("response.completed",{response:{id:"response",status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(final)}]}]}}),
      {headers:{"content-type":"text/event-stream"}});
  });
  for(change of ["interpretation","query"] as const){
    const result=await interpretLegalQuestion({question:"May I request review?",locale:"en",priorTurns:[]},
      createQuestionInterpreter({mode:"fast",requestId:change,initialResearch:{stage:async()=>{staged++;},discard:async()=>{discarded++;}}}));
    assert.equal(result.kind,"ready");
  }
  assert.equal(staged,2);assert.equal(discarded,2);
});
