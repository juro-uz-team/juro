import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildCustomBm25Artifacts, customBm25TermHash } from "../lib/legal-corpus/custom-bm25";
import { buildCustomBm25RuntimeArtifacts } from "../lib/legal-corpus/custom-bm25-runtime";
import { handleCustomSearchRequest, fuseCustomProvisionMatches, type CustomSearchEnv }
  from "../lib/legal-corpus/custom-search-service";
import {buildCandidateMembershipTree} from "../lib/legal-corpus/candidate-membership-proof";
import {customRuntimeLegalIdentitySchema} from "../lib/legal-corpus/custom-bm25-runtime";

const RELEASE_ID = "release:staging:current:custom-v1";
const DENSE_METADATA_RELEASE_ID = "release:staging:current:custom-v0";
const INSTANCE_ID = "custom-current-staging-v1";
const ITEM_KEY = `retrieval-chunk-v1:${"1".repeat(64)}`;

test("fusion retains an explicitly requested provision ahead of shared cross-reference matches", () => {
  const hits = fuseCustomProvisionMatches(["operative", "cross-reference"], ["cross-reference"], new Set(["operative"]), 1);
  assert.equal(hits[0]?.itemKey, "operative");
  assert.ok(hits[0]!.score > 1);
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

for (const { oversizedPosting, physicalAlias } of [
  { oversizedPosting: false, physicalAlias: false },
  { oversizedPosting: true, physicalAlias: false },
  { oversizedPosting: false, physicalAlias: true },
]) {
test(physicalAlias
  ? "private custom search can reuse an immutable physical release behind a logical production release"
  : oversizedPosting
    ? "private custom search treats an oversized matched posting as a sparse stop word"
    : "private custom search reserves budget and fuses verified sparse and dense lanes", async () => {
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
  const fullKey = `search-releases/${RELEASE_ID}/${ITEM_KEY}`;
  let publication: Record<string, unknown> | null = null;
  const database = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("FROM legal_candidate_membership_projections")) return publication;
              calls.push(sql.trim().startsWith("UPDATE") ? "reserve" : "component");
              if (sql.includes("runtime_descriptor_r2_key")) return {
                descriptorKey: runtime.descriptorReference.key,
                descriptorSha256: runtime.descriptorReference.sha256,
                sparseManifestSha256: "a".repeat(64),
              };
              return { reservedUsdMicros: 1_065 };
            },
            async run() { calls.push("ledger"); return { success: true }; },
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
  const dense = {
    async query(_vector: number[], options: VectorizeQueryOptions) {
      observed.denseOptions = options;
      return { count: 1, matches: [{ id: "b".repeat(64), score: 0.9,
        metadata: { item_key: ITEM_KEY, release_id: DENSE_METADATA_RELEASE_ID, language: "en",
          document_type: "law", valid_from_epoch: 1, valid_to_epoch: 253_402_300_799 } }] };
    },
  } as unknown as VectorizeIndex;
  const env = {
    APP_ENV: "staging",
    CUSTOM_SEARCH_CAPABILITY: "current",
    AI_GATEWAY_ID: "juro-ai-search-staging",
    CUSTOM_SEARCH_RELEASE_ID: RELEASE_ID,
    ...(physicalAlias ? { CUSTOM_SEARCH_PHYSICAL_RELEASE_ID: physicalReleaseId } : {}),
    CUSTOM_SEARCH_INSTANCE_ID: INSTANCE_ID,
    CUSTOM_SEARCH_SHARD_ID: "current-base-v1",
    CUSTOM_RUNTIME_DESCRIPTOR_KEY: runtime.descriptorReference.key,
    CUSTOM_RUNTIME_DESCRIPTOR_SHA256: runtime.descriptorReference.sha256,
    ARTIFACTS: bucket as unknown as R2Bucket,
    CATALOG_DB: database,
    AI: { gateway() { return { async run(request: { query: { input: string[] } }) {
      const inputs = request.query.input;
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
      assert.deepEqual(calls.slice(0, 3), ["component", "reserve", "ledger"]);
      return Response.json({ model: "text-embedding-3-large", object: "list",
        data: inputs.map((_, inputIndex) => ({ object: "embedding", index: inputIndex,
          embedding: Array.from({ length: 1_536 }, (_, index) => index === inputIndex ? 1 : 0) })),
        usage: { prompt_tokens: inputs.length, total_tokens: inputs.length } });
    } }; } } as unknown as Ai,
    DENSE: dense,
  } satisfies CustomSearchEnv;
  const body = JSON.stringify({ releaseId: RELEASE_ID, instanceIds: [INSTANCE_ID], query: "work",
    currentAt: "2026-09-05T00:00:00.000Z",
    endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0 });
  const response = await handleCustomSearchRequest(new Request(
    "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
      method: "POST", headers: { "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "x-juro-service-binding": "custom-search-runtime-v1",
        "x-juro-legal-environment": "staging" }, body,
    }), env);
  assert.equal(response.status, 200);
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
          "x-juro-legal-environment": "staging" }, body: batchBody,
      }), env);
    assert.equal(batchResponse.status, 200);
    const batchResult = await batchResponse.json() as {
      results: Array<{ queryIndex: number; hits: Array<{ itemKey: string }> }>;
      tokenUsage: number;
    };
    assert.deepEqual(batchResult.results.map((entry) => entry.queryIndex), [0, 1]);
    assert.deepEqual(batchResult.results.map((entry) => entry.hits[0]?.itemKey), [fullKey, fullKey]);
    assert.equal(batchResult.tokenUsage, 2);
    assert.equal(embeddingBatchSizes.at(-1), 2);
    assert.equal(bucket.reads.get(runtime.documentsReference.key), 1,
      "the service must share sparse evidence-table reads across formulations");
    activeEmbeddingRequests = 0;
    maximumEmbeddingConcurrency = 0;
    const send = () => handleCustomSearchRequest(new Request(
      "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
        method: "POST", headers: { "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(body).byteLength),
          "x-juro-service-binding": "custom-search-runtime-v1",
          "x-juro-legal-environment": "staging" }, body,
      }), env);
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
  }
  const driftedCapabilityResponse = await handleCustomSearchRequest(new Request(
    "http://legal-corpus.internal/internal/legal-corpus/custom-search", {
      method: "POST", headers: { "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "x-juro-service-binding": "custom-search-runtime-v1",
        "x-juro-legal-environment": "staging" }, body,
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
        "x-juro-legal-environment": "staging" }, body: historyBody,
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
        "x-juro-legal-environment": "staging"}}), selected);
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

test("production history search reuses the accepted physical release without build bindings", async () => {
  const config = JSON.parse(await readFile(
    new URL("../wrangler.legal-custom-history-production.jsonc", import.meta.url), "utf8",
  ));
  assert.equal(config.name, "juro-legal-history-custom-production-20260908");
  assert.equal(config.main, "./worker/legal-custom-search-worker.ts");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.queues, undefined);
  assert.equal(config.workflows, undefined);
  assert.equal(config.vars.APP_ENV, "production");
  assert.equal(config.vars.AI_GATEWAY_ID, "juro-ai-search-production");
  assert.equal(config.vars.CUSTOM_SEARCH_RELEASE_ID,
    "release:production:history:custom-v1:2026-09-08");
  assert.equal(config.vars.CUSTOM_SEARCH_PHYSICAL_RELEASE_ID,
    "release:staging:history:custom-v1:2026-09-06");
  assert.equal(config.r2_buckets[0].bucket_name, "juro-legal-current-custom-20260903");
  assert.equal(config.vectorize[0].index_name, "juro-legal-history-custom-20260906");
  assert.equal(config.d1_databases[0].database_name,
    "juro-legal-catalog-production-green-20260908");
});
