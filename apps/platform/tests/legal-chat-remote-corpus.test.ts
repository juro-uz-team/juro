import assert from "node:assert/strict";
import test from "node:test";
import {createRemoteCorpusResearch,type CorpusResearchService} from "../lib/legal-chat/remote-corpus-research";
import type {ResearchRequest} from "../lib/legal-chat/research";
import type {CorpusSearchInput,CorpusSessionInput} from "../lib/legal-chat/corpus-session";
import {createCorpusSession} from "../lib/legal-chat/corpus-session";

const request:ResearchRequest={round:0,needs:[],question:{question:"Private case narrative",topics:["procedure"],
  caseFacts:["Private facts"],priorTurns:[{question:"Private history",answer:"Old answer"}],
  temporalScope:{kind:"current"},locale:"en",mode:"deep",answerMode:"detailed"}};
const plan={id:"plan",formulations:[{id:"query",text:"statutory procedure contact private@example.com",
  privateNameSpans:[],readingIds:["topic"],requirementIds:["topic"]}]};

test("a failed local formulation does not strand subsequent bounded research rounds",async()=>{
  const rounds:number[]=[];
  let attempts=0;
  const remote=createRemoteCorpusResearch({requestId:"one",environment:"staging",
    formulate:async()=>{if(attempts++===0)throw new Error("formulation unavailable");return plan;},
    service:{async openLegalResearch(input){
      const session=createCorpusSession(input,()=>async request=>{rounds.push(request.round);return {evidence:[],needs:[]};});
      return {search:session.search,async cancel(){session.close();},[Symbol.dispose]:session.close};
    }}});
  await assert.rejects(remote.indexed(request),/formulation unavailable/);
  await remote.indexed({...request,round:1});
  await remote.indexed({...request,round:2});
  await assert.rejects(remote.indexed({...request,round:1}),/ROUND_MISMATCH/);
  assert.deepEqual(rounds,[1,2]);
  await remote.close();
});

test("one remote capability is reused and only scrubbed formulations cross the boundary",async()=>{
  const opened:CorpusSessionInput[]=[];
  const searches:CorpusSearchInput[]=[];
  let disposed=0;
  const remote=createRemoteCorpusResearch({requestId:"one",environment:"staging",formulate:async()=>plan,
    service:{async openLegalResearch(input){opened.push(input);return {
      async search(input){searches.push(input);return {evidence:[],needs:[]};},
      async cancel(){},[Symbol.dispose](){disposed++;},
    };}}});
  await remote.indexed(request);
  await remote.indexed({...request,round:1});
  assert.equal(opened.length,1);
  assert.deepEqual(opened[0],{requestId:"one",environment:"staging",temporalScope:{kind:"current"}});
  assert.doesNotMatch(JSON.stringify(searches),/private@|Private case|Private facts|Private history|Old answer/);
  assert.deepEqual(searches.map(item=>item.round),[0,1]);
  await assert.rejects(remote.indexed({...request,question:{...request.question,question:"another"}}),/MISMATCH/);
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
  await assert.rejects(pending,/CLOSED/);
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
  await remote.indexed({...request,round:1});
  await remote.indexed({...request,round:2});
  assert.equal(opens,2);
  assert.deepEqual(rounds,[1,2]);
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
