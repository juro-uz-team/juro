import { z } from "zod";
import { customCurrentSha256, serializeCustomCurrentArtifact } from "./custom-current-build";
import { CUSTOM_EMBEDDING_MODEL, CUSTOM_EMBEDDING_DIMENSIONS,
  CUSTOM_EMBEDDING_INPUT_VERSION, CUSTOM_EMBEDDING_TRANSFORM_VERSION,
  createCustomEmbeddingArtifact, deserializeNormalizedEmbedding,
  mapCustomArtifactOperations, putImmutableCustomArtifact, serializeCustomEmbeddingInput, type CustomRetrievalChunk,
} from "./custom-hybrid-index";
import { CustomIndexPipelineError } from "./custom-index-pipeline";

export interface EmbeddingValues {
  get<T>(key: string): Promise<T | undefined>;
  put(values: Record<string, unknown>): Promise<void>;
}
export interface EmbeddingStore extends EmbeddingValues {
  transaction<T>(callback: (store: EmbeddingValues) => Promise<T>): Promise<T>;
}

export type DocumentEmbeddingConfiguration = {
  environment: "staging" | "production";
  releaseId: string;
  manifestSha256: string;
  authorizedTokens: number;
  requestsPerMinute: number;
  tokensPerMinute: number;
  enabled: boolean;
};
export type DocumentEmbeddingInput = {
  chunk: CustomRetrievalChunk;
  inputSha256: string;
  inputTokens: number;
};
export type DocumentEmbeddingRequest = {
  model: typeof CUSTOM_EMBEDDING_MODEL;
  dimensions: typeof CUSTOM_EMBEDDING_DIMENSIONS;
  encoding_format: "float";
  input: string[];
};

/** One direct request keeps the durable reservation equal to one provider dispatch. */
export async function requestDocumentEmbeddings(apiKey: string, request: DocumentEmbeddingRequest,
  transport: typeof fetch = fetch): Promise<Response> {
  if (!apiKey) throw new TypeError("CUSTOM_EMBEDDING_PROVIDER_UNAVAILABLE");
  try {
    return await transport("https://api.openai.com/v1/embeddings", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request), signal: AbortSignal.timeout(60_000),
    });
  } catch { return fail("OUTCOME_UNRESOLVED"); }
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const pointerSchema = z.object({
  schemaVersion: z.literal(1), provider: z.literal("openai"),
  model: z.literal(CUSTOM_EMBEDDING_MODEL), dimensions: z.literal(CUSTOM_EMBEDDING_DIMENSIONS),
  inputVersion: z.literal(CUSTOM_EMBEDDING_INPUT_VERSION),
  transformVersion: z.literal(CUSTOM_EMBEDDING_TRANSFORM_VERSION),
  inputSha256: digestSchema, artifactKey: z.string(), vectorSha256: digestSchema,
  sizeBytes: z.literal(CUSTOM_EMBEDDING_DIMENSIONS * 4),
}).strict();
export type DocumentEmbeddingPointer = z.infer<typeof pointerSchema>;
const prefix = `embeddings/${CUSTOM_EMBEDDING_MODEL}/${CUSTOM_EMBEDDING_DIMENSIONS}/${CUSTOM_EMBEDDING_TRANSFORM_VERSION}`;
export const documentEmbeddingPointerKey = (inputSha256: string) => `${prefix}/verified/${inputSha256}.json`;
function fail(code: string): never { throw new CustomIndexPipelineError(`CUSTOM_EMBEDDING_${code}`); }

