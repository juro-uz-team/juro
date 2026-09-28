import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {callOpenAiStructured,type AiProviderAttemptObservation} from "../lib/document-builder/ai/openai";

const options={model:"gpt-6-luna",instructions:"Return the supplied value.",input:{value:1},schemaName:"header_recovery",
  schema:{type:"object",properties:{value:{type:"number"}},required:["value"],additionalProperties:false},
  parse:(value:unknown)=>{assert.deepEqual(value,{value:1});return value;},maxAttempts:2 as const,
  responseHeadersTimeoutMs:10,retryOnlyOnHeadersTimeout:true,timeoutMs:200};
const completed=()=>Response.json({status:"completed",output:[{content:[{type:"output_text",text:'{"value":1}'}]}],
  usage:{input_tokens:12,output_tokens:4}});

test("a stalled connection retries the identical payload once and retains unknown attempt usage",async context=>{
  const previous=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-key";context.after(()=>{env.OPENAI_API_KEY=previous;});
  context.mock.timers.enable({apis:["setTimeout","Date"],now:1000});
  const started=Promise.withResolvers<void>();
  const requests:string[]=[],observed:AiProviderAttemptObservation[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    requests.push(String(init?.body));
    if(requests.length===1)return new Promise<Response>((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true});
      started.resolve();
    });
    return completed();
  });
  const pending=callOpenAiStructured({...options,onAttemptFinished:row=>{observed.push(row);}});
  await started.promise;context.mock.timers.tick(9);assert.equal(requests.length,1);context.mock.timers.tick(1);
  const result=await pending;
  assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.deepEqual(result.data,{value:1});
  assert.equal(observed[0]!.usage,null);assert.equal(observed[0]!.errorCode,"PROVIDER_TIMEOUT");
  assert.equal(observed[0]!.elapsedMs,10,"Headers have a shorter deadline than answer generation");
  assert.equal(observed[1]!.outcome,"completed");assert.equal(result.usage.outputTokens,4);
});

test("connection recovery never retries received errors, rejected output or incomplete streams",async context=>{
  const previous=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-key";context.after(()=>{env.OPENAI_API_KEY=previous;});
  for(const kind of ["http","schema","stream"]){
    let calls=0;
    context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
      calls++;
      if(kind==="http")return Response.json({error:{message:"unavailable"}},{status:503});
      if(kind==="schema")return Response.json({output:[{content:[{type:"output_text",text:'{"value":2}'}]}]});
      return new Response(new ReadableStream({start(controller){
        init!.signal!.addEventListener("abort",()=>controller.error(init!.signal!.reason),{once:true});
      }}),{headers:{"content-type":"text/event-stream"}});
    });
    await assert.rejects(callOpenAiStructured({...options,timeoutMs:40,onProgress:()=>undefined}));
    assert.equal(calls,1,kind+" must not cause another answer attempt");
  }
});

test("connection recovery respects cancellation and the caller's shared deadline",async context=>{
  const previous=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-key";context.after(()=>{env.OPENAI_API_KEY=previous;});
  for(const cancel of [true,false]){
    const caller=new AbortController();let calls=0;
    context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      calls++;init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true});
      if(cancel)caller.abort();
    }));
    await assert.rejects(callOpenAiStructured({...options,signal:caller.signal,deadlineAt:Date.now()+5}),
      {code:cancel?"AI_CANCELLED":"PROVIDER_TIMEOUT"});
    assert.equal(calls,1);
  }
});
