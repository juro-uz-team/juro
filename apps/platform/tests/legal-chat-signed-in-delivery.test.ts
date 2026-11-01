import {structuredResponse} from "./helpers/structured-response";
import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {deliverSignedInLegalChat} from "../lib/legal-chat/signed-in-delivery";
import {legalChatRequestSchema} from "../lib/legal-chat/request-schema";
import {resolveAiRuntimeSettings} from "../lib/ai/runtime-settings";
import {privateDocumentContext} from "./helpers/private-document-context";
import {setProviderCircuitState} from "../lib/ai/provider-cost-control";

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



test("missing configuration releases an owned reservation and pre-cancelled requests reserve nothing",async context=>{
  const {sqlite,input}=await fixture();context.after(()=>sqlite.close());
  await assert.rejects(deliverSignedInLegalChat({...input,configured:false}),/LEGAL_CHAT_UNAVAILABLE/);
  assert.equal(sqlite.prepare("SELECT status FROM ai_runs").get()?.status,"failed");
  assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"released");
  await assert.rejects(deliverSignedInLegalChat({...input,request:{...input.request,idempotencyKey:"cancelled-request"},signal:AbortSignal.abort()}));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_runs").get()?.n,1);
  await assert.rejects(deliverSignedInLegalChat({...input,request:{...input.request,conversationId:crypto.randomUUID(),
    operation:"follow_up",idempotencyKey:"missing-conversation"}}),{code:"SOURCE_MESSAGE_NOT_FOUND"});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE key LIKE '%missing-conversation'").get()?.n,0,
    "A nonexistent conversation cannot leave a dangling processing reservation");
});

test("a private document reader failure releases the reservation before model transport",async context=>{
  const {sqlite,input}=await fixture();context.after(()=>sqlite.close());
  context.mock.method(globalThis,"fetch",async()=>assert.fail("No model call after unavailable document context"));
  await assert.rejects(deliverSignedInLegalChat({...input,readDocuments:async()=>{throw Error("PRIVATE_DOCUMENT_CONTEXT_UNAVAILABLE");}}),
    /PRIVATE_DOCUMENT_CONTEXT_UNAVAILABLE/);
  assert.equal(sqlite.prepare("SELECT status FROM ai_runs").get()?.status,"failed");
  assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"released");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n,0);
});

test("an open provider circuit prevents text transport, records no attempt and releases the answer allowance",async context=>{
  const {sqlite,input}=await fixture();context.after(()=>sqlite.close());
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  await setProviderCircuitState({db:input.db,environment:input.settings.environment,provider:"openai",state:"open",actorUserId:"owner"});
  context.mock.method(globalThis,"fetch",async()=>assert.fail("An open provider circuit must stop transport"));
  const saved=await deliverSignedInLegalChat(input);
  assert.equal(saved.result.failureReason,"question_interpretation_unavailable");
  assert.deepEqual(saved.result.confirmedFindings,[]);
  assert.equal(sqlite.prepare("SELECT attempt_count FROM ai_runs").get()?.attempt_count,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_provider_usage_events").get()?.n,0);
  assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"released");
});
