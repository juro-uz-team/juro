import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";

import { buildCustomBm25Artifacts, customBm25TermHash } from "../lib/legal-corpus/custom-bm25";
import { buildCustomBm25RuntimeArtifacts } from "../lib/legal-corpus/custom-bm25-runtime";
import { handleCustomSearchRequest, fuseCustomProvisionMatches, type CustomSearchEnv }
  from "../lib/legal-corpus/custom-search-service";
import {CustomRuntimeCache} from "../lib/legal-corpus/custom-runtime-cache";
import {buildCandidateMembershipTree} from "../lib/legal-corpus/candidate-membership-proof";
import {customRuntimeLegalIdentitySchema} from "../lib/legal-corpus/custom-bm25-runtime";

const RELEASE_ID = "release:staging:current:custom-v1";
const DENSE_METADATA_RELEASE_ID = "release:staging:current:custom-v0";
const INSTANCE_ID = "custom-current-staging-v1";
const ITEM_KEY = `retrieval-chunk-v1:${"1".repeat(64)}`;

test("an article number cannot override agreement between both retrieval lanes", () => {
  const hits = fuseCustomProvisionMatches(["operative", "cross-reference"], ["cross-reference"], new Set(["operative"]), 1);
  assert.equal(hits[0]?.itemKey, "cross-reference");
  assert.ok(hits[0]!.score < 1);
  assert.equal(fuseCustomProvisionMatches(["operative", "cross-reference"], ["cross-reference"], new Set(), 1)[0]?.itemKey, "cross-reference");
  assert.deepEqual(fuseCustomProvisionMatches([], [], new Set(), 5), []);
});

class MemoryR2 {
  readonly objects = new Map<string, Uint8Array>();
  readonly reads = new Map<string, number>();
  onRead?: (key: string) => void | Promise<void>;
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    await this.onRead?.(key);
    const source = this.objects.get(key);
    if (!source) return null;
    const bytes = options?.range
      ? source.slice(options.range.offset, options.range.offset + options.range.length)
      : source;
    return { size: bytes.byteLength, body: new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }), async arrayBuffer() { return bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  }
}

