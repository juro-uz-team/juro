import assert from "node:assert/strict";
import test from "node:test";
import {createPreparedQueryEmbedding} from "../lib/legal-corpus/prepared-query-embedding";

function fixture(options:{exhausted?:boolean;usageFailure?:boolean;response?:()=>Response;abortAfterReserve?:AbortController}={}){
  const calls:string[]=[];const bindings:unknown[][]=[];let request:RequestInit|undefined;
  const database={prepare(sql:string){return {bind(...values:unknown[]){bindings.push(values);return {
    async first(){calls.push("reserve");options.abortAfterReserve?.abort();return options.exhausted?null:{reservedUsdMicros:1065};},
    async run(){calls.push(sql.includes("query_usage")?"usage":"receipt");return {success:!options.usageFailure};},
  };}};}} as unknown as D1Database;
  const vector=Array.from({length:3072},(_,index)=>index===0?1:0);
  const embeddingFetch:typeof fetch=async(url,init)=>{
    calls.push("fetch");assert.equal(url,"https://api.openai.com/v1/embeddings");request=init;
    return options.response?.()??Response.json({model:"text-embedding-3-large",data:[{index:0,embedding:vector}],
      usage:{prompt_tokens:10,total_tokens:10}});
  };
  const input={environment:"staging",releaseId:"prepared-release",apiKey:"test-only-key",budgetDatabase:database,
    budgetMode:"capped" as const,fetch:embeddingFetch};
  return {input,calls,bindings,vector,request:()=>request};
}

test("prepared embedding reserves before exact-text 3072-dimensional request without caching",async()=>{
  const f=fixture();const embed=createPreparedQueryEmbedding(f.input);const query="  exact private formulation  ";
  assert.deepEqual(await embed(query,new AbortController().signal),f.vector);
  assert.deepEqual(f.calls,["reserve","receipt","fetch"]);
  assert.deepEqual(JSON.parse(String(f.request()!.body)),{model:"text-embedding-3-large",dimensions:3072,encoding_format:"float",input:[query]});
  assert.equal(f.request()!.redirect,"error");assert.equal(f.request()!.cache,"no-store");
  assert.equal(JSON.stringify(f.bindings).includes(query),false);
  await embed(query,new AbortController().signal);
  assert.equal(f.calls.filter(value=>value==="fetch").length,2);
});

test("budget exhaustion, failed metering and cancellation prevent paid requests",async()=>{
  const exhausted=fixture({exhausted:true});
  await assert.rejects(createPreparedQueryEmbedding(exhausted.input)("query",new AbortController().signal),/BUDGET_EXHAUSTED/);
  assert.deepEqual(exhausted.calls,["reserve"]);
  const failed=fixture({usageFailure:true});
  await assert.rejects(createPreparedQueryEmbedding({...failed.input,budgetMode:"metered"})("query",new AbortController().signal),/USAGE_UNAVAILABLE/);
  assert.deepEqual(failed.calls,["usage"]);
  const capped=fixture({usageFailure:true});
  await assert.rejects(createPreparedQueryEmbedding(capped.input)("query",new AbortController().signal),/USAGE_UNAVAILABLE/);
  assert.deepEqual(capped.calls,["reserve","receipt"]);
  const controller=new AbortController();const aborted=fixture({abortAfterReserve:controller});
  await assert.rejects(createPreparedQueryEmbedding(aborted.input)("query",controller.signal));
  assert.equal(aborted.calls.includes("fetch"),false);
  const invalid=fixture();const embed=createPreparedQueryEmbedding(invalid.input);
  for(const value of [" ","x".repeat(901)])await assert.rejects(embed(value,new AbortController().signal),/QUERY_INVALID/);
  assert.deepEqual(invalid.calls,[]);
});

test("provider errors, wrong dimensions and streamed oversize responses fail without retry",async()=>{
  for(const response of [()=>new Response("sensitive upstream error",{status:503}),
    ()=>Response.json({model:"text-embedding-3-large",data:[{index:0,embedding:[1]}],usage:{prompt_tokens:1,total_tokens:1}}),
    ()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(128*1024+1));controller.close();}}))]){
    const f=fixture({response});
    await assert.rejects(createPreparedQueryEmbedding(f.input)("query",new AbortController().signal),error=>{
      assert.ok(error instanceof Error);assert.match(error.message,/PREPARED_EMBEDDING_/);assert.doesNotMatch(error.message,/sensitive/);return true;
    });
    assert.equal(f.calls.filter(value=>value==="fetch").length,1);
  }
});
