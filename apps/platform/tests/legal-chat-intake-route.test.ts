import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {POST as create} from "../app/api/platform/ai/intake/route";
import {POST as consume} from "../app/api/platform/ai/intake/consume/route";
import {POST as finalize} from "../app/api/platform/ai/intake/finalize/route";
import {GET as chatStatus} from "../app/api/platform/ai/route";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";

test("dashboard drafts cross the authenticated intake routes encrypted, replayably and within their owner/workspace",async context=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));context.after(()=>sqlite.close());
  const bindings={DB:d1,APP_ENV:"development",ALLOW_PLATFORM_AUTH_HEADERS:"true",IDENTITY_PROTECTION_MODE:"legacy",
    IDENTITY_KEYRING:JSON.stringify({active:"test",versions:{test:{aead:Buffer.alloc(32,1).toString("base64url"),hmac:Buffer.alloc(32,2).toString("base64url")}}})};
  const previous=Object.fromEntries(Object.keys(bindings).map(key=>[key,Reflect.get(env,key)]));
  Object.assign(env,bindings);context.after(()=>Object.assign(env,previous));
  const request=(body?:unknown,email="owner@example.test")=>new Request("https://app.example/api/platform/ai/intake",{
    method:body?"POST":"GET",headers:{"oai-authenticated-user-email":email,origin:"https://app.example","x-juro-csrf":"1","content-type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await chatStatus(request())).status,200);
  const workspaceId=String(sqlite.prepare("SELECT id FROM workspaces LIMIT 1").get()?.id);
  const question="Confidential dashboard draft with a disputed payment.";
  const issued=await create(request({question,workspaceId}));assert.equal(issued.status,200);
  assert.equal(issued.headers.get("referrer-policy"),"no-referrer");
  assert.match(issued.headers.get("cache-control")!,/private, no-store/);
  const {handle}=await issued.json() as {handle:string};assert.match(handle,/^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM ai_question_intakes").all()),/Confidential dashboard|disputed payment/);
  for(let index=0;index<2;index++)assert.deepEqual(await(await consume(request({handle,workspaceId}))).json(),{question});
  assert.equal((await consume(request({handle,workspaceId},"other@example.test"))).status,404);
  assert.equal((await consume(request({handle,workspaceId:"foreign-workspace"}))).status,404);
  assert.equal((await create(new Request(request({question,workspaceId}),{headers:{origin:"https://evil.example","content-type":"application/json"}}))).status,403);
  assert.equal((await finalize(request({handle,workspaceId}))).status,200);
  assert.equal((await finalize(request({handle,workspaceId}))).status,200);
  assert.equal((await consume(request({handle,workspaceId}))).status,404);
  assert.equal(sqlite.prepare("SELECT question_ciphertext FROM ai_question_intakes").get()?.question_ciphertext,null);
  assert.equal((await create(request({question:"x".repeat(4001),workspaceId}))).status,400);
  Reflect.set(env,"IDENTITY_KEYRING","");
  assert.equal((await create(request({question,workspaceId}))).status,503);
});
