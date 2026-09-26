import { z } from "zod";
import {indexedRetrievalSignal} from "../runtime/indexed-retrieval";
import type {CustomRuntimeCache} from "./custom-runtime-cache";
import type {PreparedOrdinalReader} from "./prepared-membership";
import {candidateMembershipProofSchema} from "./candidate-membership-proof";
import {loadCandidateMembershipProjection, readCandidateMembershipProofs} from "./candidate-membership-projection";

import { queryCustomBm25RuntimeBatch, parseCustomBm25RuntimeDescriptor,
  resolveCustomBm25RuntimeItemKeys }
  from "./custom-bm25-runtime";
import { queryCustomDenseLane, buildCustomVectorizeFilter, type CustomVectorSearchIndex }
  from "./custom-candidate-index";
import { fuseCustomRankedLanes } from "./custom-bm25";
import { customCurrentSha256 } from "./custom-current-build";
import { CUSTOM_EMBEDDING_DIMENSIONS, CUSTOM_EMBEDDING_MODEL, normalizeCustomEmbedding }
  from "./custom-hybrid-index";
import { acceptsPrivateServiceRequest, declaredRequestBodyWithinLimit, privateServiceJson }
  from "./private-service-boundary";
import { legalEnvironmentSchema, searchReleaseIdSchema, sha256Schema, utcInstantSchema }
  from "./target-domain-schemas";

export const CUSTOM_SEARCH_PATH = "/internal/legal-corpus/custom-search";
export const CUSTOM_SEARCH_SERVICE_MARKER = "custom-search-runtime-v1";

export function fuseCustomProvisionMatches(sparseKeys: string[], denseKeys: string[], explicitArticleKeys: ReadonlySet<string>, topK: number) {
  // Article numbers are not document identities. They may break a rank tie,
  // but must not override agreement between the independent candidate lanes.
  return fuseCustomRankedLanes([sparseKeys, denseKeys], {k: 60, topK: Math.max(topK, sparseKeys.length + denseKeys.length)})
    .sort((left, right) => right.score - left.score
      || Number(explicitArticleKeys.has(right.itemKey)) - Number(explicitArticleKeys.has(left.itemKey))
      || left.itemKey.localeCompare(right.itemKey))
    .slice(0, topK);
}
const QUERY_RESERVATION_USD_MICROS = 1_065;
let customSparseTail: Promise<void> = Promise.resolve();
const corpusSparseTails = new WeakMap<CustomRuntimeCache, Promise<void>>();

// Each persistent corpus cache owns one traversal queue. Independent corpora
// can overlap I/O while each keeps its memory-intensive traversal serialized.
// Runtimes without a corpus cache retain the shared traversal bound.
function serializeCustomSparseSearch<T>(operation: () => Promise<T>, cache?: CustomRuntimeCache): Promise<T> {
  const tail = cache ? corpusSparseTails.get(cache) ?? Promise.resolve() : customSparseTail;
  const result = tail.then(()=>{indexedRetrievalSignal();return operation();});
  const settled = result.then(() => undefined, () => undefined);
  if (cache) corpusSparseTails.set(cache, settled);
  else customSparseTail = settled;
  return result;
}

const endpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current") }).strict(),
  z.object({ kind: z.literal("timestamp"), instant: utcInstantSchema }).strict(),
]);
const requestBaseSchema = z.object({
  releaseId: searchReleaseIdSchema,
  instanceIds: z.array(z.string().min(1).max(64)).length(1),
  endpoint: endpointSchema,
  currentAt: utcInstantSchema,
  maxResults: z.literal(50),
  vectorThreshold: z.literal(0),
}).strict();
const singleRequestSchema = requestBaseSchema.extend({
  query: z.string().trim().min(1).max(900),
}).strict();
const batchRequestSchema = requestBaseSchema.extend({
  queries: z.array(z.string().trim().min(1).max(900)).min(1).max(6),
}).strict();
const requestSchema = z.union([singleRequestSchema, batchRequestSchema]);
const hitSchema = z.object({
  itemKey: z.string().min(1).max(700),
  membershipProof: candidateMembershipProofSchema.optional(),
  instanceId: z.string().min(1).max(64),
  shardId: z.string().min(1).max(64),
  vectorRank: z.number().int().positive(),
  vectorScore: z.number().finite(),
  keywordRank: z.number().int().positive(),
  keywordScore: z.number().finite(),
  fusionScore: z.number().finite(),
}).strict();
export const customSearchResponseSchema = z.object({
  hits: z.array(hitSchema).max(50),
  errors: z.array(z.object({ code: z.string(), instanceId: z.string().optional() }).strict()),
  searchedInstanceIds: z.array(z.string()).length(1),
  tokenUsage: z.number().int().nonnegative(),
}).strict();
export const customSearchBatchResponseSchema = z.object({
  results: z.array(z.object({
    queryIndex: z.number().int().nonnegative().max(5),
    hits: z.array(hitSchema).max(50),
  }).strict()).min(1).max(6),
  errors: z.array(z.object({ code: z.string(), instanceId: z.string().optional() }).strict()),
  searchedInstanceIds: z.array(z.string()).length(1),
  tokenUsage: z.number().int().nonnegative(),
}).strict();

