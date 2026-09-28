import assert from "node:assert/strict";
import test from "node:test";
import {privateDocumentContext} from "./helpers/private-document-context";
import {env} from "./helpers/runtime-env";
import {createLegalResearchModel} from "../lib/legal-chat/research-model";
import type {ResearchRequest} from "../lib/legal-chat/research";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";

const query={text:"record access",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]};

test("bounded Fast assessment returns a provisional issue draft with canonical citations",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const source={...evidence,source:{...evidence.source,id:"authenticated-source-with-long-canonical-identity"}};
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.text.format.name,"legal_research_answer");
    assert.equal(body.model,"gpt-6-luna");
    const payload=JSON.parse(body.input);assert.equal(payload.evidence[0].text,source.text);
    assert.equal(payload.answerMode,"short");
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
      assessment:{selectedSourceIds:["s0"],supportedAnswerAvailable:true,needs:[],resolved:null,queries:[]},
      draft:{answer:{issues:[{finding:{title:"Access",explanation:"Applicants may request their record.",sourceIds:["s0"]},
        actions:[{title:"Request",instruction:"Ask for your record.",sourceIds:["s0"]}]}],
        risks:[],questions:[],unresolved:[],mainPoint:{text:"You may request your record.",sourceIds:["s0"]}}},
    })}]}]});
  });
  const result=await createLegalResearchModel({requestId:"combined",draftDuringAssessment:true}).assess({
    ...request,needs:[],question:{...request.question,mode:"fast",answerMode:"short"},evidence:[source],
  });
  assert.deepEqual(result.selectedSourceIds,[source.source.id]);
  assert.deepEqual(result.provisionalDraft?.mainPoint.sourceIds,[source.source.id]);
  assert.deepEqual(result.provisionalDraft?.ruleBindings,[{findingId:"finding:0",actionIds:["action:0"]}]);
  assert.equal(result.provisionalDraft?.actions[0]?.description,"Ask for your record.");
});

test("research drafting never expands the answer context budget to the larger selection budget",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.text.format.name,"legal_research_coverage");
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
      selectedSourceIds:[evidence.source.id],supportedAnswerAvailable:true,needs:[],resolved:null,queries:[],
    })}]}]});
  });
  const result=await createLegalResearchModel({requestId:"large-selection",draftDuringAssessment:true}).assess({
    ...request,needs:[],question:{...request.question,mode:"fast"},evidence:[{...evidence,text:"a".repeat(64001)}],
  });
  assert.equal(result.provisionalDraft,undefined);
});

test("an invalid combined draft does not discard a valid research assessment",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async()=>Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
    assessment:{selectedSourceIds:[evidence.source.id],supportedAnswerAvailable:true,needs:[],resolved:null,queries:[]},
    draft:{answer:{mainPoint:{text:"An unsupported citation",sourceIds:["invented"]},issues:[],risks:[],questions:[],unresolved:[]}},
  })}]}]}));
  const result=await createLegalResearchModel({requestId:"invalid-proposal",draftDuringAssessment:true}).assess({
    ...request,needs:[],question:{...request.question,mode:"fast"},evidence:[evidence],
  });
  assert.deepEqual(result.selectedSourceIds,[evidence.source.id]);
  assert.equal(result.provisionalDraft,undefined);
});

test("a bound research model rejects a changed initial plan for the same question",async()=>{
  const question={...request.question,initialQueries:[query]};
  const model=createLegalResearchModel({requestId:"initial-plan-owner"});
  await model.formulateIndexed({...request,needs:[],question});
  await assert.rejects(model.formulateIndexed({...request,needs:[],question:{...question,
    initialQueries:[{...query,text:"different record review"}]}}),/RESEARCH_MODEL_REQUEST_MISMATCH/);
});

test("initial contextual queries stay indexed while public discovery and repair retain their own plans",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const first={...request,needs:[],question:{...request.question,priorTurns:[{question:"My name is Ada.",answer:"Unverified prior answer"}],
    documents:[privateDocumentContext()],initialQueries:[{...query,text:"Ada record access",privateNameSpans:["Ada"]}]}};
  let calls=0;
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    calls++;
    const body=JSON.parse(String(init?.body));
    const output=body.text.format.name==="legal_research_coverage"
      ?{needs:[],resolved:[],queries:[{...query,text:"record review procedure"}],supportedAnswerAvailable:false}
      :{queries:[{...query,text:"public record access"}]};
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  const model=createLegalResearchModel({requestId:"contextual-initial"});
  const indexed=await model.formulateIndexed(first);
  assert.deepEqual(indexed.formulations.map(item=>item.text),["Ada record access"]);
  assert.equal(calls,0,"Validated initial context needs no second provider formulation");
  assert.deepEqual((await model.formulate(first)).formulations.map(item=>item.text),["public record access"]);
  assert.equal(calls,1,"Public discovery must perform its independent formulation");
  await model.assess({...first,evidence:[evidence]});
  assert.deepEqual((await model.formulateIndexed({...first,round:1})).formulations.map(item=>item.text),["record review procedure"]);
  const controller=new AbortController();controller.abort();
  await assert.rejects(createLegalResearchModel({requestId:"aborted-initial"}).formulateIndexed({...first,
    question:{...first.question,signal:controller.signal}}),{name:"AbortError"});
});

