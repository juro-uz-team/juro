import assert from "node:assert/strict";
import test from "node:test";
import {createRemoteCorpusResearch,type CorpusResearchService} from "../lib/legal-chat/remote-corpus-research";
import type {ResearchRequest} from "../lib/legal-chat/research";
import type {CorpusSearchInput,CorpusSessionInput} from "../lib/legal-chat/corpus-session";
import {createCorpusSession} from "../lib/legal-chat/corpus-session";
import {runIndexedRetrieval,indexedRetrievalRemainingMs,indexedRetrievalSignal} from "../lib/runtime/indexed-retrieval";

const request:ResearchRequest={round:0,needs:[],question:{question:"Private case narrative",topics:["procedure"],
  caseFacts:["Private facts"],priorTurns:[{question:"Private history",answer:"Old answer"}],
  temporalScope:{kind:"current"},locale:"en",mode:"deep",answerMode:"detailed"}};
const plan={id:"plan",formulations:[{id:"query",text:"statutory procedure contact private@example.com",
  privateNameSpans:[],readingIds:["topic"],requirementIds:["topic"]}]};

test("discarding initial work reopens authoritative research within the original deadline",async context=>{
  let now=1000,opens=0,disposed=0;
  const searched:number[]=[];
  context.mock.method(performance,"now",()=>now);
  const remote=createRemoteCorpusResearch({requestId:"discard-initial",environment:"staging",
    retrievalExpiresAt:11000,formulate:async()=>plan,
    service:{async openLegalResearch(){const id=++opens;return {
      async stage(){},async search(){searched.push(id);assert.ok(indexedRetrievalRemainingMs()<=2000);return {evidence:[],needs:[]};},
      async cancel(){},[Symbol.dispose](){disposed++;},
    };}}});
  try{
    await remote.stage(request,{interpretationId:plan.id,formulation:plan.formulations[0]!});
    now=9000;
    await remote.discardInitial();
    await remote.indexed({...request,question:{...request.question,question:"Authoritative interpretation"}});
    assert.deepEqual(searched,[2]);assert.equal(disposed,1);
    await remote.discardInitial();now=11001;
    await assert.rejects(remote.indexed(request),{name:"TimeoutError"});
    assert.equal(opens,2);
  }finally{await remote.close();}
});

test("a discarded late opening cannot replace the new authoritative session",async()=>{
  const late=Promise.withResolvers<Awaited<ReturnType<CorpusResearchService["openLegalResearch"]>>>();
  let opens=0,lateDisposed=0,searches=0;
  const remote=createRemoteCorpusResearch({requestId:"late-discard",environment:"staging",formulate:async()=>plan,
    service:{openLegalResearch(){if(++opens===1)return late.promise;return Promise.resolve({
      async search(){searches++;return {evidence:[],needs:[]};},async cancel(){},[Symbol.dispose](){},
    });}}});
  const staged=remote.stage(request,{interpretationId:plan.id,formulation:plan.formulations[0]!});
  const rejected=assert.rejects(staged);
  await remote.discardInitial();
  await remote.indexed(request);
  late.resolve({async search(){assert.fail("Discarded session must never search");},async cancel(){},
    [Symbol.dispose](){lateDisposed++;}});
  await rejected;await new Promise<void>(resolve=>setImmediate(resolve));
  await remote.indexed(request);
  assert.equal(opens,2);assert.equal(searches,2);assert.equal(lateDisposed,1);
  await remote.close();
});

test("a failed streamed plan discards its pending work and consumes the single research round",async()=>{
  const rounds:number[]=[];
  const remote=createRemoteCorpusResearch({requestId:"streamed",environment:"staging",
    formulate:async(request,emit)=>{
      await emit?.({interpretationId:plan.id,formulation:plan.formulations[0]!});
      if(request.round===0)throw new Error("incomplete planning");
      return plan;
    },
    service:{async openLegalResearch(input){
      const session=createCorpusSession(input,formulate=>async request=>{
        await formulate(request,async()=>undefined);rounds.push(request.round);return {evidence:[],needs:[]};
      });
      return {stage:session.stage,search:session.search,async discard(round){session.discard(round);},
        async cancel(){session.close();},[Symbol.dispose]:session.close};
    }}});
  await assert.rejects(remote.indexed(request),/incomplete planning/);
  await assert.rejects(remote.indexed(request),/ROUND_MISMATCH/);
  await assert.rejects(remote.indexed({...request,round:1}));
  assert.deepEqual(rounds,[]);
  await remote.close();
});

