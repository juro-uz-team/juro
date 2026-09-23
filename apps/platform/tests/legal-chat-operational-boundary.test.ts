import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {GET as chatStatus,POST as signedInChat} from "../app/api/platform/ai/route";
import {POST as guestChat} from "../app/api/guest/ai/route";
import {setOperationalFeature} from "../lib/operations/operational-feature-flags";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";

test("operator chat pause blocks signed-in and guest work before attempts, reservations or guest challenge",async context=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));context.after(()=>sqlite.close());
  const bindings={DB:d1,APP_ENV:"development",ALLOW_PLATFORM_AUTH_HEADERS:"true",IDENTITY_PROTECTION_MODE:"legacy",
    GUEST_AI_ENABLED:"true",OPENAI_API_KEY:"offline-key",TURNSTILE_SITE_KEY:"offline-site",TURNSTILE_SECRET_KEY:"offline-secret",
    IDENTITY_KEYRING:JSON.stringify({active:"test",versions:{test:{aead:Buffer.alloc(32,1).toString("base64url"),hmac:Buffer.alloc(32,2).toString("base64url")}}}),
    LEGAL_RETRIEVAL_SERVICE:{async openLegalResearch(){assert.fail("Paused chat must not research");}}};
  const previous=Object.fromEntries(Object.keys(bindings).map(key=>[key,Reflect.get(env,key)]));
  Object.assign(env,bindings);context.after(()=>Object.assign(env,previous));
  const headers={"oai-authenticated-user-email":"owner@example.test",origin:"https://app.example","x-juro-csrf":"1","content-type":"application/json"};
  assert.equal((await chatStatus(new Request("https://app.example/api/platform/ai",{headers}))).status,200);
  const actorUserId=String(sqlite.prepare("SELECT id FROM user_profiles LIMIT 1").get()?.id);
  await setOperationalFeature({db:d1,environment:"development",actorUserId,value:{key:"ai_chat",enabled:false,reason:"Provider incident pauses new legal chat requests."}});
  let networkCalls=0;context.mock.method(globalThis,"fetch",async()=>{networkCalls++;throw Error("Unexpected network request while paused");});
  for(const [route,url] of [[signedInChat,"/api/platform/ai"],[guestChat,"/api/guest/ai"]] as const){
    for(const accept of ["application/json","text/event-stream"]){
      const reply=await route(new Request("https://app.example"+url,{method:"POST",headers:{...headers,accept},
        body:JSON.stringify({question:"Which rules apply?",locale:"en",idempotencyKey:"paused-chat-request"})}));
      assert.equal(reply.status,503);assert.match(reply.headers.get("cache-control")!,/no-store/);
      assert.equal((await reply.json() as {code:string}).code,"OPERATIONAL_FEATURE_DISABLED");
      assert.equal(reply.headers.get("set-cookie"),null);
    }
  }
  assert.equal(networkCalls,0);
  for(const table of ["ai_runs","ai_usage_ledger","ai_provider_usage_events","guest_ai_sessions","guest_ai_runs"]){
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,0);
  }
  assert.equal((await chatStatus(new Request("https://app.example/api/platform/ai",{headers}))).status,200,"saved history remains readable while new work is paused");
});