test("repair assessment receives earlier formulations without treating unissued proposals as searches",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const histories:unknown[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
    histories.push(input.priorFormulations);
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
      needs:[],resolved:[],queries:[query],supportedAnswerAvailable:false,
    })}]}]});
  });
  const initial={...request,needs:[]};
  const model=createLegalResearchModel({requestId:"query-history"});
  await model.formulateIndexed(initial);
  await model.assess({...initial,evidence:[evidence]});
  await model.assess({...initial,evidence:[evidence]});
  const repair={...request,round:1};
  await model.formulateIndexed(repair);
  await model.assess({...repair,evidence:[evidence]});
  await createLegalResearchModel({requestId:"separate-query-history"}).assess({...initial,evidence:[evidence]});
  const seeded=[{round:0,lane:"indexed",queries:[request.question.question,...request.question.topics]}];
  assert.deepEqual(histories,[seeded,seeded,[...seeded,{round:1,lane:"indexed",queries:[query.text]}],[]]);
});

test("compact coverage references normalize repeated identities after decoding",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const canonical="corpus:"+"a".repeat(64);
  const sources=[{...evidence,source:{...evidence.source,id:"s0"}},
    {...evidence,source:{...evidence.source,id:canonical},text:`Literal ${canonical} is unchanged evidence text.`}];
  let duplicate=false;
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
    assert.equal(input.mode,"fast");
    assert.deepEqual(body.prompt_cache_options,{mode:"explicit"},"Unique assessment inputs must not incur unused automatic cache writes");
    assert.deepEqual(input.evidence.map((item:{id:string})=>item.id),["s0","s1"]);
    assert.equal(input.evidence[1].text,sources[1]!.text);
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
      needs:[],queries:[],supportedAnswerAvailable:true,
      selectedSourceIds:duplicate?["s1",canonical,"s1"]:["s0","s1"],
      resolved:[{needIndex:0,sourceIds:["s1"]}],
    })}]}]});
  });
  const assess=()=>createLegalResearchModel({requestId:"compact-research"}).assess({...request,evidence:sources});
  const result=await assess();
  assert.deepEqual(result.selectedSourceIds,["s0",canonical]);
  assert.deepEqual(result.resolved,[{need:request.needs[0],sourceIds:[canonical]}]);
  duplicate=true;
  assert.deepEqual((await assess()).selectedSourceIds,[canonical]);
});

test("coverage selection is constrained to the authenticated inventory",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let forged=false;
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const item=body.text.format.schema.properties.selectedSourceIds.items;
    assert.deepEqual(item.enum??[item.const],[evidence.source.id]);
    assert.equal(body.text.format.schema.properties.supportedAnswerAvailable.type,"boolean");
    const output={needs:[],resolved:[],queries:[],supportedAnswerAvailable:true,selectedSourceIds:[forged?"invented":evidence.source.id]};
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  const result=await createLegalResearchModel({requestId:"selection"}).assess({...request,evidence:[evidence]});
  assert.deepEqual(result.selectedSourceIds,[evidence.source.id]);
  assert.equal(result.supportedAnswerAvailable,true);
  forged=true;
  await assert.rejects(createLegalResearchModel({requestId:"forged-selection"}).assess({...request,evidence:[evidence]}),/SELECTION_EVIDENCE_INVALID/);
});

test("public planning enforces publisher bounds without rejecting useful indexed repair formulations",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const longText="Relevant legal formulation ".repeat(6);
  const offeredBounds:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const name=body.text.format.name;
    offeredBounds.push(body.text.format.schema.properties.queries.items.properties.text.description);
    const planned={...query,text:longText};
    const output=name==="legal_research_coverage"?{needs:[],resolved:[],queries:[planned]}
      :{queries:[name==="legal_indexed_queries"?{text:longText,topicIndices:[0]}:planned]};
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  const indexed=await createLegalResearchModel({requestId:"long-indexed"}).formulateIndexed(request);
  assert.equal(indexed.formulations[0]!.text,longText.trim());
  await assert.rejects(createLegalResearchModel({requestId:"long-public"}).formulate(request),{code:"INVALID_AI_OUTPUT"});
  const repairModel=createLegalResearchModel({requestId:"long-repair"});
  await repairModel.assess({...request,evidence:[evidence]});
  const repair=await repairModel.formulateIndexed({...request,round:1});
  assert.equal(repair.formulations[0]!.text,longText.trim(),"Preserve the complete longer formulation for indexed repair");
  assert.match(offeredBounds[0]!,/maxLength=900/);
  assert.match(offeredBounds[1]!,/maxLength=100/);
  assert.match(offeredBounds[2]!,/maxLength=100/);
});