export type CustomSearchEnv = {
  APP_ENV: string;
  CANDIDATE_MEMBERSHIP_PROOFS_ENABLED?: string;
  OPENAI_API_KEY: string;
  EMBEDDING_FETCH?: typeof fetch;
  DENSE: CustomVectorSearchIndex;
  ARTIFACTS: R2Bucket;
  RUNTIME_CACHE?: CustomRuntimeCache;
  PREPARED_ORDINALS?: PreparedOrdinalReader;
  CATALOG_DB: D1Database;
  CUSTOM_SEARCH_CAPABILITY: "current" | "history";
  CUSTOM_SEARCH_RELEASE_ID: string;
  CUSTOM_SEARCH_PHYSICAL_RELEASE_ID?: string;
  CUSTOM_SEARCH_INSTANCE_ID: string;
  CUSTOM_SEARCH_SHARD_ID: string;
  CUSTOM_RUNTIME_DESCRIPTOR_KEY: string;
  CUSTOM_RUNTIME_DESCRIPTOR_SHA256: string;
};

async function reserveQueryBudget(
  env: CustomSearchEnv,
  releaseId: string,
  queryCount: number,
): Promise<string> {
  const environment = legalEnvironmentSchema.parse(env.APP_ENV);
  const period = environment === "staging" ? "evaluation"
    : new Date().toISOString().slice(0, 7);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const reservation = QUERY_RESERVATION_USD_MICROS * queryCount;
  const reserved = await env.CATALOG_DB.prepare(`UPDATE legal_custom_query_budget_periods
    SET reserved_usd_micros=reserved_usd_micros+?,reserved_requests=reserved_requests+?
    WHERE environment=? AND period=?
      AND reserved_usd_micros+?<=authorized_usd_micros
    RETURNING reserved_usd_micros AS reservedUsdMicros`).bind(
    reservation, queryCount, environment, period, reservation,
  ).first<{ reservedUsdMicros: number }>();
  if (!reserved) throw new TypeError("CUSTOM_QUERY_BUDGET_EXHAUSTED");
  await env.CATALOG_DB.prepare(`INSERT INTO legal_custom_query_reservations
    (id,environment,period,release_id,reserved_usd_micros,created_at)
    VALUES (?,?,?,?,?,?)`).bind(
    id, environment, period, releaseId, reservation, now,
  ).run();
  return id;
}

const embeddingResponseSchema = z.object({
  model: z.literal(CUSTOM_EMBEDDING_MODEL),
  data: z.array(z.object({ index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).length(CUSTOM_EMBEDDING_DIMENSIONS) }).passthrough()).min(1).max(6),
  usage: z.object({ prompt_tokens: z.number().int().positive(),
    total_tokens: z.number().int().positive() }).passthrough(),
}).passthrough();

