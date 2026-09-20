import assert from "node:assert/strict";
import test from "node:test";
import {legalChatStream} from "../lib/legal-chat/delivery-stream";
import {legalChatResponseSchema} from "../lib/ai/legal-chat-schema";

const result=legalChatResponseSchema.parse({responseKind:"clarification_required",summary:"Which date?",answer:"Which date?",
  language:"en",jurisdiction:"UZ",answerMode:"detailed",reasoningMode:"fast",clarificationQuestions:["Which date?"],
  confirmedFindings:[],assumptions:[],risks:[],sources:[],requiredDocuments:[],actionPlan:[],deadlines:[],
  successOutlook:null,urgency:"normal",suggestedDocument:null,suggestLawyer:false,legalDatabaseAsOf:"unavailable"});

test("progress is readable before completion and the terminal event excludes private diagnostics",async()=>{
  const save=Promise.withResolvers<void>();
  const response=legalChatStream({work:async(_signal,progress)=>{
    progress("interpreting");await save.promise;
    return {runId:"run",result,research:{secret:"private source body"}};
  }});
  assert.match(response.headers.get("cache-control")!,/no-store/);
  const reader=response.body!.getReader();
  const first=await reader.read();
  const text=new TextDecoder().decode(first.value);
  assert.match(text,/event: progress/);assert.match(text,/interpreting/);
  assert.doesNotMatch(text,/Which date/);
  save.resolve();
  let rest="";
  for(;;){const next=await reader.read();if(next.done)break;rest+=new TextDecoder().decode(next.value);}
  assert.match(rest,/event: result/);assert.match(rest,/Which date/);
  assert.doesNotMatch(rest,/research|private source body/);
});

test("failed work exposes a retryable state without leaking provider or source errors",async()=>{
  const response=legalChatStream({work:async()=>{throw new Error("secret upstream response and private case");}});
  const body=await response.text();
  assert.match(body,/event: error/);assert.match(body,/LEGAL_CHAT_UNAVAILABLE/);
  assert.doesNotMatch(body,/secret|private case|event: result/);
});

test("disconnect aborts work and never publishes its late result",async()=>{
  const done=Promise.withResolvers<void>();
  let signal:AbortSignal|undefined;
  const response=legalChatStream({work:async(input,progress)=>{
    signal=input;progress("researching");await done.promise;return {runId:"late",result};
  }});
  const reader=response.body!.getReader();await reader.read();
  await reader.cancel();assert.equal(signal?.aborted,true);
  done.resolve();
  assert.equal((await reader.read()).done,true);
});

test("an already aborted request cannot start reserved work",async()=>{
  const controller=new AbortController();controller.abort();
  const response=legalChatStream({signal:controller.signal,work:async()=>assert.fail("Cancelled request must not start")});
  await assert.rejects(response.text(),{name:"AbortError"});
});


test("browser consumes split UTF-8 frames and only publishes a complete saved answer",async()=>{
  const {readLegalChatStream}=await import("../lib/legal-chat/client-stream");
  const text=": heartbeat\n\nevent: progress\ndata: {\"stage\":\"researching\"}\n\nevent: result\ndata: "+JSON.stringify({runId:"saved",result:{...result,summary:"Уточните дату"}})+"\n\n";
  const bytes=new TextEncoder().encode(text);
  const body=new ReadableStream<Uint8Array>({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
  const stages:string[]=[];
  const saved=await readLegalChatStream(new Response(body,{headers:{"content-type":"text/event-stream"}}),stage=>stages.push(stage));
  assert.equal(saved.result.summary,"Уточните дату");assert.deepEqual(stages,["researching"]);
});

test("browser distinguishes uncertain replay from a new explicit attempt after terminal failure",async()=>{
  const {readLegalChatStream,shouldReuseLegalChatRequest,LegalChatClientError}=await import("../lib/legal-chat/client-stream");
  await assert.rejects(readLegalChatStream(new Response("event: progress\ndata: {\"stage\":\"saving\"}\n\n",{headers:{"content-type":"text/event-stream"}}),()=>{}),{code:"CHAT_STREAM_INTERRUPTED"});
  assert.equal(shouldReuseLegalChatRequest(new LegalChatClientError("CHAT_STREAM_INTERRUPTED")),true);
  assert.equal(shouldReuseLegalChatRequest(new LegalChatClientError("GUEST_RUN_PROCESSING")),true);
  assert.equal(shouldReuseLegalChatRequest(new LegalChatClientError("GUEST_RUN_FAILED")),false);
  assert.equal(shouldReuseLegalChatRequest(new LegalChatClientError("AI_RUN_EXPIRED")),false);
});
