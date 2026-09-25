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

test("planner and assessment generation admit only actual topic indices",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let invalid=false;
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    assert.deepEqual(body.text.format.schema.properties.queries.items.properties.topicIndices.items.enum,[0,1]);
    const queries=[{...query,topicIndices:invalid?[0,1,2]:[0,1]}];
    const output=body.text.format.name==="legal_research_coverage"?{needs:[],resolved:null,queries}
      :{queries:body.text.format.name==="legal_indexed_queries"?queries.map(({text,topicIndices})=>({text,topicIndices})):queries};
    return Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  const input={...request,question:{...request.question,topics:["Access","Remedy"]}};
  for(const method of ["formulate","formulateIndexed","assess"] as const) {
    const invoke=()=>createLegalResearchModel({requestId:method})[method]({...input,evidence:[]});
    invalid=false;await invoke();
    invalid=true;await assert.rejects(invoke(),/RESEARCH_QUERY_TOPIC_INVALID/);
  }
});

test("public repair replans oversized queries while indexed repair preserves their complete text",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const longQuery={...query,text:"record access conditions and qualifications ".repeat(4).trim()};
  const calls:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));calls.push(body.text.format.name);
    if(body.text.format.name==="legal_research_queries")assert.deepEqual(JSON.parse(body.input).indexedFormulations,[longQuery]);
    const output=body.text.format.name==="legal_research_coverage"?{needs:[],resolved:null,queries:[longQuery]}:{queries:[query]};
    return Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  const model=createLegalResearchModel({requestId:"public-repair"});
  await model.assess({...request,evidence:[]});
  assert.equal((await model.formulate(request)).formulations[0]!.text,query.text);
  assert.equal((await model.formulateIndexed(request)).formulations[0]!.text,longQuery.text);
  assert.deepEqual(calls,["legal_research_coverage","legal_research_queries"]);
});

test("public formulations reject overlong provider output without truncating it",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{
    type:"output_text",text:JSON.stringify({queries:[{...query,text:"x".repeat(101)}]})}]}]}));
  await assert.rejects(createLegalResearchModel({requestId:"public-limit"}).formulate(request));
});

test("standalone initial research preserves the complete question and every interpreted topic without another model call",async context=>{
  context.mock.method(globalThis,"fetch",async()=>{throw new Error("Standalone formulation must not call a provider");});
  const question="Can an applicant inspect a record and challenge a refusal as of 2020-01-01?";
  const input:ResearchRequest={round:0,needs:[],question:{...request.question,question,
    topics:["Inspection of a record","Challenging a refusal"],caseFacts:[],priorTurns:[],
    temporalScope:{kind:"timestamp",instant:"2020-01-01T00:00:00.000Z"}}};
  const plan=await createLegalResearchModel({requestId:"standalone"}).formulateIndexed(input);
  assert.deepEqual(plan.formulations.map(item=>item.text),[question,...input.question.topics]);
  assert.deepEqual(plan.formulations[0]!.requirementIds,["topic:0","topic:1"]);
  assert.deepEqual(plan.formulations.slice(1).map(item=>item.requirementIds),[["topic:0"],["topic:1"]]);
});

test("contextual and oversized initial questions retain generative decomposition without truncation",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const inputs:Array<Record<string,unknown>>=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.input);inputs.push(payload);
    return Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify({queries:[{
      text:query.text,topicIndices:payload.topics.map((_:string,index:number)=>index)}]})}]}]});
  });
  const variants:ResearchRequest["question"][]=[
    {...request.question,priorTurns:[{question:"My earlier issue",answer:"Unverified prior answer"}]},
    {...request.question,documents:[privateDocumentContext()]},
    {...request.question,caseFacts:["A fact absent from the current question"]},
    {...request.question,question:"A".repeat(901)},
    {...request.question,topics:Array.from({length:20},(_,index)=>`Topic ${index}`)},
  ];
  for(const question of variants) await createLegalResearchModel({requestId:"contextual"}).formulateIndexed({round:0,needs:[],question});
  assert.equal(inputs.length,variants.length);
  assert.equal(inputs[3]!.question,"A".repeat(901));
  assert.deepEqual(inputs[4]!.topics,variants[4]!.topics);
  assert.deepEqual(inputs[0]!.priorTurns,variants[0]!.priorTurns);
});

test("streamed planning emits a closed formulation before completion and preserves escaped query text",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const firstEmitted=Promise.withResolvers<void>();
  const first={topicIndices:query.topicIndices,text:'procedure for a "record [request]" and \\ reference'};
  const second={topicIndices:query.topicIndices,text:"record refusal qualification"};
  const prefix='{"queries":['+JSON.stringify(first),tail=','+JSON.stringify(second)+']}';
  const encoder=new TextEncoder();let completed=false;
  const event=(type:string,value:Record<string,unknown>)=>encoder.encode(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    assert.equal(JSON.parse(String(init?.body)).stream,true);
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(event("response.output_text.delta",{delta:prefix.slice(0,25)}));
      controller.enqueue(event("response.output_text.delta",{delta:prefix.slice(25)}));
      void firstEmitted.promise.then(()=>{
        controller.enqueue(event("response.output_text.delta",{delta:tail}));
        completed=true;
        controller.enqueue(event("response.completed",{response:{id:"response",status:"completed",
          output:[{content:[{type:"output_text",text:prefix+tail}]}]}}));controller.close();
      });
    }}),{headers:{"content-type":"text/event-stream"}});
  });
  const fragments:string[]=[];
  const pending=createLegalResearchModel({requestId:"stream"}).formulateIndexed(request,async fragment=>{
    fragments.push(fragment.formulation.text);
    if(fragments.length===1){assert.equal(completed,false);firstEmitted.resolve();}
  });
  const result=await pending;
  assert.deepEqual(fragments,[first.text,second.text]);
  assert.deepEqual(result.formulations.map(item=>item.text),fragments);
});