test("a failed local formulation leaves the unstarted research round available",async()=>{
  const rounds:number[]=[];
  let attempts=0;
  const remote=createRemoteCorpusResearch({requestId:"one",environment:"staging",
    formulate:async()=>{if(attempts++===0)throw new Error("formulation unavailable");return plan;},
    service:{async openLegalResearch(input){
      const session=createCorpusSession(input,()=>async request=>{rounds.push(request.round);return {evidence:[],needs:[]};});
      return {search:session.search,async cancel(){session.close();},[Symbol.dispose]:session.close};
    }}});
  await assert.rejects(remote.indexed(request),/formulation unavailable/);
  await remote.indexed(request);
  await assert.rejects(remote.indexed(request),/ROUND_MISMATCH/);
  await assert.rejects(remote.indexed({...request,round:1}));
  assert.deepEqual(rounds,[0]);
  await remote.close();
});

test("one remote capability carries unchanged formulations without the separate conversation payload",async()=>{
  const opened:CorpusSessionInput[]=[];
  const searches:CorpusSearchInput[]=[];
  let disposed=0;
  const remote=createRemoteCorpusResearch({requestId:"one",environment:"staging",formulate:async()=>plan,
    service:{async openLegalResearch(input){opened.push(input);return {
      async search(input){searches.push(input);return {evidence:[],needs:[]};},
      async cancel(){},[Symbol.dispose](){disposed++;},
    };}}});
  await remote.indexed(request);
  assert.equal(opened.length,1);
  assert.deepEqual(opened[0],{requestId:"one",environment:"staging",mode:"deep",temporalScope:{kind:"current"}});
  assert.doesNotMatch(JSON.stringify(searches),/Private case|Private facts|Private history|Old answer/);
  assert.deepEqual(searches.map(item=>item.plan),[plan]);
  assert.deepEqual(searches.map(item=>item.round),[0]);
  await assert.rejects(remote.indexed({...request,question:{...request.question,question:"another"}}),/MISMATCH/);
  await assert.rejects(remote.indexed({...request,question:{...request.question,mode:"fast"}}),/MISMATCH/);
  await remote.close();await remote.close();
  assert.equal(disposed,1);
  await assert.rejects(remote.indexed(request),/CLOSED/);
});

test("cancellation while opening disposes a late capability without issuing searches",async()=>{
  const opened=Promise.withResolvers<Awaited<ReturnType<CorpusResearchService["openLegalResearch"]>>>();
  const controller=new AbortController();
  let disposed=0,searches=0;
  const remote=createRemoteCorpusResearch({requestId:"one",environment:"staging",formulate:async()=>plan,
    service:{openLegalResearch:()=>opened.promise}});
  const pending=remote.indexed({...request,question:{...request.question,signal:controller.signal}});
  controller.abort();
  opened.resolve({async search(){searches++;return {evidence:[],needs:[]};},async cancel(){},[Symbol.dispose](){disposed++;}});
  await assert.rejects(pending,{name:"AbortError"});
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(searches,0);
  assert.equal(disposed,1);
});

test("a failed service opening can recover without restarting a successful session",async()=>{
  let opens=0;
  const rounds:number[]=[];
  const remote=createRemoteCorpusResearch({requestId:"one",environment:"staging",formulate:async()=>plan,
    service:{async openLegalResearch(input){
      if(opens++===0)throw new Error("binding unavailable");
      const session=createCorpusSession(input,()=>async request=>{rounds.push(request.round);return {evidence:[],needs:[]};});
      return {search:session.search,async cancel(){session.close();},[Symbol.dispose]:session.close};
    }}});
  await assert.rejects(remote.indexed(request),/binding unavailable/);
  await remote.indexed(request);
  await assert.rejects(remote.indexed(request),/ROUND_MISMATCH/);
  assert.equal(opens,2);
  assert.deepEqual(rounds,[0]);
  await remote.close();
});

test("late search results after cancellation cannot enter research",async()=>{
  const started=Promise.withResolvers<void>();
  const finish=Promise.withResolvers<void>();
  const controller=new AbortController();
  let disposed=0;
  const remote=createRemoteCorpusResearch({requestId:"one",environment:"staging",formulate:async()=>plan,
    service:{async openLegalResearch(){return {async search(){started.resolve();await finish.promise;return {evidence:[],needs:[]};},
      async cancel(){},[Symbol.dispose](){disposed++;}};}}});
  const pending=remote.indexed({...request,question:{...request.question,signal:controller.signal}});
  await started.promise;
  controller.abort();finish.resolve();
  await assert.rejects(pending,{name:"AbortError"});
  assert.equal(disposed,1);
});

test("the indexed deadline includes opening a session and disposes a late capability",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  const opened=Promise.withResolvers<Awaited<ReturnType<CorpusResearchService["openLegalResearch"]>>>();
  let searches=0,disposed=0,failure:unknown;
  const remote=createRemoteCorpusResearch({requestId:"deadline-opening",environment:"staging",formulate:async()=>plan,
    service:{openLegalResearch:()=>opened.promise}});
  const pending=remote.indexed(request).catch(error=>{failure=error;});
  try {
    context.mock.timers.tick(10_000);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.ok(failure instanceof DOMException&&failure.name==="TimeoutError");
  }finally{
    opened.resolve({async search(){searches++;return {evidence:[],needs:[]};},async cancel(){},[Symbol.dispose](){disposed++;}});
    await pending;await new Promise<void>(resolve=>setImmediate(resolve));await remote.close();
  }
  assert.equal(searches,0);assert.equal(disposed,1);
});

