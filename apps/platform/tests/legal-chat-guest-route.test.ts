import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {GET,POST} from "../app/api/guest/ai/route";

test("guest HTTP boundary rejects cross-origin writes and disabled requests before any paid work",async context=>{
  const old=env.GUEST_AI_ENABLED;Reflect.set(env,"GUEST_AI_ENABLED","false");context.after(()=>{env.GUEST_AI_ENABLED=old;});
  const denied=await POST(new Request("https://app.example/api/guest/ai",{method:"POST",headers:{origin:"https://foreign.example","x-juro-csrf":"1"}}));
  assert.equal(denied.status,403);
  const disabled=await GET(new Request("https://app.example/api/guest/ai"));
  assert.equal(disabled.status,404);assert.match(disabled.headers.get("cache-control")!,/no-store/);
  assert.equal((await disabled.json() as {code:string}).code,"GUEST_AI_DISABLED");
});


test("guest HTTP submission requires a verified challenge, saves encrypted clarification and replays with its cookie",async context=>{
  const {sqliteD1FixtureFromDirectory}=await import("./helpers/sqlite-d1");
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));context.after(()=>sqlite.close());
  const bindings={GUEST_AI_ENABLED:"true",APP_ENV:"development",DB:d1,OPENAI_API_KEY:"offline-key",TURNSTILE_SITE_KEY:"offline-site",TURNSTILE_SECRET_KEY:"offline-secret",
    IDENTITY_PROTECTION_MODE:"dual_write",IDENTITY_KEYRING:JSON.stringify({active:"test",versions:{test:{aead:Buffer.alloc(32,1).toString("base64url"),hmac:Buffer.alloc(32,2).toString("base64url")}}}),
    LEGAL_RETRIEVAL_SERVICE:{async openLegalResearch(){assert.fail("Clarification must not research");}}};
  const previous=Object.fromEntries(Object.keys(bindings).map(key=>[key,Reflect.get(env,key)]));
  Object.assign(env,bindings);context.after(()=>{Object.assign(env,previous);});
  let modelCalls=0,challengeCalls=0;
  context.mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    if(String(url).includes("turnstile")){
      challengeCalls++;return Response.json({success:body.response==="valid",action:"guest_ai",hostname:"app.example"});
    }
    modelCalls++;assert.equal(body.model,"gpt-5.6-luna");
    return Response.json({id:"offline-response",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify({topics:["Applicable rules"],facts:[],temporal:{kind:"unresolved"},questions:["Which date applies?"]})}]}]});
  });
  const request=(token:string,cookie?:string)=>new Request("https://app.example/api/guest/ai",{method:"POST",
    headers:{origin:"https://app.example","x-juro-csrf":"1","content-type":"application/json","cf-connecting-ip":"203.0.113.1",...(cookie?{cookie}:{})},
    body:JSON.stringify({question:"Private guest request",locale:"en",idempotencyKey:"guest-http-request",turnstileToken:token})});
  const invalid=await POST(request("invalid"));assert.equal(invalid.status,400);assert.equal(modelCalls,0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM guest_ai_sessions").get()?.n,0);
  const accepted=await POST(request("valid"));assert.equal(accepted.status,200);
  const cookie=accepted.headers.get("set-cookie")!.split(";")[0]!;
  assert.match(accepted.headers.get("set-cookie")!,/HttpOnly; SameSite=Strict; Secure/);
  const saved=await accepted.json();
  const replay=await POST(request("",cookie));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),saved);
  assert.equal(modelCalls,1);assert.equal(challengeCalls,2);
  const bootstrap=await GET(new Request("https://app.example/api/guest/ai",{headers:{cookie}}));
  const body=await bootstrap.json() as {session:{state:string};result:{responseKind:string}};
  assert.equal(body.session.state,"available");assert.equal(body.result.responseKind,"clarification_required");
  assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM guest_ai_runs").all()),/Private guest request|Which date/);
});
