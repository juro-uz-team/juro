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

test("signed-in clarification persists, accounts once, and replays without another provider attempt",async context=>{
  const {sqlite,input}=await fixture();context.after(()=>sqlite.close());
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const models:string[]=[];
  let documentReads=0;
  input.readDocuments=async(query,conversationId)=>{
    documentReads++;assert.equal(query,input.request.question);
    assert.ok(conversationId===null||typeof conversationId==="string");
    return [privateDocumentContext()];
  };
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));models.push(body.model);
    assert.deepEqual(JSON.parse(body.input).privateDocuments,[{id:privateDocumentContext().source.id,
      title:"Uploaded agreement",text:privateDocumentContext().text}]);
    assert.doesNotMatch(body.input,/juro-private:|private-object-checksum/);
    return Response.json({id:"offline-response",model:body.model,usage:{input_tokens:20,output_tokens:10},
      output:[{content:[{type:"output_text",text:JSON.stringify({
        interpretation:{topics:["Applicable rules"],facts:[],temporal:{kind:"unresolved"},questions:["Which date applies?"]},
        research:{queries:[{text:"applicable rules",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]}]},
      })}]}]});
  });
  const stages:string[]=[];
  const saved=await deliverSignedInLegalChat({...input,onStage:stage=>{stages.push(stage);}});
  assert.equal(saved.result.responseKind,"clarification_required");
  assert.deepEqual(saved.result.clarificationQuestions,["Which date applies?"]);
  assert.deepEqual(stages,["interpreting","saving"]);
  const replay=await deliverSignedInLegalChat({...input,configured:false,service:undefined});
  assert.deepEqual(replay,saved);
  assert.deepEqual(models,["gpt-5.6-terra"]);
  assert.equal(documentReads,1,"Completed replay does not retrieve private documents again");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get()?.n,2);
  assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"released");
  const run=sqlite.prepare("SELECT status,input_tokens,output_tokens,attempt_count FROM ai_runs").get();
  assert.equal(run?.status,"completed");assert.equal(run?.input_tokens,20);assert.equal(run?.output_tokens,10);assert.equal(run?.attempt_count,1);
  assert.deepEqual({...sqlite.prepare("SELECT feature,model,input_tokens,output_tokens,usage_observed FROM ai_provider_usage_events").get()},
    {feature:"legal_chat",model:"gpt-5.6-terra",input_tokens:20,output_tokens:10,usage_observed:1});
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_provider_usage_events").get()?.n,1);
  await assert.rejects(deliverSignedInLegalChat({...input,request:{...input.request,question:"Changed request"}}),{code:"IDEMPOTENCY_CONFLICT"});
  assert.equal(models.length,1);

  const followUp={...input,settings:{...input.settings,configHash:"b".repeat(64)},
    request:{...input.request,conversationId:saved.conversationId!,operation:"follow_up" as const,idempotencyKey:"follow-up-request"}};
  const followed=await deliverSignedInLegalChat(followUp);
  const firstHash=sqlite.prepare("SELECT instruction_hash FROM ai_runs WHERE id=?").get(saved.runId)?.instruction_hash;
  const changedHash=sqlite.prepare("SELECT instruction_hash FROM ai_runs WHERE id=?").get(followed.runId)?.instruction_hash;
  assert.match(String(firstHash),/^[a-f0-9]{64}$/);
  assert.match(String(changedHash),/^[a-f0-9]{64}$/);
  assert.notEqual(firstHash,changedHash,"Changed server settings must change the persisted instruction identity");
  let parent=followed.branchId!;
  for(let index=3;index<=201;index++) {
    const requestId=crypto.randomUUID(),responseId=crypto.randomUUID(),branchId=crypto.randomUUID();
    const time=new Date(Date.now()+index*1000).toISOString();
    for(const [id,author] of [[requestId,"user"],[responseId,"assistant"]]) {
      sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at) VALUES (?,?,?,?,?)")
        .run(id!,saved.conversationId!,author!,`Later turn ${index}`,time);
    }
    sqlite.prepare(`INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,request_message_id,response_message_id,operation,created_at)
      VALUES (?,?,'workspace','owner',?,?,?,'follow_up',?)`).run(branchId,saved.conversationId!,parent,requestId,responseId,time);
    parent=branchId;
  }
  assert.deepEqual(await deliverSignedInLegalChat({...followUp,configured:false,service:undefined}),followed,
    "Completed replay does not reread generation context after the conversation grows");
  await assert.rejects(deliverSignedInLegalChat({...followUp,request:{...followUp.request,idempotencyKey:"oversized-context"}}),/LEGAL_CONTEXT_CAPACITY_EXCEEDED/);
  assert.equal(models.length,2,"Oversized new context fails before any provider attempt");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_usage_ledger WHERE idempotency_key='oversized-context'").get()?.n,0);
});

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
