import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import {env} from "./helpers/runtime-env";
import {GET,POST} from "../app/api/platform/ai/memory/route";
import {POST as submitChat} from "../app/api/platform/ai/route";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";

function setup(context:TestContext) {
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));
  context.after(()=>sqlite.close());
  const bindings={DB:d1,APP_ENV:"development",ALLOW_PLATFORM_AUTH_HEADERS:"true",IDENTITY_PROTECTION_MODE:"legacy",
    OPENAI_API_KEY:"offline-key",LEGAL_RETRIEVAL_SERVICE:{async openLegalResearch(){assert.fail("Clarification must not research");}},
    IDENTITY_KEYRING:JSON.stringify({active:"test",versions:{test:{aead:Buffer.alloc(32,1).toString("base64url"),hmac:Buffer.alloc(32,2).toString("base64url")}}})};
  const previous=Object.fromEntries(Object.keys(bindings).map(key=>[key,Reflect.get(env,key)]));
  Object.assign(env,bindings);context.after(()=>Object.assign(env,previous));
  const request=(body?:unknown,email="owner@example.test")=>new Request("https://app.example/api/platform/ai/memory?locale=en",{
    method:body?"POST":"GET",headers:{"oai-authenticated-user-email":email,origin:"https://app.example","x-juro-csrf":"1","content-type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})});
  return {request,sqlite};
}

test("memory panel can save and read a manual preference through its retained API",async context=>{
  const {request}=setup(context);
  const before=await GET(request());assert.equal(before.status,200);
  assert.match(before.headers.get("cache-control")!,/private, no-store/);
  assert.deepEqual(await before.json(),{available:true,settings:{automaticEnabled:true},memories:[]});
  const saved=await POST(request({action:"create",locale:"en",category:"answer_style",statement:"Use concise answers.",scope:"global",confirmSensitive:false}));
  assert.equal(saved.status,200);
  const current=await (await GET(request())).json() as {memories:Array<{id:string;statement:string;sourceKind:string}>};
  assert.equal(current.memories.length,1);
  assert.equal(current.memories[0]!.statement,"Use concise answers.");
  assert.equal(current.memories[0]!.sourceKind,"manual");
});

test("manual memory changes remain owned and clearing requires the panel confirmation",async context=>{
  const {request}=setup(context);
  const create={action:"create",locale:"en",category:"answer_style",statement:"Use concise answers.",scope:"workspace"};
  const created=await POST(request(create));assert.equal(created.status,200);
  const {id}=await created.json() as {id:string};
  const update={action:"update",locale:"en",memoryId:id,category:"answer_style",statement:"Use detailed answers."};
  assert.equal((await POST(request(update))).status,200);
  assert.equal((await POST(request(update,"other@example.test"))).status,404);
  assert.equal((await POST(request({action:"delete",memoryId:id},"other@example.test"))).status,404);
  const read=async()=>await (await GET(request())).json() as {memories:Array<{statement:string}>};
  assert.equal((await read()).memories[0]!.statement,"Use detailed answers.");
  assert.equal((await POST(request({action:"clear"}))).status,400);
  assert.equal((await read()).memories.length,1);
  assert.equal((await POST(request({action:"delete",memoryId:id}))).status,200);
  assert.deepEqual((await read()).memories,[]);
  assert.equal((await POST(request(create))).status,200);
  assert.equal((await POST(request({action:"clear",confirmation:"CLEAR"}))).status,200);
  assert.deepEqual((await read()).memories,[]);
});

test("memory settings remain usable without encryption while new sensitive or unencrypted entries are refused",async context=>{
  const {request}=setup(context);
  const create={action:"create",locale:"en",category:"user_instruction",statement:"My password is secret.",scope:"global"};
  const credential=await POST(request({...create,confirmSensitive:true}));assert.equal(credential.status,400);
  assert.equal((await credential.json() as {code:string}).code,"MEMORY_CREDENTIAL_FORBIDDEN");
  const sensitive={...create,category:"legal_context",statement:"My medical diagnosis is private."};
  assert.equal((await POST(request(sensitive))).status,400);
  assert.equal((await POST(request({...sensitive,confirmSensitive:true}))).status,200);
  assert.equal((await POST(request({action:"settings",automaticEnabled:false}))).status,200);
  const configured=await (await GET(request())).json() as {settings:{automaticEnabled:boolean}};
  assert.equal(configured.settings.automaticEnabled,false);
  Reflect.set(env,"IDENTITY_KEYRING","");
  const unavailable=await GET(request());assert.equal(unavailable.status,200);
  const body=await unavailable.json() as {available:boolean;memories:unknown[];code:string};
  assert.equal(body.available,false);assert.deepEqual(body.memories,[]);
  assert.equal(body.code,"MEMORY_ENCRYPTION_UNAVAILABLE");
  assert.equal((await POST(request({...create,statement:"Use concise answers."}))).status,503);
  assert.equal((await POST(request({action:"settings",automaticEnabled:true}))).status,503);
  assert.equal((await POST(request({action:"settings",automaticEnabled:false}))).status,200);
  assert.equal((await POST(request({action:"clear",confirmation:"CLEAR"}))).status,200);
});

test("memory HTTP boundary rejects unauthenticated, cross-origin and forged-scope requests",async context=>{
  const {request}=setup(context);
  assert.equal((await GET(new Request("https://app.example/api/platform/ai/memory"))).status,401);
  const foreign=request({action:"clear",confirmation:"CLEAR"});foreign.headers.set("origin","https://foreign.example");
  assert.equal((await POST(foreign)).status,403);
  const noCsrf=request({action:"clear",confirmation:"CLEAR"});noCsrf.headers.delete("x-juro-csrf");
  assert.equal((await POST(noCsrf)).status,403);
  const forged=request();forged.headers.set("x-juro-workspace-id",`ws_${"a".repeat(32)}`);
  assert.equal((await GET(forged)).status,404);
  assert.equal((await POST(request({action:"settings",automaticEnabled:false,userId:"other-user"}))).status,400);
  const invalidLocale=request();
  assert.equal((await GET(new Request(invalidLocale.url.replace("locale=en","locale=invalid"),invalidLocale))).status,400);
});

test("selected workspace memory reads and clears preserve another workspace's entries",async context=>{
  const {request,sqlite}=setup(context);
  await GET(request());
  const owner=sqlite.prepare("SELECT id FROM user_profiles WHERE email=?").get("owner@example.test") as {id:string};
  const selectedId=`ws_${"b".repeat(32)}`,now=new Date().toISOString();
  sqlite.prepare("INSERT INTO workspaces(id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES (?,'business','Selected workspace','Selected workspace','Selected','en',?,?)").run(selectedId,now,now);
  sqlite.prepare("INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?,?)")
    .run(crypto.randomUUID(),selectedId,owner.id,now,now,now);
  const selected=(body?:unknown)=>{const value=request(body);value.headers.set("x-juro-workspace-id",selectedId);return value;};
  const create=(statement:string,scope="workspace")=>({action:"create",category:"company",statement,scope});
  assert.equal((await POST(request(create("Default workspace fact.")))).status,200);
  assert.equal((await POST(selected(create("Selected workspace fact.")))).status,200);
  assert.equal((await POST(request(create("Global preference.","global")))).status,200);
  const statements=async(request:Request)=>{
    const response=await GET(request);assert.equal(response.status,200);
    return (await response.json() as {memories:Array<{statement:string}>}).memories.map(memory=>memory.statement).sort();
  };
  assert.deepEqual(await statements(request()),["Default workspace fact.","Global preference."]);
  assert.deepEqual(await statements(selected()),["Global preference.","Selected workspace fact."]);
  assert.equal((await POST(selected({action:"clear",confirmation:"CLEAR"}))).status,200);
  assert.deepEqual(await statements(selected()),[]);
  assert.deepEqual(await statements(request()),["Default workspace fact."]);
});

test("text chat reads manual memory independently of the account identity migration mode",async context=>{
  const {request}=setup(context);
  assert.equal((await POST(request({action:"create",category:"answer_style",statement:"Use concise answers.",scope:"global"}))).status,200);
  let modelCalls=0;
  const providerInputs:Array<{userContext?:{memories?:Array<{statement:string}>}}> = [];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    modelCalls++;
    const payload=JSON.parse(String(init?.body));
    providerInputs.push(JSON.parse(payload.input));
    return Response.json({id:"offline",model:payload.model,output:[{content:[{type:"output_text",text:JSON.stringify({
      interpretation:{topics:["Applicable law at the event date"],facts:[],temporal:{kind:"unresolved"},questions:["Which event date applies?"],selectedMemoryIds:[]},
      research:{underlyingRuleQueries:[],directQueries:[{text:"applicable rules at the event date",topicIndices:[0]}]},
    })}]}],usage:{input_tokens:0,output_tokens:0}});
  });
  const chatRequest=(key:string)=>new Request("https://app.example/api/platform/ai",{method:"POST",headers:request().headers,
    body:JSON.stringify({question:"Which deadline applied on that date?",locale:"en",idempotencyKey:key})});
  const answered=await submitChat(chatRequest("memory-chat-available"));
  assert.equal(answered.status,200);
  const saved=await answered.json() as {result:{responseKind:string;clarificationQuestions:string[];failureReason?:string}};
  assert.equal(saved.result.responseKind,"clarification_required");
  assert.deepEqual(providerInputs[0]?.userContext?.memories?.map(memory=>memory.statement),["Use concise answers."]);
  assert.deepEqual(saved.result.clarificationQuestions,["Which event date applies?"]);
  assert.equal(saved.result.failureReason,undefined);
  assert.equal(modelCalls,1);
  Reflect.set(env,"IDENTITY_KEYRING","");
  const unavailable=await submitChat(chatRequest("memory-chat-unavailable"));
  assert.equal(unavailable.status,503);
  assert.equal(modelCalls,1,"Unreadable saved memory must not be silently omitted from a new request");
  const replay=await submitChat(chatRequest("memory-chat-available"));assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),saved);
  assert.equal(modelCalls,1,"A completed answer replays without reopening later unreadable memory");
});