export async function readDocumentEmbedding(bucket: R2Bucket, inputSha256: string): Promise<DocumentEmbeddingPointer | null> {
  const object = await bucket.get(documentEmbeddingPointerKey(inputSha256));
  if (!object) return null;
  if (object.size > 4096) fail("POINTER_INVALID");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (await customCurrentSha256(bytes) !== object.customMetadata?.sha256) fail("POINTER_CORRUPT");
  const result = pointerSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  if (!result.success) fail("POINTER_INVALID");
  const pointer = result.data;
  if (pointer.inputSha256 !== inputSha256
    || pointer.artifactKey !== `${prefix}/${inputSha256}/${pointer.vectorSha256}.f32`) fail("POINTER_INVALID");
  const artifact = await bucket.get(pointer.artifactKey);
  if (!artifact || artifact.size !== pointer.sizeBytes) fail("ARTIFACT_MISSING");
  const vectorBytes = new Uint8Array(await artifact.arrayBuffer());
  if (await customCurrentSha256(vectorBytes) !== pointer.vectorSha256) fail("ARTIFACT_CORRUPT");
  const values = deserializeNormalizedEmbedding(vectorBytes);
  const norm = values.reduce((sum, value) => sum + value * value, 0);
  if (!values.every(Number.isFinite) || Math.abs(norm - 1) > 0.0001) fail("ARTIFACT_INVALID");
  return pointer;
}

type RequestRecord = {
  id: string; ownerId: string; inputs: Array<{ inputSha256: string; inputTokens: number }>;
  tokens: number; state: "pending" | "complete" | "rejected";
  artifacts?: DocumentEmbeddingPointer[];
  reconciliationSha256?: string;
};

type ReconciliationRecord = {
  decisionSha256: string; originalUnknownReservedTokens: number;
  supplementalAuthorizedTokens: number; state: "pending" | "complete";
};

function reconciliationStore(storage: EmbeddingStore, decisionSha256: string): EmbeddingStore {
  const prefix = `embedding:recovery:${decisionSha256}:`;
  const values = (store: EmbeddingValues): EmbeddingValues => ({
    get: <T>(key: string) => store.get<T>(prefix + key),
    put: entries => store.put(Object.fromEntries(Object.entries(entries).map(([key, value]) => [prefix + key, value]))),
  });
  return { ...values(storage), transaction: callback => storage.transaction(store => callback(values(store))) };
}

/** One transactional ledger per release: content hashes fence concurrent Queue deliveries. */
export class DocumentEmbeddingLedger {
  constructor(private readonly storage: EmbeddingStore) {}

  async begin(configuration: DocumentEmbeddingConfiguration, inputs: DocumentEmbeddingInput[], ownerId: string, now: number) {
    const id = crypto.randomUUID();
    return this.storage.transaction(async store => {
      const priorConfiguration = await store.get<DocumentEmbeddingConfiguration>("embedding:configuration");
      if (priorConfiguration && await customCurrentSha256(serializeCustomCurrentArtifact(priorConfiguration))
        !== await customCurrentSha256(serializeCustomCurrentArtifact(configuration))) fail("CONFIGURATION_CONFLICT");
      if (await store.get<boolean>("embedding:creditStopped")) fail("CREDIT_STOP");
      if ((await store.get<number>("embedding:retryAfter") ?? 0) > now) fail("RATE_LIMIT");
      for (const input of inputs) {
        const priorId = await store.get<string>(`embedding:input:${input.inputSha256}`);
        if (priorId && (await store.get<RequestRecord>(`embedding:request:${priorId}`))?.state !== "rejected") fail("OUTCOME_UNRESOLVED");
        if ((await store.get<number>(`embedding:attempts:${input.inputSha256}`) ?? 0) >= 5) fail("RETRY_LIMIT");
      }
      const tokens = inputs.reduce((sum, input) => sum + input.inputTokens, 0);
      const reserved = await store.get<number>("embedding:reservedTokens") ?? 0;
      if (reserved + tokens > configuration.authorizedTokens) fail("COST_STOP");
      const window = (await store.get<Array<{ at: number; tokens: number }>>("embedding:rate") ?? [])
        .filter(item => item.at > now - 60000);
      if (window.length >= configuration.requestsPerMinute
        || window.reduce((sum, item) => sum + item.tokens, 0) + tokens > configuration.tokensPerMinute) fail("RATE_LIMIT");
      const request: RequestRecord = { id, ownerId, tokens, state: "pending",
        inputs: inputs.map(({ inputSha256, inputTokens }) => ({ inputSha256, inputTokens })) };
      const attempts: Record<string, number> = {};
      for (const item of inputs) {
        const key = `embedding:attempts:${item.inputSha256}`;
        attempts[key] = (await store.get<number>(key) ?? 0) + 1;
      }
      const writes = Object.entries({ "embedding:configuration": configuration, "embedding:reservedTokens": reserved + tokens,
        "embedding:rate": [...window, { at: now, tokens }], [`embedding:request:${id}`]: request,
        ...Object.fromEntries(inputs.map(input => [`embedding:input:${input.inputSha256}`, id])),
        ...attempts,
      });
      // A 64-input reservation exceeds one storage put's key limit; all calls remain in this transaction.
      for (let offset = 0; offset < writes.length; offset += 100) {
        await store.put(Object.fromEntries(writes.slice(offset, offset + 100)));
      }
      return request;
    });
  }