async function queryEmbeddings(env: CustomSearchEnv, queries: string[]): Promise<{
  vectors: number[][]; tokenUsage: number;
}> {
  if (!env.OPENAI_API_KEY) throw new TypeError("CUSTOM_QUERY_EMBEDDING_UNAVAILABLE");
  // Formulations can cover different requirements with identical text. Reuse
  // their vector only within this request, preserving every output position.
  const uniqueQueries=[...new Set(queries)];
  const response = await (env.EMBEDDING_FETCH ?? fetch)("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: CUSTOM_EMBEDDING_MODEL, dimensions: CUSTOM_EMBEDDING_DIMENSIONS,
      encoding_format: "float", input: uniqueQueries }),
    signal: indexedRetrievalSignal() ?? AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new TypeError("CUSTOM_QUERY_EMBEDDING_UNAVAILABLE");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 768 * 1024) throw new TypeError("CUSTOM_QUERY_EMBEDDING_RESPONSE_TOO_LARGE");
  const result = embeddingResponseSchema.parse(await response.json());
  const byIndex = new Map(result.data.map((entry) => [entry.index, entry.embedding]));
  if (byIndex.size !== uniqueQueries.length
    || uniqueQueries.some((_, index) => !byIndex.has(index))) {
    throw new TypeError("CUSTOM_QUERY_EMBEDDING_RESPONSE_INCOMPLETE");
  }
  const vectors=new Map(uniqueQueries.map((query,index)=>[query,normalizeCustomEmbedding(byIndex.get(index)!)]));
  return { vectors: queries.map(query => [...vectors.get(query)!]),
    tokenUsage: result.usage.prompt_tokens };
}

async function loadDescriptor(env: CustomSearchEnv, releaseId: string) {
  const physicalReleaseId = env.CUSTOM_SEARCH_PHYSICAL_RELEASE_ID
    ? searchReleaseIdSchema.parse(env.CUSTOM_SEARCH_PHYSICAL_RELEASE_ID)
    : releaseId;
  const expectedKey = z.string().min(1).max(1_024).parse(env.CUSTOM_RUNTIME_DESCRIPTOR_KEY);
  const expectedSha256 = sha256Schema.parse(env.CUSTOM_RUNTIME_DESCRIPTOR_SHA256);
  const component = await env.CATALOG_DB.prepare(`SELECT runtime_descriptor_r2_key AS descriptorKey,
      runtime_descriptor_sha256 AS descriptorSha256,sparse_manifest_sha256 AS sparseManifestSha256,
      mapping_inventory_sha256 AS mappingInventorySha256,mapping_count AS mappingCount
    FROM legal_custom_search_r2_runtime_roots WHERE search_release_id=?
    UNION ALL
    SELECT runtime_descriptor_r2_key,runtime_descriptor_sha256,sparse_manifest_sha256,mapping_inventory_sha256,mapping_count
    FROM legal_custom_search_runtime_components WHERE search_release_id=?
      AND NOT EXISTS (SELECT 1 FROM legal_custom_search_r2_runtime_roots WHERE search_release_id=?)
    LIMIT 1`).bind(releaseId, releaseId, releaseId)
    .first<{ descriptorKey: string; descriptorSha256: string; sparseManifestSha256: string;
      mappingInventorySha256:string;mappingCount:number }>();
  if (!component || component.descriptorKey !== expectedKey
    || component.descriptorSha256 !== expectedSha256) {
    throw new TypeError("CUSTOM_SEARCH_RUNTIME_COMPONENT_MISMATCH");
  }
  const object = await env.ARTIFACTS.get(expectedKey);
  if (!object || object.size > 128 * 1024) throw new TypeError("CUSTOM_SEARCH_DESCRIPTOR_MISSING");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (await customCurrentSha256(bytes) !== expectedSha256) {
    throw new TypeError("CUSTOM_SEARCH_DESCRIPTOR_CORRUPT");
  }
  const descriptor = parseCustomBm25RuntimeDescriptor(JSON.parse(new TextDecoder().decode(bytes)));
  if (descriptor.releaseId !== physicalReleaseId
    || descriptor.sparseManifestSha256 !== component.sparseManifestSha256) {
    throw new TypeError("CUSTOM_SEARCH_DESCRIPTOR_IDENTITY_MISMATCH");
  }
  return {descriptor,component};
}

async function itemKeysForOrdinals(env: CustomSearchEnv, releaseId: string, ordinals: number[]) {
  const result = new Map<number, string>();
  for (let offset = 0; offset < ordinals.length; offset += 80) {
    const group = ordinals.slice(offset, offset + 80);
    const placeholders = group.map(() => "?").join(",");
    const rows = await env.CATALOG_DB.prepare(`SELECT item_ordinal AS ordinal,item_key AS itemKey
      FROM legal_custom_search_runtime_items
      WHERE search_release_id=? AND item_ordinal IN (${placeholders})`).bind(
      releaseId, ...group,
    ).all<{ ordinal: number; itemKey: string }>();
    for (const row of rows.results) result.set(Number(row.ordinal), row.itemKey);
  }
  if (result.size !== ordinals.length) throw new TypeError("CUSTOM_SEARCH_ORDINAL_MAPPING_MISSING");
  return ordinals.map((ordinal) => result.get(ordinal)!);
}

