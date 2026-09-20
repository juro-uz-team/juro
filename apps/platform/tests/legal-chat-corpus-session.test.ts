import assert from "node:assert/strict";
import test from "node:test";
import {createCorpusSession, type CorpusSessionInput} from "../lib/legal-chat/corpus-session";
import type {ResearchRequest} from "../lib/legal-chat/research";

const input:CorpusSessionInput={requestId:"request-one",environment:"staging",temporalScope:{kind:"current"}};
const plan={id:"plan",formulations:[{id:"query",text:"statutory procedure",readingIds:["topic"],requirementIds:["topic"],privateNameSpans:[]}]};

test("one reader owns all bounded rounds and receives no conversation payload",async()=>{
  let instances=0;
  const requests:ResearchRequest[]=[];
  const session=createCorpusSession(input,formulate=>{
    instances++;
    return async request=>{
      requests.push(request);
      assert.deepEqual(await formulate(request),plan);
      return {evidence:[],needs:[]};
    };
  });
  for(let round=0;round<3;round++)await session.search({round,plan});
  await assert.rejects(session.search({round:2,plan}),/ROUND_MISMATCH/);
  await assert.rejects(session.search({round:3,plan}));
  assert.equal(instances,1);
  assert.deepEqual(requests.map(request=>request.round),[0,1,2]);
  assert.equal(requests[0]!.question.priorTurns,undefined);
  assert.equal(requests[0]!.question.caseFacts,undefined);
  assert.equal(requests[0]!.question.signal,requests[2]!.question.signal);
});

test("failed reads consume their round, invalid plans do not",async()=>{
  let calls=0;
  const session=createCorpusSession(input,()=>async()=>{calls++;throw new Error("reader unavailable");});
  await assert.rejects(session.search({round:0,plan:{...plan,formulations:[]}}));
  assert.equal(calls,0);
  await assert.rejects(session.search({round:0,plan}),/reader unavailable/);
  await assert.rejects(session.search({round:0,plan}),/ROUND_MISMATCH/);
  await assert.rejects(session.search({round:1,plan}),/reader unavailable/);
  assert.equal(calls,2);
});

test("concurrent reads cannot replace the active plan; closing discards late results",async()=>{
  const ready=Promise.withResolvers<void>();
  let signal:AbortSignal|undefined;
  const session=createCorpusSession(input,formulate=>async request=>{
    signal=request.question.signal;
    await ready.promise;
    assert.deepEqual(await formulate(request),plan);
    return {evidence:[],needs:[]};
  });
  const pending=session.search({round:0,plan});
  await assert.rejects(session.search({round:1,plan:{...plan,id:"replacement"}}),/IN_PROGRESS/);
  ready.resolve();
  await pending;
  session.close();
  assert.equal(signal?.aborted,true);
  await assert.rejects(session.search({round:1,plan}),{name:"AbortError"});

  const late=Promise.withResolvers<void>();
  const other=createCorpusSession(input,()=>async()=>{await late.promise;return {evidence:[],needs:[]};});
  const result=other.search({round:0,plan});
  other.close();
  late.resolve();
  await assert.rejects(result,{name:"AbortError"});
});

test("sessions cannot share cancellation or mutable temporal input",async()=>{
  const observed:ResearchRequest[]=[];
  const scope:CorpusSessionInput={...input,temporalScope:{kind:"timestamp",instant:"2024-01-01T00:00:00Z"}};
  const reader=()=>async(request:ResearchRequest)=>{observed.push(request);return {evidence:[],needs:[]};};
  const first=createCorpusSession(scope,reader);
  const second=createCorpusSession(scope,reader);
  scope.temporalScope={kind:"current"};
  first.close();
  await second.search({round:0,plan});
  assert.deepEqual(observed[0]!.question.temporalScope,{kind:"timestamp",instant:"2024-01-01T00:00:00Z"});
  assert.equal(observed[0]!.question.signal?.aborted,false);
});
