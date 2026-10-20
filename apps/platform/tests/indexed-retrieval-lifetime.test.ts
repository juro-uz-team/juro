import test from "node:test";
import assert from "node:assert/strict";
import {indexedRetrievalRemainingMs,openIndexedRetrievalScope,runIndexedRetrieval} from "../lib/runtime/indexed-retrieval";

test("retrieval continues beyond 45 seconds and cancellation reaches nested work",async context=>{
  context.mock.timers.enable({apis:["setTimeout"]});
  const owner=new AbortController(),started=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>();
  const scope=openIndexedRetrievalScope(owner.signal,Infinity);
  let nested:AbortSignal|undefined;
  const pending=scope.run(()=>runIndexedRetrieval(undefined,async signal=>{
    nested=signal;assert.equal(indexedRetrievalRemainingMs(),Infinity);
    started.resolve();await finish.promise;
  }));
  const rejected=assert.rejects(pending,{name:"AbortError"});
  try{
    await started.promise;
    context.mock.timers.tick(91_000);
    assert.equal(nested?.aborted,false,"No independent retrieval latency cutoff");
    owner.abort(new DOMException("Request cancelled","AbortError"));
    await rejected;assert.equal(nested?.aborted,true);
  }finally{finish.resolve();scope.close();}
});

test("explicit request lifetime above 45 seconds is inherited without clamping",async context=>{
  let now=1000;
  context.mock.method(performance,"now",()=>now);
  await runIndexedRetrieval(undefined,async()=>{
    now+=91_000;
    await runIndexedRetrieval(undefined,async()=>{
      assert.equal(indexedRetrievalRemainingMs(),89_000);
    });
  },181_000);
});
