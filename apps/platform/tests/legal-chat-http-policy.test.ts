import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import {env} from "cloudflare:workers";
import {GET,POST,DELETE} from "../app/api/platform/ai/route";
import {POST as updateFact} from "../app/api/platform/ai/facts/route";
import {reserveAiRun} from "../lib/ai/run-store";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";

async function fixture(context:TestContext){
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));context.after(()=>sqlite.close());
  const bindings={DB:d1,APP_ENV:"staging",ALLOW_PLATFORM_AUTH_HEADERS:"true",IDENTITY_PROTECTION_MODE:"legacy",OPENAI_API_KEY:"offline-key"};
  const previous=Object.fromEntries(Object.keys(bindings).map(key=>[key,Reflect.get(env,key)]));
  Object.assign(env,bindings);context.after(()=>Object.assign(env,previous));
  const request=(body?:unknown,email="owner@example.test",workspaceId?:string,query="",method=body?"POST":"GET")=>new Request("https://app.example/api/platform/ai"+query,{
    method,headers:{"oai-authenticated-user-email":email,origin:"https://app.example","x-juro-csrf":"1","content-type":"application/json",...(workspaceId?{"x-juro-workspace-id":workspaceId}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await GET(request())).status,200);
  const userId=String(sqlite.prepare("SELECT id FROM user_profiles WHERE email='owner@example.test'").get()?.id);
  const workspaceId=String(sqlite.prepare("SELECT default_workspace_id FROM user_profiles WHERE id=?").get(userId)?.default_workspace_id);
  return {sqlite,d1,request,userId,workspaceId};
}

test("chat HTTP history, deletion and fact updates isolate owners within a shared workspace",async context=>{
  const {sqlite,request,userId,workspaceId}=await fixture(context);
  assert.equal((await GET(request(undefined,"other@example.test"))).status,200);
  const other=String(sqlite.prepare("SELECT id FROM user_profiles WHERE email='other@example.test'").get()?.id);
  const otherWorkspace=String(sqlite.prepare("SELECT default_workspace_id FROM user_profiles WHERE id=?").get(other)?.default_workspace_id);
  const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?,?)")
    .run(crypto.randomUUID(),workspaceId,other,now,now,now);
  const owned=crypto.randomUUID(),foreign=crypto.randomUUID(),fact=crypto.randomUUID();
  for(const [id,owner] of [[owned,userId],[foreign,other]])sqlite.prepare("INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,created_at,updated_at) VALUES (?,?,?,'Private conversation','en',?,?)")
    .run(id,workspaceId,owner,now,now);
  sqlite.prepare("INSERT INTO confirmed_facts(id,conversation_id,statement,status,created_at,updated_at) VALUES (?,?,'Private fact','proposed',?,?)").run(fact,owned,now,now);
  for(const [email,id] of [["owner@example.test",owned],["other@example.test",foreign]]){
    const body=await(await GET(request(undefined,email,workspaceId))).json() as {conversations:Array<{id:string}>};
    assert.deepEqual(body.conversations.map(c=>c.id),[id]);
  }
  assert.equal((await GET(request(undefined,"owner@example.test",workspaceId,`?conversationId=${foreign}`))).status,404);
  assert.equal((await DELETE(request({conversationId:foreign},"owner@example.test",workspaceId,"","DELETE"))).status,404);
  assert.ok(sqlite.prepare("SELECT id FROM conversations WHERE id=?").get(foreign));
  assert.equal((await updateFact(request({factId:fact,status:"confirmed"},"other@example.test",workspaceId))).status,404);
  assert.equal((await updateFact(request({factId:fact,status:"confirmed"},"owner@example.test",otherWorkspace))).status,404);
  assert.equal(sqlite.prepare("SELECT status FROM confirmed_facts WHERE id=?").get(fact)?.status,"proposed");
  assert.equal((await updateFact(request({factId:fact,status:"confirmed"},"owner@example.test",workspaceId))).status,200);
  assert.equal(sqlite.prepare("SELECT confirmed_by_user_id FROM confirmed_facts WHERE id=?").get(fact)?.confirmed_by_user_id,userId);
});

test("chat HTTP allowance follows stored entitlements and blocks a depleted server allowance before network work",async context=>{
  const {sqlite,d1,request,userId,workspaceId}=await fixture(context);
  const status=async()=>await(await GET(request())).json() as {usage:{limit:number|null;used:number}};
  assert.equal((await status()).usage.limit,20);
  for(let index=0;index<20;index++)await reserveAiRun({db:d1,userId,workspaceId,conversationId:null,idempotencyKey:`reserved-${index}`,requestHash:`hash-${index}`,
    provider:"openai",model:"gpt-5.6-luna",answerMode:"short",reasoningMode:"fast",legalDatabaseAsOf:"unavailable",instructionHash:"settings",sourceVersionHash:"none",monthlyLimit:20});
  let networkCalls=0;context.mock.method(globalThis,"fetch",async()=>{networkCalls++;throw Error("A depleted allowance must not call the network");});
  const exhausted=await POST(request({question:"Which rules apply?",locale:"en",idempotencyKey:"depleted-allowance-request"}));
  assert.equal(exhausted.status,429);assert.equal((await exhausted.json() as {code:string}).code,"PLAN_LIMIT");
  assert.equal(networkCalls,0);assert.equal((await status()).usage.used,20);
  const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO subscriptions(id,workspace_id,provider,plan_code,status,current_period_ends_at,created_at,updated_at) VALUES ('subscription',?,'manual','individual','active',?,?,?)")
    .run(workspaceId,new Date(Date.now()+86_400_000).toISOString(),now,now);
  assert.equal((await status()).usage.limit,120);
  sqlite.prepare("UPDATE subscriptions SET current_period_ends_at='2000-01-01T00:00:00.000Z' WHERE id='subscription'").run();
  assert.equal((await status()).usage.limit,20);
  Reflect.set(env,"APP_ENV","development");assert.equal((await status()).usage.limit,null);
});