test("streamed planning rejects staging and partial validation failures despite a valid final response",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let invalidPartial=false;
  const indexedQuery={text:query.text,topicIndices:query.topicIndices};
  context.mock.method(globalThis,"fetch",async()=>{
    const event=(type:string,value:Record<string,unknown>)=>`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
    const text=JSON.stringify({queries:[indexedQuery]});
    return new Response(event("response.output_text.delta",{delta:JSON.stringify({queries:[invalidPartial?{...indexedQuery,topicIndices:[23]}:indexedQuery]})})+
      event("response.completed",{response:{id:"response",status:"completed",output:[{content:[{type:"output_text",text}]}]}}),
      {headers:{"content-type":"text/event-stream"}});
  });
  await assert.rejects(createLegalResearchModel({requestId:"stage-failure"}).formulateIndexed(request,async()=>{
    throw new Error("stage unavailable");
  }),/stage unavailable/);
  invalidPartial=true;
  await assert.rejects(createLegalResearchModel({requestId:"partial-failure"}).formulateIndexed(request,async()=>{}),/RESEARCH_QUERY_TOPIC_INVALID/);
});

test("research pins Luna/Terra, reuses assessment queries and excludes source locators from model context",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const payloads:Array<{model:string;input:string}> = [];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));payloads.push(body);
    const assessment=JSON.parse(body.input).evidence.length>0;
    assert.deepEqual(body.reasoning,body.model==="gpt-6-luna"?{effort:"none"}:undefined);
    const output=assessment?{needs:[],resolved:[{needIndex:0,sourceIndices:[0]}],
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
  assert.deepEqual(payloads.map(value=>value.model),["gpt-6-luna","gpt-5.6-terra","gpt-5.6-terra","gpt-5.6-terra"]);
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
  let sourceIndex=99;
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{
    type:"output_text",text:JSON.stringify({needs:[],resolved:[{needIndex:0,sourceIndices:[sourceIndex]}],queries:[query]})}]}]}));
  await assert.rejects(createLegalResearchModel({requestId:"request"}).assess({...request,evidence:[evidence]}),/RESOLUTION_INVALID/);
  sourceIndex=0;
  await assert.rejects(createLegalResearchModel({requestId:"request"}).assess({...request,
    needs:[{reason:"source_unavailable",detail:"The source reader failed."}],evidence:[evidence]}),/RESOLUTION_INVALID/);
});

test("coverage generation offers only substantive needs and admitted source IDs as resolutions",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const schemas:Array<Record<string,any>>=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));schemas.push(body.text.format.schema.properties.resolved);
    return Response.json({id:"response",output:[{content:[{type:"output_text",
      text:JSON.stringify({needs:[],resolved:schemas.at(-1)!.type==="null"?null:[],queries:[query]})}]}]});
  });
  const outage={reason:"source_unavailable" as const,detail:"The source reader failed."};
  await createLegalResearchModel({requestId:"mixed"}).assess({...request,
    needs:[outage,request.needs[0]!,{reason:"unresolved_reference",detail:"The exception is missing."}],evidence:[evidence]});
  assert.deepEqual(schemas[0]!.items.properties.needIndex.enum,[1,2]);
  assert.equal(schemas[0]!.items.properties.sourceIndices.items.const,0);
  await createLegalResearchModel({requestId:"outage"}).assess({...request,needs:[outage],evidence:[evidence]});
  await createLegalResearchModel({requestId:"empty"}).assess({...request,evidence:[]});
  assert.equal(schemas[1]!.type,"null");assert.equal(schemas[2]!.type,"null");
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


test("compact indexed plans cannot seed public discovery without private-name classification",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const schemas:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),name=body.text.format.name;schemas.push(name);
    const planned=name==="legal_indexed_queries"?{text:"Alice Example record access",topicIndices:[0]}
      :{...query,text:"Alice Example record access",privateNameSpans:["Alice Example"]};
    return Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify({queries:[planned]})}]}]});
  });
  const model=createLegalResearchModel({requestId:"separate-discovery"});
  const indexed=await model.formulateIndexed(request);
  const publicPlan=await model.formulate(request);
  assert.deepEqual(schemas,["legal_indexed_queries","legal_research_queries"]);
  assert.deepEqual(indexed.formulations[0]!.privateNameSpans,[]);
  assert.deepEqual(publicPlan.formulations[0]!.privateNameSpans,["Alice Example"]);
});

test("compact indexed planning rejects omitted interpreted topics",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",output:[{content:[{
    type:"output_text",text:JSON.stringify({queries:[{text:query.text,topicIndices:[0]}]})}]}]}));
  await assert.rejects(createLegalResearchModel({requestId:"indexed-topic-gap"}).formulateIndexed({
    ...request,question:{...request.question,topics:["Record access","Challenging refusal"]}}),/RESEARCH_QUERY_TOPIC_MISSING/);
});