const searchCases: Array<{oversizedPosting:boolean;physicalAlias:boolean;separateBudget:boolean;
  budgetMode?:"metered"|"capped";budgetState?:"missing"|"exhausted";usageFailure?:"throws"|"rejected"}> = [
  { oversizedPosting: false, physicalAlias: false, separateBudget:false },
  { oversizedPosting: true, physicalAlias: false, separateBudget:false },
  { oversizedPosting: false, physicalAlias: true, separateBudget:false },
  { oversizedPosting: false, physicalAlias: false, separateBudget:true },
  {oversizedPosting:false,physicalAlias:false,separateBudget:true,budgetMode:"metered",budgetState:"missing"},
  {oversizedPosting:false,physicalAlias:false,separateBudget:true,budgetMode:"metered",budgetState:"exhausted"},
  {oversizedPosting:false,physicalAlias:false,separateBudget:true,budgetMode:"capped",budgetState:"missing"},
  {oversizedPosting:false,physicalAlias:false,separateBudget:true,budgetMode:"capped",budgetState:"exhausted"},
  {oversizedPosting:false,physicalAlias:false,separateBudget:true,budgetMode:"metered",usageFailure:"throws"},
  {oversizedPosting:false,physicalAlias:false,separateBudget:true,budgetMode:"metered",usageFailure:"rejected"},
];
for (const { oversizedPosting, physicalAlias, separateBudget,budgetMode,budgetState,usageFailure } of searchCases) {
test(budgetMode ? `${budgetMode} search with ${usageFailure?`usage append ${usageFailure}`:`${budgetState} monthly budget`}` : separateBudget ? "shared read-only catalog keeps search reservations in the private budget database" : physicalAlias
  ? "private custom search can reuse an immutable physical release behind a logical production release"
  : oversizedPosting
    ? "private custom search treats an oversized matched posting as a sparse stop word"
    : "private custom search reserves budget and fuses verified sparse and dense lanes", async context => {
  const environment=budgetMode?"production":"staging";
  const accounting=budgetMode?new DatabaseSync(":memory:"):undefined;
  if(accounting){
    context.after(()=>accounting.close());
    accounting.exec(await readFile(new URL("../legal-drizzle/0025_custom_search_runtime.sql",import.meta.url),"utf8"));
    accounting.exec(await readFile(new URL("../legal-drizzle/0034_live_query_usage.sql",import.meta.url),"utf8"));
    accounting.exec("PRAGMA foreign_keys=ON");
    accounting.prepare(`INSERT INTO legal_custom_query_budget_periods
      (environment,period,authorized_usd_micros,reserved_usd_micros,created_at) VALUES (?,?,?,?,?)`)
      .run(environment,budgetState==="exhausted"?new Date().toISOString().slice(0,7):"2000-01",1065,
        budgetState==="exhausted"?1065:0,new Date().toISOString());
  }
  const physicalReleaseId = physicalAlias ? DENSE_METADATA_RELEASE_ID : RELEASE_ID;
  const built = await buildCustomBm25Artifacts([{
    segmentId: "current-base-v1", itemKey: ITEM_KEY, language: "en", documentType: "law",
    validFromEpoch: 1, validToEpoch: null,
    fields: { title: "Work law", hierarchy: "", article: "Article 1", text: "work contract" },
  }], { analyzer: "word-v1" });
  let oversizedLexicon: { key: string; bytes: Uint8Array } | undefined;
  if (oversizedPosting) {
    const termHash = await customBm25TermHash("work");
    const reference = built.manifest.segments[0]!.lexicons[termHash[0]!]!;
    const artifact = built.artifacts.find((entry) => entry.key === reference.key)!;
    const lexicon = JSON.parse(new TextDecoder().decode(artifact.bytes)) as Record<string,
      { length: number; sizeBytes: number }>;
    lexicon[termHash]!.length = 1024 * 1024 + 1;
    lexicon[termHash]!.sizeBytes = lexicon[termHash]!.length;
    const bytes = new TextEncoder().encode(JSON.stringify(lexicon));
    built.manifest.segments[0]!.lexicons[termHash[0]!] = {
      key: reference.key, sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    oversizedLexicon = { key: reference.key, bytes };
  }
  const runtime = await buildCustomBm25RuntimeArtifacts({ releaseId: physicalReleaseId,
    ...(physicalAlias ? {} : { denseMetadataReleaseId: DENSE_METADATA_RELEASE_ID }),
    sparseManifestSha256: "a".repeat(64), manifest: built.manifest });
  const bucket = new MemoryR2();
  let sparseStarted!: () => void;
  const sparseReady = new Promise<void>(resolve => { sparseStarted = resolve; });
  let measureSparseReads = false;
  let activeSparseReads = 0;
  let maximumSparseConcurrency = 0;
  bucket.onRead = async key => {
    if (key !== runtime.documentsReference.key) return;
    sparseStarted();
    if (!measureSparseReads) return;
    activeSparseReads++;
    maximumSparseConcurrency = Math.max(maximumSparseConcurrency, activeSparseReads);
    try { await new Promise(resolve => setTimeout(resolve, 20)); }
    finally { activeSparseReads--; }
  };
  bucket.objects.set(runtime.descriptorReference.key, runtime.descriptorBytes);
  bucket.objects.set(runtime.documentsReference.key, runtime.documentsBytes);
  for (const page of runtime.ordinalMappingPages) bucket.objects.set(page.reference.key, page.bytes);
  for (const artifact of built.artifacts) bucket.objects.set(artifact.key, artifact.bytes);
  if (oversizedLexicon) bucket.objects.set(oversizedLexicon.key, oversizedLexicon.bytes);
  const calls: string[] = [];
  const usageRows: unknown[][] = [];
  const fullKey = `search-releases/${RELEASE_ID}/${ITEM_KEY}`;
  let publication: Record<string, unknown> | null = null;
  const database = {
    prepare(sql: string) {
      return {
        bind(...values:unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM legal_candidate_membership_projections")) return publication;
              calls.push(sql.trim().startsWith("UPDATE") ? "reserve" : "component");
              if (sql.includes("runtime_descriptor_r2_key")) return {
                descriptorKey: runtime.descriptorReference.key,
                descriptorSha256: runtime.descriptorReference.sha256,
                sparseManifestSha256: "a".repeat(64),
                mappingInventorySha256:"c".repeat(64),mappingCount:1,
              };
              if(accounting && sql.includes("UPDATE legal_custom_query_budget_periods"))
                return accounting.prepare(sql).get(...values as Array<string|number>)??null;
              return { reservedUsdMicros: 1_065 };
            },
            async run() {
              if(sql.includes("legal_custom_query_usage")){
                if(usageFailure==="throws")throw Error("USAGE_APPEND_UNAVAILABLE");
                if(usageFailure==="rejected")return {success:false};
                usageRows.push(values);
              }
              if(accounting && sql.includes("legal_custom_query_"))accounting.prepare(sql).run(...values as Array<string|number>);
              calls.push("ledger"); return { success: true };
            },
            async all() { return { results: [{ ordinal: 0, itemKey: fullKey }] }; },
          };
        },
      };
    },
  } as unknown as D1Database;
  const observed = { denseOptions: null as VectorizeQueryOptions | null };
  let activeEmbeddingRequests = 0;
  let maximumEmbeddingConcurrency = 0;
  let delayNextEmbedding = false;
  let embeddingStarted!: () => void;
  let releaseEmbedding!: () => void;
  const delayedEmbeddingStarted = new Promise<void>(resolve => { embeddingStarted = resolve; });
  const delayedEmbeddingRelease = new Promise<void>(resolve => { releaseEmbedding = resolve; });
  const embeddingBatchSizes: number[] = [];
  const denseVectorStarts:number[][]=[];
  const dense = {
    async query(_vector: number[], options: VectorizeQueryOptions) {
      denseVectorStarts.push(_vector.slice(0,3));
      observed.denseOptions = options;
      return { count: 1, matches: [{ id: "b".repeat(64), score: 0.9,
        metadata: { item_key: ITEM_KEY, release_id: DENSE_METADATA_RELEASE_ID, language: "en",
          document_type: "law", valid_from_epoch: 1, valid_to_epoch: 253_402_300_799 } }] };
    },
  } as unknown as VectorizeIndex;
  const env = {
    APP_ENV: environment,
    ...(budgetMode?{CUSTOM_QUERY_BUDGET_MODE:budgetMode}:{}),
    CUSTOM_SEARCH_CAPABILITY: "current",
    OPENAI_API_KEY: "fixture-key",
    CUSTOM_SEARCH_RELEASE_ID: RELEASE_ID,
    ...(physicalAlias ? { CUSTOM_SEARCH_PHYSICAL_RELEASE_ID: physicalReleaseId } : {}),
    CUSTOM_SEARCH_INSTANCE_ID: INSTANCE_ID,
    CUSTOM_SEARCH_SHARD_ID: "current-base-v1",
    CUSTOM_RUNTIME_DESCRIPTOR_KEY: runtime.descriptorReference.key,
    CUSTOM_RUNTIME_DESCRIPTOR_SHA256: runtime.descriptorReference.sha256,
    ARTIFACTS: bucket as unknown as R2Bucket,
    CATALOG_DB: database,
    EMBEDDING_FETCH: async (_url: string | URL | Request, options?: RequestInit) => {
      const inputs: string[] = JSON.parse(String(options?.body)).input;
      embeddingBatchSizes.push(inputs.length);
      activeEmbeddingRequests++;
      maximumEmbeddingConcurrency = Math.max(maximumEmbeddingConcurrency, activeEmbeddingRequests);
      if (delayNextEmbedding) {
        delayNextEmbedding = false;
        embeddingStarted();
        await delayedEmbeddingRelease;
      }
      if (!oversizedPosting) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([sparseReady, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("sparse retrieval waited for embeddings")), 1_000);
          })]);
        } finally { clearTimeout(timer); }
      }
      activeEmbeddingRequests--;
      assert.deepEqual(calls.slice(0, budgetMode==="metered"?2:3), budgetMode==="metered"?["component","ledger"]:["component", "reserve", "ledger"]);
      return Response.json({ model: "text-embedding-3-large", object: "list",
        data: inputs.map((_, inputIndex) => ({ object: "embedding", index: inputIndex,
          embedding: Array.from({ length: 1_536 }, (_, index) => index === inputIndex ? 1 : 0) })),
        usage: { prompt_tokens: inputs.length, total_tokens: inputs.length } });
    },
    DENSE: dense,
  } satisfies CustomSearchEnv;
  if(separateBudget){
    env.CATALOG_DB=new Proxy(database,{get(target,key,receiver){
      if(key==="prepare")return (sql:string)=>{
        assert.ok(!/\b(?:UPDATE|INSERT|DELETE)\b/i.test(sql),"Shared catalog must not receive writes");
        return database.prepare(sql);
      };
      return Reflect.get(target,key,receiver);
    }});
    Object.assign(env,{BUDGET_DB:{...database,prepare(sql:string){
      assert.match(sql,/legal_custom_query_(?:budget_periods|reservations|usage)/);
      if(budgetMode==="metered")assert.ok(!sql.includes("budget_periods"),"Live usage must not depend on a calendar grant");
      return database.prepare(sql);
    }}});
  }
  const body = JSON.stringify({ releaseId: RELEASE_ID, instanceIds: [INSTANCE_ID], query: "work",
    currentAt: "2026-09-05T00:00:00.000Z",
    endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0 });
  const response = await handleCustomSearchRequest(new Request(
    "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
      method: "POST", headers: { "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "x-juro-service-binding": "custom-search-runtime-v1",
        "x-juro-legal-environment": environment }, body,
    }), env);
  if(usageFailure || budgetMode==="capped"&&budgetState){
    assert.equal(response.status,503);
    assert.equal(embeddingBatchSizes.length,0,"Failed accounting or capped authorization must stop before provider dispatch");
    return;
  }
  assert.equal(response.status, 200);
  if(budgetMode==="metered"){
    assert.equal(usageRows.length,1);
    assert.equal(usageRows[0]?.[1],"production");
    assert.equal(usageRows[0]?.[2],RELEASE_ID);
    assert.equal(usageRows[0]?.[3],1065);
    assert.equal(usageRows[0]?.[4],1);
    assert.equal(calls.includes("reserve"),false);
    assert.equal(accounting!.prepare("SELECT count(*) AS n FROM legal_custom_query_usage").get()?.n,1);
    assert.equal(accounting!.prepare("SELECT count(*) AS n FROM legal_custom_query_budget_periods").get()?.n,1,
      "Live usage neither creates a monthly authorization nor increases an exhausted one");
    assert.equal(accounting!.prepare("SELECT authorized_usd_micros FROM legal_custom_query_budget_periods").get()?.authorized_usd_micros,1065);
    assert.equal(accounting!.prepare("SELECT reserved_usd_micros FROM legal_custom_query_budget_periods").get()?.reserved_usd_micros,budgetState==="exhausted"?1065:0);
  }
  const result = await response.json() as { hits: Array<{ itemKey: string; keywordRank: number;
    vectorRank: number }>; tokenUsage: number };
  assert.deepEqual(result.hits.map((hit) => hit.itemKey), [fullKey]);
  assert.equal(result.hits[0]?.keywordRank, oversizedPosting ? 1 : 1);
  assert.equal(result.hits[0]?.vectorRank, 1);
  assert.equal(result.tokenUsage, 1);
  assert.deepEqual(observed.denseOptions?.filter, {
    valid_from_epoch: { $lte: 1_788_566_400 },
    valid_to_epoch: { $gt: 1_788_566_400 },
  });
  if (!oversizedPosting) {
    bucket.reads.clear();
    const batchBody = JSON.stringify({ releaseId: RELEASE_ID, instanceIds: [INSTANCE_ID],
      queries: ["work", "contract"], currentAt: "2026-09-05T00:00:00.000Z",
      endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0 });
    const batchResponse = await handleCustomSearchRequest(new Request(
      "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
        method: "POST", headers: { "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(batchBody).byteLength),
          "x-juro-service-binding": "custom-search-runtime-v1",
          "x-juro-legal-environment": environment }, body: batchBody,
      }), env);
    assert.equal(batchResponse.status, 200);
    const batchResult = await batchResponse.json() as {
      results: Array<{ queryIndex: number; hits: Array<{ itemKey: string }> }>;
      tokenUsage: number;
    };
    assert.deepEqual(batchResult.results.map((entry) => entry.queryIndex), [0, 1]);
    assert.deepEqual(batchResult.results.map((entry) => entry.hits[0]?.itemKey), [fullKey, fullKey]);
    assert.equal(batchResult.tokenUsage, 2);
    if(budgetMode==="metered"){
      assert.equal(usageRows.at(-1)?.[3],2130);
      assert.equal(usageRows.at(-1)?.[4],2);
    }
    assert.equal(embeddingBatchSizes.at(-1), 2);
    assert.equal(bucket.reads.get(runtime.documentsReference.key), 1,
      "the service must share sparse evidence-table reads across formulations");
    activeEmbeddingRequests = 0;
    maximumEmbeddingConcurrency = 0;
    const send = (searchEnv: CustomSearchEnv = env) => handleCustomSearchRequest(new Request(
      "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
        method: "POST", headers: { "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(body).byteLength),
          "x-juro-service-binding": "custom-search-runtime-v1",
          "x-juro-legal-environment": environment }, body,
      }), searchEnv);
    const repeatedBody=JSON.stringify({...JSON.parse(batchBody),queries:["work","contract","work"]});
    const callsBeforeRepeated=embeddingBatchSizes.length;
    const repeated=await handleCustomSearchRequest(new Request(
      "http://legal-corpus.internal/internal/legal-corpus/custom-search",{
        method:"POST",headers:{"content-type":"application/json",
          "content-length":String(new TextEncoder().encode(repeatedBody).byteLength),
          "x-juro-service-binding":"custom-search-runtime-v1","x-juro-legal-environment":environment},body:repeatedBody,
      }),env);
    assert.equal(repeated.status,200);
    const repeatedResult=await repeated.json() as typeof batchResult;
    assert.deepEqual(repeatedResult.results.map(entry=>entry.queryIndex),[0,1,2]);
    assert.deepEqual(repeatedResult.results[0]!.hits,repeatedResult.results[2]!.hits);
    assert.deepEqual(denseVectorStarts.slice(-3),[[1,0,0],[0,1,0],[1,0,0]],
      "each original formulation retains its corresponding dense vector");
    assert.equal(embeddingBatchSizes.length-callsBeforeRepeated,1);
    assert.equal(embeddingBatchSizes.at(-1),2,"identical formulations in one request need only one embedding");
    assert.equal(repeatedResult.tokenUsage,2,"usage reflects only unique provider inputs");
    bucket.reads.clear();
    const prepared=await send({...env,PREPARED_ORDINALS:async input=>{
      assert.deepEqual(input,{releaseId:RELEASE_ID,sourceInventorySha256:"c".repeat(64),memberCount:1,ordinals:[0]});
      return [ITEM_KEY];
    }});
    assert.equal(prepared.status,200);
    assert.deepEqual((await prepared.json() as {hits:Array<{itemKey:string}>}).hits.map(hit=>hit.itemKey),[fullKey]);
    assert.ok(runtime.ordinalMappingPages.every(page=>!bucket.reads.has(page.reference.key)));
    const unavailable=await send({...env,PREPARED_ORDINALS:async()=>{throw new Error("CORPUS_ORDINAL_MISSING");}});
    assert.notEqual(unavailable.status,200,"A broken verified inventory must not fall back to ordinal artifacts");
    assert.ok(runtime.ordinalMappingPages.every(page=>!bucket.reads.has(page.reference.key)));
    assert.equal((await send({...env,PREPARED_ORDINALS:async()=>null})).status,200);
    assert.ok(runtime.ordinalMappingPages.some(page=>bucket.reads.has(page.reference.key)));
    delayNextEmbedding = true;
    measureSparseReads = true;
    const delayed = send();
    await delayedEmbeddingStarted;
    const independent = send();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completedIndependently = false;
    try {
      completedIndependently = await Promise.race([independent.then(() => true), new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), 1_000);
      })]);
    } finally {
      clearTimeout(timer);
      releaseEmbedding();
    }
    const concurrent = await Promise.all([delayed, independent]);
    assert.deepEqual(concurrent.map((entry) => entry.status), [200, 200]);
    assert.equal(completedIndependently, true, "a slow embedding request must not block another complete search");
    assert.equal(maximumEmbeddingConcurrency, 2);
    assert.equal(maximumSparseConcurrency, 1, "memory-intensive artifact traversal remains serialized");
    measureSparseReads = false;
    // Independent corpus caches must not queue behind a stalled traversal,
    // while searches within one corpus retain their memory bound.
    const firstCache = new CustomRuntimeCache(0);
    const otherCache = new CustomRuntimeCache(0);
    const previousRead = bucket.onRead;
    let entered = 0;
    let releaseFirst!: () => void;
    let notifyFirst!: () => void;
    const firstStarted = new Promise<void>(resolve => { notifyFirst = resolve; });
    const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
    bucket.onRead = async key => {
      if (key !== runtime.documentsReference.key) return;
      entered++;
      if (entered === 1) { notifyFirst(); await firstRelease; }
    };
    const blockedCorpus = send({ ...env, RUNTIME_CACHE: firstCache });
    await firstStarted;
    const sameCorpus = send({ ...env, RUNTIME_CACHE: firstCache });
    const otherCorpus = send({ ...env, RUNTIME_CACHE: otherCache });
    let independentCorpusFinished = false;
    let enteredBeforeRelease = 0;
    try {
      independentCorpusFinished = await Promise.race([otherCorpus.then(() => true), new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), 1_000);
      })]);
      enteredBeforeRelease = entered;
    } finally { clearTimeout(timer); releaseFirst(); }
    const corpusResponses = await Promise.all([blockedCorpus, sameCorpus, otherCorpus]);
    bucket.onRead = previousRead;
    assert.deepEqual(corpusResponses.map(response => response.status), [200, 200, 200]);
    assert.equal(independentCorpusFinished, true, "an independent corpus must finish while another corpus is stalled");
    assert.equal(enteredBeforeRelease, 2, "the second traversal in the stalled corpus must remain queued");
    // A native server can admit two traversals while retaining a hard bound.
    const nativeCache = new CustomRuntimeCache(0);
    let nativeEntered = 0;
    let releaseNative!: () => void;
    let firstNative!: () => void;
    const nativeStarted = new Promise<void>(resolve => { firstNative = resolve; });
    const nativeRelease = new Promise<void>(resolve => { releaseNative = resolve; });
    bucket.onRead = async key => {
      if (key !== runtime.documentsReference.key) return;
      nativeEntered++;
      if (nativeEntered === 1) { firstNative(); await nativeRelease; }
    };
    const nativeEnv = {...env, RUNTIME_CACHE: nativeCache, SPARSE_TRAVERSAL_CONCURRENCY: 2 as const};
    const slowNative = send(nativeEnv);
    await nativeStarted;
    const fastNative = send(nativeEnv);
    let nativeFinished = false;
    try {
      nativeFinished = await Promise.race([fastNative.then(() => true), new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), 1_000);
      })]);
    } finally { clearTimeout(timer); releaseNative(); }
    const nativeResponses = await Promise.all([slowNative, fastNative]);
    bucket.onRead = previousRead;
    assert.deepEqual(nativeResponses.map(response => response.status), [200, 200]);
    assert.equal(nativeFinished, true, "native concurrent traversal must not queue behind stalled artifact I/O");
    let releasePair!: () => void;
    let notifyPair!: () => void;
    let pairEntered = 0;
    const pairStarted = new Promise<void>(resolve => { notifyPair = resolve; });
    const pairRelease = new Promise<void>(resolve => { releasePair = resolve; });
    bucket.onRead = async key => {
      if (key !== runtime.documentsReference.key) return;
      if (++pairEntered === 2) notifyPair();
      await pairRelease;
    };
    const pair = [send(nativeEnv), send(nativeEnv)];
    await pairStarted;
    const queued = send(nativeEnv);
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(pairEntered, 2, "a third native traversal must wait for capacity");
    } finally { releasePair(); }
    assert.deepEqual((await Promise.all([...pair, queued])).map(response => response.status), [200, 200, 200]);
    bucket.onRead = previousRead;
  }
  const driftedCapabilityResponse = await handleCustomSearchRequest(new Request(
    "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
      method: "POST", headers: { "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "x-juro-service-binding": "custom-search-runtime-v1",
        "x-juro-legal-environment": environment }, body,
    }), { ...env, CUSTOM_SEARCH_CAPABILITY: "drifted" } as unknown as CustomSearchEnv);
  assert.equal(driftedCapabilityResponse.status, 503);
  const historyEnv: CustomSearchEnv = { ...env,
    CANDIDATE_MEMBERSHIP_PROOFS_ENABLED: "true",
    CUSTOM_SEARCH_CAPABILITY: "history",
    CUSTOM_SEARCH_INSTANCE_ID: "custom-history-staging-v1",
    CUSTOM_SEARCH_SHARD_ID: "history-base-v1" };
  const historicalAt = "2026-01-15T00:00:00.000Z";
  const historyBody = JSON.stringify({ releaseId: RELEASE_ID,
    instanceIds: [historyEnv.CUSTOM_SEARCH_INSTANCE_ID], query: "work",
    currentAt: "2026-09-05T00:00:00.000Z",
    endpoint: { kind: "timestamp", instant: historicalAt }, maxResults: 50, vectorThreshold: 0 });
  const historyResponse = await handleCustomSearchRequest(new Request(
    "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
      method: "POST", headers: { "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(historyBody).byteLength),
        "x-juro-service-binding": "custom-search-runtime-v1",
        "x-juro-legal-environment": environment }, body: historyBody,
    }), historyEnv);
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(observed.denseOptions?.filter, {
    valid_from_epoch: { $lte: 1_768_435_200 },
    valid_to_epoch: { $gt: 1_768_435_200 },
  });
  const proofEnv = {...env, CANDIDATE_MEMBERSHIP_PROOFS_ENABLED: "true"};
  const sendProofRequest = (selected = proofEnv) => handleCustomSearchRequest(new Request(
    "http://legal-corpus.internal/internal/legal-corpus/custom-search", {method: "POST", body,
      headers: {"content-type": "application/json", "x-juro-service-binding": "custom-search-runtime-v1",
        "x-juro-legal-environment": environment}}), selected);
  assert.equal((await sendProofRequest()).status, 503, "Enabled proof retrieval requires a published root");
  const legalIdentity = customRuntimeLegalIdentitySchema.parse({legalIdentitySha256: "b".repeat(64),
    legalInstrumentId: "instrument", officialExpressionId: "expression", textRevisionId: "revision",
    provisionConceptId: "concept", provisionRenditionId: "rendition", evidenceProvisionRenditionId: "evidence",
    languageTag: "en", script: "Latn", textualAuthority: "official_translation",
    validFrom: "2020-01-01T00:00:00.000Z", validTo: null,
    evidence: {r2Key: "evidence", byteCount: 100, sha256: "c".repeat(64), sourceNormalizedSha256: "d".repeat(64),
      mediaType: "application/json; charset=utf-8"}, citation: {label: "Official provision", url: "https://lex.uz/docs/777"}});
  const tree = await buildCandidateMembershipTree({releaseId: RELEASE_ID, sourceInventorySha256: "a".repeat(64),
    members: [{itemKey: ITEM_KEY, ordinal: 0, legalIdentity}]});
  const manifestBytes = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, releaseId: RELEASE_ID,
    inventoryReleaseId: physicalReleaseId, sourceInventorySha256: "a".repeat(64), memberCount: 1,
    partitions: [{partition: "04", root: tree.root}]}));
  publication = {key: "proof-manifest", sha256: createHash("sha256").update(manifestBytes).digest("hex"),
    sizeBytes: manifestBytes.length, sourceInventorySha256: "a".repeat(64), memberCount: 1};
  bucket.objects.set("proof-manifest", manifestBytes);
  const proofKey = `search-releases/${RELEASE_ID}/runtime/membership-proofs/${tree.root.merkleRoot}/${ITEM_KEY}.json`;
  bucket.objects.set(proofKey, new TextEncoder().encode(JSON.stringify(tree.proofFor(ITEM_KEY))));
  const proofResponse = await sendProofRequest();
  assert.equal(proofResponse.status, 200);
  const proofResult = await proofResponse.json() as {hits: Array<{membershipProof: unknown}>};
  assert.deepEqual(proofResult.hits[0]!.membershipProof, tree.proofFor(ITEM_KEY));
  assert.equal((await sendProofRequest({...proofEnv, DENSE: {async query() {throw new Error("dense unavailable");}} as unknown as VectorizeIndex})).status, 503);
  bucket.objects.delete(proofKey);
  assert.equal((await sendProofRequest()).status, 503, "Missing proofs cannot return an available partial result");
});
}

test("custom search rejects public requests without reserving provider spend", async () => {
  let prepared = false;
  const response = await handleCustomSearchRequest(new Request(
    "http://legal-corpus.internal/internal/legal-corpus/custom-search", { method: "POST" }), {
      APP_ENV: "staging",
      CATALOG_DB: { prepare() { prepared = true; throw new Error("unexpected"); } } as unknown as D1Database,
    } as CustomSearchEnv);
  assert.equal(response.status, 404);
  assert.equal(prepared, false);
});

test("native history search preserves the accepted physical release", async () => {
  const config = JSON.parse(await readFile(new URL("../config/corpus-releases.json", import.meta.url), "utf8")).history;
  assert.equal(config.variables.CUSTOM_SEARCH_RELEASE_ID, "release:production:history:custom-v1:2026-09-08");
  assert.equal(config.variables.CUSTOM_SEARCH_PHYSICAL_RELEASE_ID, "release:staging:history:custom-v1:2026-09-06");
  assert.equal(config.artifactNamespace, "juro-legal-current-custom-20260903");
  assert.equal(config.vectorCollection, "juro-legal-history-custom-20260906");
});
