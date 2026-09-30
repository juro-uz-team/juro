import assert from "node:assert/strict";
import {structuredResponse} from "./helpers/structured-response";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {parseIdentityKeyring} from "../lib/auth/keyring";
import {createGuestAiSession,guestAiClarificationRuns,revealGuestAiRunQuestion} from "../lib/ai/guest-session";
import {deliverGuestLegalChat,guestLegalChatRequestSchema} from "../lib/legal-chat/guest-delivery";
import {resolveAiRuntimeSettings} from "../lib/ai/runtime-settings";

test("guest clarifications retain every user turn, stay encrypted and replay without a provider call",async context=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));context.after(()=>sqlite.close());
  const keyring=parseIdentityKeyring(JSON.stringify({active:"test",versions:{test:{aead:Buffer.alloc(32,1).toString("base64url"),hmac:Buffer.alloc(32,2).toString("base64url")}}}));
  const {session}=await createGuestAiSession({db:d1,keyring,connectingIp:"203.0.113.1",locale:"en"});
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const requests:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    requests.push(String(init?.body));const body=JSON.parse(requests.at(-1)!);
    assert.equal(body.model,"gpt-6-luna");
    return structuredResponse(body,{id:"offline-response",model:body.model,usage:{input_tokens:20,output_tokens:10},
      output:[{content:[{type:"output_text",text:JSON.stringify({interpretation:{topics:["Applicable rules"],facts:[],temporal:{kind:"unresolved"},questions:["Which date applies?"]}})}]}]});
  });
  const input:Parameters<typeof deliverGuestLegalChat>[0]={db:d1,keyring,session,settings:await resolveAiRuntimeSettings({env:{APP_ENV:"development"}}),
    configured:true,retrievalEnvironment:"development",service:{async openLegalResearch(){throw new Error("Clarification needs no research");}},
    request:guestLegalChatRequestSchema.parse({question:"Private original guest question",locale:"en",reasoningMode:"deep",idempotencyKey:"guest-first"})};
  const first=await deliverGuestLegalChat(input);
  const second=await deliverGuestLegalChat({...input,settings:{...input.settings,configHash:"b".repeat(64)},
    request:{...input.request,question:"Private second guest clarification",idempotencyKey:"guest-second"}});
  const firstHash=sqlite.prepare("SELECT instruction_hash FROM guest_ai_runs WHERE id=?").get(first.runId)?.instruction_hash;
  const changedHash=sqlite.prepare("SELECT instruction_hash FROM guest_ai_runs WHERE id=?").get(second.runId)?.instruction_hash;
  assert.match(String(firstHash),/^[a-f0-9]{64}$/);
  assert.match(String(changedHash),/^[a-f0-9]{64}$/);
  assert.notEqual(firstHash,changedHash,"Changed server settings must change the persisted instruction identity");
  assert.equal(second.result.responseKind,"clarification_required");
  assert.match(requests[1]!,/Private original guest question/);
  const followup=JSON.parse(JSON.parse(requests[1]!).input);
  assert.deepEqual(JSON.parse(followup.priorTurns[0].answer).questions,["Which date applies?"]);
  assert.equal(requests.length,2);
  assert.deepEqual(await deliverGuestLegalChat({...input,configured:false,service:undefined}),first);
  assert.equal(requests.length,2);
  assert.deepEqual(sqlite.prepare("SELECT feature,model,input_tokens,output_tokens,usage_observed FROM ai_provider_usage_events").all().map(row=>({...row})),
    Array.from({length:2},()=>({feature:"guest_legal_chat",model:"gpt-6-luna",input_tokens:20,output_tokens:10,usage_observed:1})));
  const history=await guestAiClarificationRuns(d1,session);
  assert.deepEqual(await Promise.all(history.map(run=>revealGuestAiRunQuestion({keyring,run}))),["Private original guest question","Private second guest clarification"]);
  assert.deepEqual(await guestAiClarificationRuns(d1,{...session,tokenHmac:"foreign"}),[]);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM guest_ai_runs").all()),/Private original|Private second|Which date/);
  const state=sqlite.prepare("SELECT state,answer_count,request_count FROM guest_ai_sessions").get();
  assert.equal(state?.state,"available");assert.equal(state?.answer_count,0);assert.equal(state?.request_count,2);
  // A later unreadable clarification must not prevent replay of an intact result.
  sqlite.prepare("UPDATE guest_ai_runs SET request_ciphertext='unreadable' WHERE id=?").run(second.runId);
  assert.deepEqual(await deliverGuestLegalChat({...input,configured:false,service:undefined}),first);
  assert.equal(requests.length,2);
  await assert.rejects(deliverGuestLegalChat({...input,request:{...input.request,idempotencyKey:"guest-unreadable-context"}}));
  assert.equal(requests.length,2);
  assert.equal(sqlite.prepare("SELECT state FROM guest_ai_sessions").get()?.state,"available");
  assert.equal(sqlite.prepare("SELECT status FROM guest_ai_runs WHERE idempotency_key='guest-unreadable-context'").get()?.status,"failed");
});
