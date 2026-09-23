import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {runStagingProviderProbes} from "../worker/staging-provider-probe";

test("staging probes exercise retained transports and replacement storage without reporting a useful legal answer",async context=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));context.after(()=>sqlite.close());
  const oldOpenAi=env.OPENAI_API_KEY,oldAnthropic=env.ANTHROPIC_API_KEY;
  env.OPENAI_API_KEY="test-key";env.ANTHROPIC_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldOpenAi;env.ANTHROPIC_API_KEY=oldAnthropic;});
  const calls:string[]=[];
  let invalid=false;
  context.mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));calls.push(String(url));
    const output={status:invalid?"wrong":"ok"};
    return String(url).includes("anthropic")?Response.json({id:"probe",model:body.model,
      content:[{type:"text",text:JSON.stringify(output)}],usage:{input_tokens:1,output_tokens:1}}):
      Response.json({id:"probe",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}],usage:{input_tokens:1,output_tokens:1}});
  });
  const bindings={DB:d1,APP_ENV:"staging",STAGING_SYNTHETIC_PROBES_ENABLED:"true"};
  assert.equal(await runStagingProviderProbes({...bindings,APP_ENV:"production"}),null);
  assert.equal(calls.length,0);
  const first=await runStagingProviderProbes(bindings);
  assert.equal(first?.succeeded,2);assert.equal(first?.failed,0);assert.equal(calls.length,2);
  const observations=sqlite.prepare("SELECT first_useful_stage,first_useful_latency_ms,provider_ttft_ms FROM ai_slo_telemetry_events").all();
  assert.equal(observations.length,2);
  assert.ok(observations.every(row=>row.first_useful_stage==="none"&&row.first_useful_latency_ms===null&&row.provider_ttft_ms===null));
  for(const table of ["user_profiles","workspaces","conversations","ai_runs","idempotency_keys"])
    assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0,table);
  invalid=true;
  const failed=await runStagingProviderProbes(bindings);
  assert.equal(failed?.failed,2);assert.equal(calls.length,4,"No fallback or automatic retry after invalid structured output");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM staging_provider_probes WHERE status='failed'").get()?.n,2);
  invalid=false;
  const providerFailures=sqlite.prepare("SELECT count(*) AS n FROM dependency_health_checks WHERE dependency_key='openai' AND state<>'operational'").get()?.n;
  sqlite.exec("CREATE TRIGGER fail_probe_storage BEFORE INSERT ON conversation_messages BEGIN SELECT RAISE(ABORT,'SYNTHETIC_STORAGE_FAILURE'); END");
  const storageFailure=await runStagingProviderProbes(bindings);
  assert.equal(storageFailure?.failed,1);assert.equal(storageFailure?.succeeded,1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM staging_provider_probes WHERE error_code='PROBE_PERSISTENCE_FAILED'").get()?.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM dependency_health_checks WHERE dependency_key='openai' AND state<>'operational'").get()?.n,providerFailures);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM ai_slo_telemetry_events WHERE safe_error_code='AI_SLO_PERSISTENCE_FAILED'").get()?.n,1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM user_profiles").get()?.n,0);
  sqlite.exec("DROP TRIGGER fail_probe_storage");
  const actualNow=Date.now.bind(Date);
  const actualMonotonicNow=performance.now.bind(performance);
  let elapsed=0;
  context.mock.method(Date,"now",()=>actualNow()+elapsed);
  context.mock.method(performance,"now",()=>actualMonotonicNow()+elapsed);
  sqlite.function("delay_probe_storage",()=>{elapsed=29_000;return 0;});
  sqlite.exec("CREATE TRIGGER delay_probe_storage BEFORE INSERT ON conversation_messages BEGIN SELECT delay_probe_storage(); END");
  const delayed=await runStagingProviderProbes(bindings);
  assert.ok((delayed?.failed??0)>=1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM dependency_health_checks WHERE dependency_key='openai' AND state<>'operational'").get()?.n,providerFailures,
    "Successful provider calls followed by slow local storage do not establish a provider outage");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM user_profiles").get()?.n,0);
});