test("formulation and native search share one deadline without resetting the budget",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  const formulated=Promise.withResolvers<void>(),searching=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
  let failure:unknown,attempt:AbortSignal|undefined,nested:AbortSignal|undefined;
  const remote=createRemoteCorpusResearch({requestId:"deadline-formulation",environment:"staging",
    formulate:async input=>{attempt=input.question.signal;await formulated.promise;return plan;},
    service:{async openLegalResearch(){return {async search(){return runIndexedRetrieval(undefined,async signal=>{
      nested=signal;searching.resolve();await finish.promise;return {evidence:[],needs:[]};
    });},async cancel(){},[Symbol.dispose](){}};}}});
  const pending=remote.indexed(request).catch(error=>{failure=error;});
  try{
    await new Promise<void>(resolve=>setImmediate(resolve));
    context.mock.timers.tick(6000);formulated.resolve();await searching.promise;
    context.mock.timers.tick(4000);await new Promise<void>(resolve=>setImmediate(resolve));
    assert.ok(failure instanceof DOMException&&failure.name==="TimeoutError");
    assert.equal(attempt?.aborted,true);
    assert.equal(nested?.aborted,true);
  }finally{formulated.resolve();finish.resolve();await pending;await remote.close();}
});


test("remote retrieval inherits time already spent interpreting instead of resetting its deadline",async()=>{
  const expiresAt=performance.now()+3500;
  const remote=createRemoteCorpusResearch({requestId:"budget",environment:"staging",retrievalExpiresAt:expiresAt,
    formulate:async()=>{assert.ok(indexedRetrievalRemainingMs()<=3500);return plan;},
    service:{async openLegalResearch(){
      assert.ok(indexedRetrievalRemainingMs()<=3500);
      return {async search(){return runIndexedRetrieval(undefined,async()=>{
        assert.ok(indexedRetrievalRemainingMs()<=3500,"Native nesting cannot restore consumed budget");
        return {evidence:[],needs:[]};
      });},async cancel(){},[Symbol.dispose](){}};
    }}});
  try{await remote.indexed(request);}finally{await remote.close();}
});

test("expired interpretation budget starts no corpus session or formulation",async()=>{
  const remote=createRemoteCorpusResearch({requestId:"expired",environment:"staging",retrievalExpiresAt:performance.now()-1,
    formulate:async()=>assert.fail("No formulation after deadline"),
    service:{async openLegalResearch(){return assert.fail("No corpus I/O after deadline");}}});
  try{await assert.rejects(remote.indexed(request),{name:"TimeoutError"});}finally{await remote.close();}
});


test("initial staging keeps native retrieval alive between callbacks and reuses one session",async()=>{
  let opened=0,finished=false;
  let nativeSignal:AbortSignal|undefined;
  const remote=createRemoteCorpusResearch({requestId:"initial-stream",environment:"staging",
    retrievalExpiresAt:performance.now()+3500,formulate:async()=>plan,
    service:{async openLegalResearch(input){
      opened++;
      const session=createCorpusSession(input,formulate=>async request=>runIndexedRetrieval(request.question.signal,async()=>{
        await formulate(request,async()=>{nativeSignal=indexedRetrievalSignal();});
        finished=true;return {evidence:[],needs:[]};
      }));
      return {stage:session.stage,search:session.search,async cancel(){session.close();},[Symbol.dispose]:session.close};
    }}});
  try {
    await remote.stage(request,{interpretationId:plan.id,formulation:plan.formulations[0]!});
    assert.ok(nativeSignal);assert.equal(nativeSignal.aborted,false,"Returning a stream callback must not cancel native work");
    assert.equal(finished,false,"No packet is available until the full plan validates");
    await remote.indexed(request);
    assert.equal(opened,1);assert.equal(finished,true);
  }finally{await remote.close();}
});

test("cancelling between initial fragments prevents final search and disposes the staged session",async()=>{
  const controller=new AbortController();let disposed=0,searches=0;
  const remote=createRemoteCorpusResearch({requestId:"cancel-stream",environment:"staging",formulate:async()=>plan,
    service:{async openLegalResearch(){return {async stage(){},async search(){searches++;return {evidence:[],needs:[]};},
      async cancel(){},[Symbol.dispose](){disposed++;}};}}});
  const input={...request,question:{...request.question,signal:controller.signal}};
  await remote.stage(input,{interpretationId:plan.id,formulation:plan.formulations[0]!});
  controller.abort(new DOMException("User cancelled","AbortError"));
  await assert.rejects(remote.indexed(input),{name:"AbortError"});
  await remote.close();assert.equal(disposed,1);assert.equal(searches,0);
});