  async persistValidated(request: RequestRecord, artifacts: DocumentEmbeddingPointer[]): Promise<void> {
    await this.storage.put({ [`embedding:request:${request.id}`]: { ...request, artifacts } });
  }

  async recover(inputs: DocumentEmbeddingInput[], bucket: R2Bucket): Promise<void> {
    const recovered = new Set<string>();
    for (const item of inputs) {
      const id = await this.storage.get<string>(`embedding:input:${item.inputSha256}`);
      if (!id || recovered.has(id)) continue;
      recovered.add(id);
      const request = await this.storage.get<RequestRecord>(`embedding:request:${id}`);
      if (!request) fail("REQUEST_CONFLICT");
      if (request.state !== "pending") continue;
      if (!request.artifacts) fail("OUTCOME_UNRESOLVED");
      await mapCustomArtifactOperations(request.artifacts, pointer => persistPointer(bucket, pointer));
      await this.complete(request);
    }
  }

  async status(): Promise<{ reservedTokens: number; creditStopped: boolean; retryAfter: number | null;
    reconciliation?: ReconciliationRecord & { supplementalReservedTokens: number; supplementalCreditStopped: boolean } }> {
    const record = await this.storage.get<ReconciliationRecord>("embedding:reconciliation");
    const supplemental = record ? new DocumentEmbeddingLedger(reconciliationStore(this.storage, record.decisionSha256)) : null;
    const supplementalStatus = await supplemental?.status();
    return { reservedTokens: await this.storage.get<number>("embedding:reservedTokens") ?? 0,
      creditStopped: await this.storage.get<boolean>("embedding:creditStopped") ?? false,
      retryAfter: await this.storage.get<number>("embedding:retryAfter") ?? null,
      ...(record && supplementalStatus ? { reconciliation: { ...record,
        supplementalReservedTokens: supplementalStatus.reservedTokens,
        supplementalCreditStopped: supplementalStatus.creditStopped } } : {}) };
  }

  async reconcileValidated(requestId: string, decisionSha256: string, artifacts: DocumentEmbeddingPointer[]) {
    await this.storage.transaction(async store => {
      const record = await store.get<ReconciliationRecord>("embedding:reconciliation");
      const prior = await store.get<RequestRecord>(`embedding:request:${requestId}`);
      if (record?.decisionSha256 !== decisionSha256 || !prior || prior.state === "rejected"
        || (prior.reconciliationSha256 && prior.reconciliationSha256 !== decisionSha256)
        || artifacts.length !== prior.inputs.length || new Set(artifacts.map(item => item.inputSha256)).size !== artifacts.length
        || prior.inputs.some(item => !artifacts.some(pointer => pointer.inputSha256 === item.inputSha256))) fail("RECONCILIATION_CONFLICT");
      await store.put({ [`embedding:request:${requestId}`]: { ...prior, artifacts, reconciliationSha256: decisionSha256 } });
    });
  }

  async inspect(inputSha256s: readonly string[]) {
    if (inputSha256s.length < 1 || inputSha256s.length > 64
      || inputSha256s.some(value => !digestSchema.safeParse(value).success)) fail("INSPECTION_INVALID");
    const inputs = await Promise.all([...new Set(inputSha256s)].map(async inputSha256 => ({
      inputSha256, requestId: await this.storage.get<string>(`embedding:input:${inputSha256}`) ?? null,
    })));
    const requests: RequestRecord[] = [];
    for (const requestId of new Set(inputs.map(item => item.requestId).filter(value => value !== null))) {
      const request = await this.storage.get<RequestRecord>(`embedding:request:${requestId}`);
      if (!request) fail("REQUEST_CONFLICT");
      requests.push(request);
    }
    return { inputs, requests, accounting: await this.status() };
  }