test("sufficient evidence needs no speculative repair queries and an empty plan is not reused",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const stages:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const stage=body.text.format.name;stages.push(stage);
    if(stage==="legal_research_coverage")assert.match(body.instructions,/When assessing evidence/);
    else assert.doesNotMatch(body.instructions,/When assessing evidence|supportedAnswerAvailable/);
    assert.equal(body.text.verbosity,"low");
    const result=stage==="legal_research_coverage"?{needs:[],resolved:null,queries:[]}:{queries:[query]};
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(result)}]}]});
  });
  const input={...request,needs:[]};
  const model=createLegalResearchModel({requestId:"no-speculative-queries"});
  assert.deepEqual(await model.assess({...input,evidence:[evidence]}),{needs:[],resolved:[]});
  const plan=await model.formulate({...input,round:1});
  assert.equal(plan.formulations.length,1);
  assert.deepEqual(stages,["legal_research_coverage","legal_research_queries"]);
});

test("research provider can generate only topic indices belonging to this question",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const offered:unknown[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const item=body.text.format.schema.properties.queries.items.properties.topicIndices.items;
    offered.push(item.enum??(item.const===undefined?null:[item.const]));
    const planned={...query,topicIndices:JSON.parse(body.input).topics.map((_:string,index:number)=>index)};
    const output=body.text.format.name==="legal_research_coverage"
      ?{needs:[],resolved:[],queries:[planned]}:{queries:[body.text.format.name==="legal_indexed_queries"
        ?{text:planned.text,topicIndices:planned.topicIndices}:planned]};
    return Response.json({id:"response",output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  for(const topics of [["Record access"],["Record access","Challenging refusal"]]) {
    const input={...request,question:{...request.question,topics}};
    await createLegalResearchModel({requestId:"public-topics"}).formulate(input);
    await createLegalResearchModel({requestId:"indexed-topics"}).formulateIndexed(input);
    await createLegalResearchModel({requestId:"coverage-topics"}).assess({...input,evidence:[evidence]});
  }
  assert.deepEqual(offered,[[0],[0],[0],[0,1],[0,1],[0,1]],"Every provider query schema must exclude nonexistent topics");
});
const request:ResearchRequest={round:0,needs:[{reason:"missing_rule",detail:"The eligibility condition is missing."}],
  question:{question:"How can I request a record?",topics:["Record access"],locale:"en",mode:"fast",
    answerMode:"detailed",temporalScope:{kind:"current"}}};
const evidence:LegalEvidence={source:{id:"source:one",actTitle:"Synthetic rules",actIdentifier:null,
  officialUrl:"https://lex.uz/docs/777",revisionDate:null,lastCheckedAt:"2026-09-20",locale:"en",publishedAt:null,
  sourceType:"lex",status:"current",verificationState:"verified",verifiedAt:"2026-09-20",contentSha256:"private-parent-hash"},
  text:"A qualifying applicant may request the record.",textSha256:"private-text-hash",endpoint:{kind:"current"},origin:"indexed"};

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
    assert.deepEqual(body.reasoning,body.model==="gpt-6-luna"?{effort:assessment?"medium":"none",mode:"standard"}:undefined);
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
  assert.deepEqual(payloads.map(value=>value.model),["gpt-6-luna","gpt-6-luna","gpt-5.6-terra","gpt-5.6-terra"]);
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

test("coverage generation offers only substantive needs and admitted source IDs as resolutions",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const schemas:Array<{type:string;items?:{properties:{needIndex:{enum:number[]};sourceIds:{items:{const:string}}}}}>=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));schemas.push(body.text.format.schema.properties.resolved);
    return Response.json({id:"response",output:[{content:[{type:"output_text",
      text:JSON.stringify({needs:[],resolved:schemas.at(-1)!.type==="null"?null:[],queries:[query]})}]}]});
  });
  const outage={reason:"source_unavailable" as const,detail:"The source reader failed."};
  await createLegalResearchModel({requestId:"mixed"}).assess({...request,
    needs:[outage,request.needs[0]!,{reason:"unresolved_reference",detail:"The exception is missing."}],evidence:[evidence]});
  assert.deepEqual(schemas[0]!.items!.properties.needIndex.enum,[1,2]);
  assert.equal(schemas[0]!.items!.properties.sourceIds.items.const,"source:one");
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