export async function executeCustomSearch(env: CustomSearchEnv, raw: unknown) {
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const timed = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try { return await operation(); }
    finally { timings[stage] = Date.now() - started; }
  };
  const input = requestSchema.parse(raw);
  if (env.APP_ENV !== "staging" && env.APP_ENV !== "production") {
    throw new TypeError("CUSTOM_SEARCH_ENVIRONMENT_REJECTED");
  }
  const capability = z.enum(["current", "history"]).safeParse(env.CUSTOM_SEARCH_CAPABILITY);
  if (!capability.success) throw new TypeError("CUSTOM_SEARCH_CAPABILITY_REJECTED");
  if (input.releaseId !== env.CUSTOM_SEARCH_RELEASE_ID
    || input.instanceIds[0] !== env.CUSTOM_SEARCH_INSTANCE_ID
    || (capability.data === "current" && input.endpoint.kind !== "current")
    || (capability.data === "history" && input.endpoint.kind !== "timestamp")) {
    throw new TypeError("CUSTOM_SEARCH_RELEASE_REJECTED");
  }
  const {descriptor,component} = await timed("descriptorMs", () => loadDescriptor(env, input.releaseId));
  const denseMetadataReleaseId = descriptor.denseMetadataReleaseId ?? descriptor.releaseId;
  const queries = "query" in input ? [input.query] : input.queries;
  await reserveQueryBudget(env, input.releaseId, queries.length);
  const atEpoch = Math.floor(new Date(input.endpoint.kind === "timestamp"
    ? input.endpoint.instant : input.currentAt).getTime() / 1_000);
  const lanes = await Promise.allSettled([
    timed("sparseMs", () => serializeCustomSparseSearch(() => queryCustomBm25RuntimeBatch(env.ARTIFACTS, descriptor,
      queries.map(text => ({ text, atEpoch, topK: input.maxResults })),env.RUNTIME_CACHE),env.RUNTIME_CACHE)),
    timed("embeddingMs", () => queryEmbeddings(env, queries)).then(async embedding => ({
      tokenUsage: embedding.tokenUsage,
      results: await timed("denseMs", () => Promise.all(embedding.vectors.map(vector => queryCustomDenseLane(env.DENSE, {
        releaseId: denseMetadataReleaseId,
        vector,
        filter: buildCustomVectorizeFilter({ releaseId: denseMetadataReleaseId, atEpoch }),
        topK: input.maxResults,
      })))),
    })),
  ]);
  const [sparseLane, denseLane] = lanes;
  console.info(JSON.stringify({ event: "legal.custom_search_lanes", ...timings,
    elapsedMs: Date.now() - startedAt, formulationCount: queries.length,
    sparseAvailable: sparseLane.status === "fulfilled", denseAvailable: denseLane.status === "fulfilled" }));
  if (sparseLane.status === "rejected") throw sparseLane.reason;
  if (denseLane.status === "rejected") throw denseLane.reason;
  const ordinals = [...new Set(sparseLane.value.flatMap(hits => hits.map(hit => hit.ordinal)))];
  const preparedKeys = await env.PREPARED_ORDINALS?.({releaseId:input.releaseId,
    sourceInventorySha256:component.mappingInventorySha256,memberCount:component.mappingCount,ordinals});
  const runtimeKeys = preparedKeys ?? await resolveCustomBm25RuntimeItemKeys(env.ARTIFACTS, descriptor, ordinals,env.RUNTIME_CACHE);
  const keys = runtimeKeys
    ? runtimeKeys.map(key => `search-releases/${input.releaseId}/${key}`)
    : await itemKeysForOrdinals(env, input.releaseId, ordinals);
  const sparseIdentity = new Map(ordinals.map((ordinal, index) => [ordinal, keys[index]!]));
  let results: z.infer<typeof customSearchBatchResponseSchema>["results"] = queries.map((_, queryIndex) => {
    const sparse = sparseLane.value[queryIndex]!;
    const dense = denseLane.value.results[queryIndex]!;
    const sparseOrdinals = sparse.map((entry) => entry.ordinal);
    const sparseKeys = sparseOrdinals.map(ordinal => sparseIdentity.get(ordinal)!);
    const denseKeys = dense.map((entry) =>
      `search-releases/${input.releaseId}/${entry.itemKey}`);
    const explicitArticleKeys = new Set(sparseKeys.filter((_, index) => sparse[index]!.explicitArticleMatch));
    const fused = fuseCustomProvisionMatches(sparseKeys, denseKeys, explicitArticleKeys, input.maxResults);
    const sparseByKey = new Map(sparseKeys.map((key, index) => [key, {
      rank: index + 1, score: sparse[index]!.score,
    }]));
    const denseByKey = new Map(denseKeys.map((key, index) => [key, {
      rank: index + 1, score: dense[index]!.score,
    }]));
    return {
      queryIndex,
      hits: fused.map((entry) => ({
        itemKey: entry.itemKey,
        instanceId: env.CUSTOM_SEARCH_INSTANCE_ID,
        shardId: env.CUSTOM_SEARCH_SHARD_ID,
        vectorRank: denseByKey.get(entry.itemKey)?.rank ?? dense.length + 1,
        vectorScore: denseByKey.get(entry.itemKey)?.score ?? 0,
        keywordRank: sparseByKey.get(entry.itemKey)?.rank ?? sparse.length + 1,
        keywordScore: sparseByKey.get(entry.itemKey)?.score ?? 0,
        fusionScore: entry.score,
      })),
    };
  });
  // Historical releases keep their independently authenticated legacy layout.
  if (env.CANDIDATE_MEMBERSHIP_PROOFS_ENABLED === "true" && capability.data === "current") {
    results = await timed("membershipProofMs", async () => {
      const projection = await loadCandidateMembershipProjection({db: env.CATALOG_DB,
        bucket: env.ARTIFACTS, releaseId: input.releaseId});
      if (!projection) throw new TypeError("CUSTOM_SEARCH_MEMBERSHIP_PROOF_UNAVAILABLE");
      const prefix = `search-releases/${input.releaseId}/`;
      const proofs = await readCandidateMembershipProofs({bucket: env.ARTIFACTS, projection,
        itemKeys: results.flatMap(result => result.hits.map(hit => hit.itemKey.slice(prefix.length)))});
      return results.map(result => ({...result, hits: result.hits.map(hit => ({...hit,
        membershipProof: proofs.get(hit.itemKey.slice(prefix.length))!}))}));
    });
    console.info(JSON.stringify({event: "legal.custom_search_membership_proofs", elapsedMs: timings.membershipProofMs,
      candidateCount: new Set(results.flatMap(result => result.hits.map(hit => hit.itemKey))).size,
      packetBytes: new TextEncoder().encode(JSON.stringify(results)).byteLength}));
  }
  const batch = customSearchBatchResponseSchema.parse({
    results,
    errors: [],
    searchedInstanceIds: input.instanceIds,
    tokenUsage: denseLane.value.tokenUsage,
  });
  if (!("query" in input)) return batch;
  return customSearchResponseSchema.parse({
    hits: batch.results[0]!.hits,
    errors: batch.errors,
    searchedInstanceIds: batch.searchedInstanceIds,
    tokenUsage: batch.tokenUsage,
  });
}

export async function handleCustomSearchRequest(request: Request, env: CustomSearchEnv): Promise<Response> {
  const environment = legalEnvironmentSchema.safeParse(env.APP_ENV);
  if (!environment.success || !acceptsPrivateServiceRequest(request, {
    environment: environment.data,
    marker: CUSTOM_SEARCH_SERVICE_MARKER,
    method: "POST",
    path: CUSTOM_SEARCH_PATH,
    requireJson: true,
  })) return privateServiceJson({ code: "CUSTOM_SEARCH_PRIVATE_ROUTE_REJECTED" }, 404);
  try {
    if (!declaredRequestBodyWithinLimit(request, 8_192)) {
      throw new TypeError("CUSTOM_SEARCH_REQUEST_TOO_LARGE");
    }
    const body = await request.json();
    return privateServiceJson(await executeCustomSearch(env, body));
  } catch {
    return privateServiceJson({ code: "CUSTOM_SEARCH_UNAVAILABLE" }, 503);
  }
}