  async complete(request: RequestRecord): Promise<void> {
    await this.storage.transaction(async store => {
      const prior = await store.get<RequestRecord>(`embedding:request:${request.id}`);
      if (!prior || prior.state === "rejected") fail("REQUEST_CONFLICT");
      if (prior.state === "complete") return;
      const ownerKey = `embedding:owner:${request.ownerId}`;
      const ownerTokens = await store.get<number>(ownerKey) ?? 0;
      await store.put({ [`embedding:request:${request.id}`]: { ...prior, state: "complete" },
        [ownerKey]: ownerTokens + prior.tokens });
    });
  }

  async ownerTokens(ownerId: string): Promise<number> { return await this.storage.get<number>(`embedding:owner:${ownerId}`) ?? 0; }

  async stopForCredit(): Promise<void> { await this.storage.put({ "embedding:creditStopped": true }); }

  async rateLimited(request: RequestRecord, retryAfter: number): Promise<void> {
    await this.storage.transaction(async store => {
      const prior = await store.get<RequestRecord>(`embedding:request:${request.id}`);
      if (!prior || prior.state !== "pending") fail("REQUEST_CONFLICT");
      const reserved = await store.get<number>("embedding:reservedTokens") ?? 0;
      await store.put({ [`embedding:request:${request.id}`]: { ...prior, state: "rejected" },
        "embedding:reservedTokens": reserved - prior.tokens, "embedding:retryAfter": retryAfter });
    });
  }
}

async function persistPointer(bucket: R2Bucket, pointer: DocumentEmbeddingPointer) {
  await putImmutableCustomArtifact(bucket, documentEmbeddingPointerKey(pointer.inputSha256),
    serializeCustomCurrentArtifact(pointer), { contentType: "application/json" });
  const verified = await readDocumentEmbedding(bucket, pointer.inputSha256);
  if (!verified) fail("ARTIFACT_MISSING");
  return verified;
}

/** Import only an audited full-identity artifact; old pointer formats are never trusted. */
export async function importDocumentEmbedding(bucket: R2Bucket, source: R2Bucket,
  reference: { inputSha256: string; artifactKey: string; vectorSha256: string; sizeBytes: number }) {
  const pointer = pointerSchema.parse({ ...reference, schemaVersion: 1, provider: "openai",
    model: CUSTOM_EMBEDDING_MODEL, dimensions: CUSTOM_EMBEDDING_DIMENSIONS,
    inputVersion: CUSTOM_EMBEDDING_INPUT_VERSION, transformVersion: CUSTOM_EMBEDDING_TRANSFORM_VERSION });
  if (await readDocumentEmbedding(bucket, pointer.inputSha256)) return;
  if (pointer.artifactKey !== `${prefix}/${pointer.inputSha256}/${pointer.vectorSha256}.f32`) fail("POINTER_INVALID");
  const artifact = await source.get(pointer.artifactKey);
  if (!artifact || artifact.size !== pointer.sizeBytes) fail("ARTIFACT_MISSING");
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  if (await customCurrentSha256(bytes) !== pointer.vectorSha256) fail("ARTIFACT_CORRUPT");
  await putImmutableCustomArtifact(bucket, pointer.artifactKey, bytes, { contentType: "application/octet-stream" });
  await persistPointer(bucket, pointer);
}

async function readProviderResponse(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) fail("RESPONSE_INVALID");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); fail("RESPONSE_TOO_LARGE"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail("RESPONSE_INVALID"); }
}

const responseSchema = z.object({ model: z.literal(CUSTOM_EMBEDDING_MODEL),
  data: z.array(z.object({ index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).length(CUSTOM_EMBEDDING_DIMENSIONS) })).min(1).max(64),
  usage: z.object({ prompt_tokens: z.number().int().positive(), total_tokens: z.number().int().positive() }),
});

