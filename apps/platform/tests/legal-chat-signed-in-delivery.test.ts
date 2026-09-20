import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {deliverSignedInLegalChat} from "../lib/legal-chat/signed-in-delivery";
import {legalChatRequestSchema} from "../lib/legal-chat/request-schema";
import {resolveAiRuntimeSettings} from "../lib/ai/runtime-settings";

async function fixture(){
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));
  const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO user_profiles(id,email,locale,created_at,updated_at) VALUES (?,?,?,?,?)").run("owner","owner@example.test","en",now,now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'en',?,?)").run("workspace","Workspace",now,now);
  const input:Parameters<typeof deliverSignedInLegalChat>[0]={db:d1,workspaceId:"workspace",userId:"owner",
    settings:await resolveAiRuntimeSettings({env:{APP_ENV:"development"}}),monthlyLimit:null,configured:true,retrievalEnvironment:"development",
    request:legalChatRequestSchema.parse({question:"What rules apply to my situation?",locale:"en",idempotencyKey:"request-one"}),
    service:{async openLegalResearch(){throw new Error("Clarification must not open research");}}};
  return {sqlite,input};
}

test("signed-in clarification persists, accounts once, and replays without another provider attempt",async context=>{
  const {sqlite,input}=await fixture();context.after(()=>sqlite.close());
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const models:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));models.push(body.model);
    return Response.json({id:"offline-response",model:body.model,usage:{input_tokens:20,output_tokens:10},
      output:[{content:[{type:"output_text",text:JSON.stringify({topics:["Applicable rules"],facts:[],temporal:{kind:"unresolved"},questions:["Which date applies?"]})}]}]});
  });
  const stages:string[]=[];
  const saved=await deliverSignedInLegalChat({...input,onStage:stage=>{stages.push(stage);}});
  assert.equal(saved.result.responseKind,"clarification_required");
  assert.deepEqual(saved.result.clarificationQuestions,["Which date applies?"]);
  assert.deepEqual(stages,["interpreting","saving"]);
  const replay=await deliverSignedInLegalChat({...input,configured:false,service:undefined});
  assert.deepEqual(replay,saved);
  assert.deepEqual(models,["gpt-5.6-luna"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get()?.n,2);
  assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"released");
  const run=sqlite.prepare("SELECT status,input_tokens,output_tokens,attempt_count FROM ai_runs").get();
  assert.equal(run?.status,"completed");assert.equal(run?.input_tokens,20);assert.equal(run?.output_tokens,10);assert.equal(run?.attempt_count,1);
  await assert.rejects(deliverSignedInLegalChat({...input,request:{...input.request,question:"Changed request"}}),{code:"IDEMPOTENCY_CONFLICT"});
  assert.equal(models.length,1);
});

test("missing configuration releases an owned reservation and pre-cancelled requests reserve nothing",async context=>{
  const {sqlite,input}=await fixture();context.after(()=>sqlite.close());
  await assert.rejects(deliverSignedInLegalChat({...input,configured:false}),/LEGAL_CHAT_UNAVAILABLE/);
  assert.equal(sqlite.prepare("SELECT status FROM ai_runs").get()?.status,"failed");
  assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"released");
  await assert.rejects(deliverSignedInLegalChat({...input,request:{...input.request,idempotencyKey:"cancelled-request"},signal:AbortSignal.abort()}));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_runs").get()?.n,1);
});