export async function ensureDocumentEmbeddings(input: {
  configuration: DocumentEmbeddingConfiguration; ledger: DocumentEmbeddingLedger; bucket: R2Bucket;
  inputs: DocumentEmbeddingInput[]; ownerId: string;
  provider: (request: DocumentEmbeddingRequest) => Promise<Response>;
  now?: () => number;
}): Promise<{ artifacts: DocumentEmbeddingPointer[]; providerInputTokens: number; reusedEmbeddingCount: number }> {
  const configuration = input.configuration;
  if (!configuration.enabled) fail("DISABLED");
  if (!digestSchema.safeParse(configuration.manifestSha256).success
    || !configuration.releaseId.startsWith(`release:${configuration.environment}:`)
    || [configuration.authorizedTokens, configuration.requestsPerMinute, configuration.tokensPerMinute]
      .some(value => !Number.isSafeInteger(value) || value <= 0)) fail("CONFIGURATION_INVALID");
  const unique = new Map<string, DocumentEmbeddingInput>();
  for (const item of input.inputs) {
    if (!Number.isSafeInteger(item.inputTokens) || item.inputTokens < 1 || item.inputTokens > 8192
      || item.inputTokens !== item.chunk.embeddingTokenCount
      || await customCurrentSha256(serializeCustomEmbeddingInput(item.chunk)) !== item.inputSha256) fail("INPUT_INVALID");
    const prior = unique.get(item.inputSha256);
    if (prior && prior.inputTokens !== item.inputTokens) fail("INPUT_INVALID");
    unique.set(item.inputSha256, item);
  }
  await input.ledger.recover([...unique.values()], input.bucket);
  const pointers = new Map<string, DocumentEmbeddingPointer>();
  const missing: DocumentEmbeddingInput[] = [];
  const existing = await mapCustomArtifactOperations([...unique.values()], async item => ({
    item, pointer: await readDocumentEmbedding(input.bucket, item.inputSha256),
  }));
  for (const { item, pointer } of existing) {
    if (pointer) pointers.set(item.inputSha256, pointer); else missing.push(item);
  }
  const reusedEmbeddingCount = input.inputs.filter(item => pointers.has(item.inputSha256)).length;
  for (let offset = 0; offset < missing.length;) {
    const group: DocumentEmbeddingInput[] = [];
    let tokens = 0;
    while (offset < missing.length && group.length < 64
      && tokens + missing[offset]!.inputTokens <= 250000) {
      const item = missing[offset++]!;
      group.push(item); tokens += item.inputTokens;
    }
    const request = await input.ledger.begin(configuration, group, input.ownerId, input.now?.() ?? Date.now());
    const response = await input.provider({ model: CUSTOM_EMBEDDING_MODEL, dimensions: CUSTOM_EMBEDDING_DIMENSIONS,
      encoding_format: "float", input: group.map(item => serializeCustomEmbeddingInput(item.chunk)) });
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string().optional(), type: z.string().optional() }) })
        .safeParse(await readProviderResponse(response));
      if (error.success && (error.data.error.code === "credit_balance_exhausted"
        || error.data.error.code === "insufficient_quota" || error.data.error.type === "insufficient_quota")) {
        await input.ledger.stopForCredit();
        fail("CREDIT_STOP");
      }
      if (response.status === 429 && error.success && error.data.error.code === "rate_limit_exceeded") {
        const seconds = Number(response.headers.get("retry-after") ?? 60);
        if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86400) fail("PROVIDER_REJECTED");
        await input.ledger.rateLimited(request, (input.now?.() ?? Date.now()) + Math.max(60, seconds) * 1000);
        fail("RATE_LIMIT");
      }
      fail("PROVIDER_REJECTED");
    }
    const result = responseSchema.safeParse(await readProviderResponse(response));
    if (!result.success) fail("RESPONSE_INVALID");
    const payload = result.data;
    if (payload.data.length !== group.length || new Set(payload.data.map(item => item.index)).size !== group.length
      || payload.data.some(item => item.index >= group.length)
      || payload.usage.prompt_tokens !== tokens || payload.usage.total_tokens !== tokens) fail("RESPONSE_MISMATCH");
    // Validate every vector before any artifact becomes reusable.
    const artifacts = await Promise.all(payload.data.map(item => createCustomEmbeddingArtifact(group[item.index]!.chunk, item.embedding)));
    const validated = await mapCustomArtifactOperations(artifacts, async artifact => {
      await putImmutableCustomArtifact(input.bucket, artifact.key, artifact.bytes, { contentType: "application/octet-stream" });
      const pointer: DocumentEmbeddingPointer = { schemaVersion: 1, provider: "openai", model: artifact.model,
        dimensions: artifact.dimensions, inputVersion: artifact.inputVersion, transformVersion: artifact.transformVersion,
        inputSha256: artifact.inputSha256, vectorSha256: artifact.vectorSha256, artifactKey: artifact.key,
        sizeBytes: CUSTOM_EMBEDDING_DIMENSIONS * 4 };
      return pointer;
    });
    await input.ledger.persistValidated(request, validated);
    const verified = await mapCustomArtifactOperations(validated, pointer => persistPointer(input.bucket, pointer));
    for (const pointer of verified) pointers.set(pointer.inputSha256, pointer);
    await input.ledger.complete(request);
  }
  return { artifacts: input.inputs.map(item => pointers.get(item.inputSha256)!),
    providerInputTokens: await input.ledger.ownerTokens(input.ownerId), reusedEmbeddingCount };
}

const reconciliationDecisionSchema = z.object({
  schemaVersion: z.literal(1), releaseId: z.string(), acceptedManifestSha256: digestSchema,
  originalUnknownReservedTokens: z.number().int().positive(), supplementalTokens: z.number().int().positive().max(250000),
  requests: z.array(z.object({ requestId: z.string().uuid(), ownerId: z.string().min(1).max(300),
    originalReservedTokens: z.number().int().positive(), inputs: z.array(z.object({
      inputSha256: digestSchema, inputTokens: z.number().int().positive().max(8192),
      existingArtifact: z.object({ key: z.string(), sha256: digestSchema, sizeBytes: z.literal(6144) }).nullable(),
    })).min(1).max(64),
  })).min(1).max(64),
});

/** A hash-bound operator decision recovers saved bytes without releasing unknown reservations. */
export async function reconcileDocumentEmbeddings(input: {
  decisionJson: string; authorizedDecisionSha256: string;
  configuration: DocumentEmbeddingConfiguration; storage: EmbeddingStore; bucket: R2Bucket;
  supplementalInputs: DocumentEmbeddingInput[];
  provider: (request: DocumentEmbeddingRequest) => Promise<Response>;
}) {
  if (!input.configuration.enabled || !digestSchema.safeParse(input.authorizedDecisionSha256).success
    || new TextEncoder().encode(input.decisionJson).length > 64000
    || await customCurrentSha256(input.decisionJson) !== input.authorizedDecisionSha256) fail("RECONCILIATION_UNAUTHORIZED");
  const decision = reconciliationDecisionSchema.parse(JSON.parse(input.decisionJson));
  const decisionSha256 = input.authorizedDecisionSha256;
  const allInputs = decision.requests.flatMap(request => request.inputs);
  const missing = allInputs.filter(item => !item.existingArtifact);
  if (decision.releaseId !== input.configuration.releaseId
    || decision.acceptedManifestSha256 !== input.configuration.manifestSha256
    || allInputs.length > 64 || new Set(allInputs.map(item => item.inputSha256)).size !== allInputs.length
    || new Set(decision.requests.map(request => request.requestId)).size !== decision.requests.length
    || decision.requests.reduce((sum, request) => sum + request.originalReservedTokens, 0) !== decision.originalUnknownReservedTokens
    || missing.reduce((sum, item) => sum + item.inputTokens, 0) !== decision.supplementalTokens
    || input.supplementalInputs.length !== missing.length
    || new Set(input.supplementalInputs.map(item => item.inputSha256)).size !== missing.length) fail("RECONCILIATION_INVALID");
  for (const item of input.supplementalInputs) {
    if (!missing.some(expected => expected.inputSha256 === item.inputSha256 && expected.inputTokens === item.inputTokens)
      || item.chunk.embeddingTokenCount !== item.inputTokens
      || await customCurrentSha256(serializeCustomEmbeddingInput(item.chunk)) !== item.inputSha256) fail("RECONCILIATION_INVALID");
  }
  const ledger = new DocumentEmbeddingLedger(input.storage);
  const inspected = await ledger.inspect(allInputs.map(item => item.inputSha256));
  for (const expected of decision.requests) {
    const actual = inspected.requests.find(request => request.id === expected.requestId);
    if (!actual || actual.ownerId !== expected.ownerId || actual.tokens !== expected.originalReservedTokens
      || actual.inputs.length !== expected.inputs.length
      || actual.tokens !== expected.inputs.reduce((sum, item) => sum + item.inputTokens, 0)
      || actual.inputs.some(item => !expected.inputs.some(value => value.inputSha256 === item.inputSha256 && value.inputTokens === item.inputTokens))
      || expected.inputs.some(item => !inspected.inputs.some(value => value.inputSha256 === item.inputSha256 && value.requestId === expected.requestId))
      || (actual.reconciliationSha256 !== decisionSha256 && (actual.state !== "pending" || actual.artifacts))) fail("RECONCILIATION_CONFLICT");
  }
  await input.storage.transaction(async store => {
    const prior = await store.get<ReconciliationRecord>("embedding:reconciliation");
    if (prior && prior.decisionSha256 !== decisionSha256) fail("RECONCILIATION_CONFLICT");
    if (!prior) await store.put({ "embedding:reconciliation": {
      decisionSha256, originalUnknownReservedTokens: decision.originalUnknownReservedTokens,
      supplementalAuthorizedTokens: decision.supplementalTokens, state: "pending",
    } satisfies ReconciliationRecord, "embedding:reconciliation:decision": input.decisionJson });
  });
  // Publish only decision-bound saved artifacts, while original input fences still block normal dispatch.
  await mapCustomArtifactOperations(allInputs.filter(item => item.existingArtifact), async item => {
    const artifact = item.existingArtifact!;
    await importDocumentEmbedding(input.bucket, input.bucket, { inputSha256: item.inputSha256,
      artifactKey: artifact.key, vectorSha256: artifact.sha256, sizeBytes: artifact.sizeBytes });
    const pointer = await readDocumentEmbedding(input.bucket, item.inputSha256);
    if (pointer?.artifactKey !== artifact.key || pointer.vectorSha256 !== artifact.sha256) fail("RECONCILIATION_CONFLICT");
  });
  const supplementalLedger = new DocumentEmbeddingLedger(reconciliationStore(input.storage, decisionSha256));
  await ensureDocumentEmbeddings({ configuration: { ...input.configuration, authorizedTokens: decision.supplementalTokens },
    ledger: supplementalLedger, bucket: input.bucket, inputs: input.supplementalInputs,
    ownerId: `reconciliation:${decisionSha256}`, provider: input.provider });
  const artifacts = await mapCustomArtifactOperations(allInputs, async item => {
    const pointer = await readDocumentEmbedding(input.bucket, item.inputSha256);
    if (!pointer) fail("ARTIFACT_MISSING");
    return pointer;
  });
  // All vectors and decision provenance exist before any original request is allowed to complete.
  for (const expected of decision.requests) {
    await ledger.reconcileValidated(expected.requestId, decisionSha256,
      artifacts.filter(pointer => expected.inputs.some(item => item.inputSha256 === pointer.inputSha256)));
    await ledger.complete(inspected.requests.find(request => request.id === expected.requestId)!);
  }
  await input.storage.transaction(async store => {
    const prior = await store.get<ReconciliationRecord>("embedding:reconciliation");
    if (prior?.decisionSha256 !== decisionSha256) fail("RECONCILIATION_CONFLICT");
    await store.put({ "embedding:reconciliation": { ...prior, state: "complete" } });
  });
  return ledger.status();
}
