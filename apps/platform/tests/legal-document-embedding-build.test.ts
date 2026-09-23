import assert from "node:assert/strict";
import test from "node:test";
import { DocumentEmbeddingLedger, ensureDocumentEmbeddings, type EmbeddingStore, type EmbeddingValues } from "../lib/legal-corpus/document-embedding-build";
import { buildRetrievalChunks, serializeCustomEmbeddingInput } from "../lib/legal-corpus/custom-hybrid-index";
import { customCurrentSha256 } from "../lib/legal-corpus/custom-current-build";
import { requestDocumentEmbeddings } from "../lib/legal-corpus/document-embedding-build";
import { reconcileDocumentEmbeddings } from "../lib/legal-corpus/document-embedding-build";
import { createCustomEmbeddingArtifact, putImmutableCustomArtifact } from "../lib/legal-corpus/custom-hybrid-index";

class MemoryStore implements EmbeddingStore {
  values = new Map<string, unknown>();
  private tail: Promise<unknown> = Promise.resolve();
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.values.get(key)) as T | undefined; }
  async put(values: Record<string, unknown>) {
    assert.ok(Object.keys(values).length <= 128, "Durable storage put limit");
    for (const [key, value] of Object.entries(values)) this.values.set(key, structuredClone(value));
  }
  transaction<T>(callback: (store: EmbeddingValues) => Promise<T>): Promise<T> {
    const result = this.tail.then(() => callback(this));
    this.tail = result.catch(() => undefined);
    return result;
  }
}

class MemoryR2 {
  objects = new Map<string, { bytes: Uint8Array; customMetadata: Record<string, string> }>();
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async get(key: string) {
    const item = this.objects.get(key);
    return item ? { size: item.bytes.length, customMetadata: item.customMetadata,
      arrayBuffer: async () => item.bytes.slice().buffer } : null;
  }
  async put(key: string, bytes: Uint8Array, options: { customMetadata: Record<string, string> }) {
    if (this.objects.has(key)) return null;
    this.objects.set(key, { bytes: bytes.slice(), customMetadata: options.customMetadata });
    return { key };
  }
  binding() { return this as unknown as R2Bucket; }
}

const configuration = {
  environment: "staging" as const, releaseId: "release:staging:current:fixture",
  manifestSha256: "a".repeat(64), authorizedTokens: 10000,
  requestsPerMinute: 60, tokensPerMinute: 10000, enabled: true,
};

test("embedding dispatch makes one direct request using the existing model contract", async () => {
  const request = { model: "text-embedding-3-large" as const, dimensions: 1536 as const,
    encoding_format: "float" as const, input: ["fixture"] };
  let calls = 0;
  const response = await requestDocumentEmbeddings("fixture-key", request, async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/embeddings");
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer fixture-key");
    assert.deepEqual(JSON.parse(String(options?.body)), request);
    assert.ok(options?.signal instanceof AbortSignal);
    return new Response("fixture");
  });
  assert.equal(calls, 1);
  assert.equal(await response.text(), "fixture");
});

async function input(text: string) {
  const [chunk] = await buildRetrievalChunks({ snapshotProvisionId: "provision:fixture",
    sourceDocumentTitle: "Fixture law", documentType: "unknown", articleNumber: "1",
    articleTitle: null, hierarchy: [], language: "en", script: "Latn", officialText: text,
    validFromEpoch: 0, validToEpoch: null }, { targetTokens: 512 });
  assert.ok(chunk);
  return { chunk, inputSha256: await customCurrentSha256(serializeCustomEmbeddingInput(chunk)),
    inputTokens: chunk.embeddingTokenCount };
}

test("document build uses regular requests, validates reordered results and reuses duplicate inputs after restart", async () => {
  const inputs = [await input("One supported provision."), await input("A different provision.")];
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  const providerRequests: unknown[] = [];
  const provider = async (request: { input: string[] }) => {
    providerRequests.push(request);
    return Response.json({ model: "text-embedding-3-large", data: [1, 0].map(index => ({
      index, embedding: Array.from({ length: 1536 }, (_, i) => i === index ? 1 : 0),
    })), usage: { prompt_tokens: inputs.reduce((sum, item) => sum + item.inputTokens, 0),
      total_tokens: inputs.reduce((sum, item) => sum + item.inputTokens, 0) } });
  };
  const run = () => ensureDocumentEmbeddings({ configuration,
    ledger: new DocumentEmbeddingLedger(storage), bucket: bucket.binding(),
    inputs: [...inputs, inputs[0]!], ownerId: "page-1", provider, now: () => 1000 });
  const first = await run();
  assert.equal(first.artifacts.length, 3);
  assert.equal(first.artifacts[0]?.vectorSha256, first.artifacts[2]?.vectorSha256);
  assert.notEqual(first.artifacts[0]?.vectorSha256, first.artifacts[1]?.vectorSha256);
  assert.equal(providerRequests.length, 1);
  assert.deepEqual(providerRequests[0], { model: "text-embedding-3-large", dimensions: 1536,
    encoding_format: "float", input: inputs.map(item => serializeCustomEmbeddingInput(item.chunk)) });
  const second = await run();
  assert.deepEqual(second.artifacts, first.artifacts);
  assert.equal(second.providerInputTokens, first.providerInputTokens);
  assert.equal(providerRequests.length, 1);
});

test("large embedding requests tolerate storage latency within a bounded I/O budget", async () => {
  const inputs = await Promise.all(Array.from({ length: 64 }, (_, index) => input(`Provision ${index}.`)));
  const tokens = inputs.reduce((sum, item) => sum + item.inputTokens, 0);
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  let rounds = 0;
  let active = 0;
  let maximumActive = 0;
  let waiting: Array<() => void> = [];
  const latency = () => new Promise<void>((resolve) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    waiting.push(() => { active--; resolve(); });
    if (waiting.length === 1) setImmediate(() => {
      rounds++;
      const current = waiting;
      waiting = [];
      for (const finish of current) finish();
    });
  });
  const head = bucket.head.bind(bucket), get = bucket.get.bind(bucket), put = bucket.put.bind(bucket);
  bucket.head = async (...args) => { await latency(); return head(...args); };
  bucket.get = async (...args) => { await latency(); return get(...args); };
  bucket.put = async (...args) => { await latency(); return put(...args); };
  let requests = 0;
  const run = () => ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
    bucket: bucket.binding(), inputs, ownerId: "large-request", provider: async () => {
      requests++;
      return Response.json({ model: "text-embedding-3-large",
        data: inputs.map((_, index) => ({ index, embedding: Array.from({ length: 1536 }, (_, i) => i === index ? 1 : 0) })).reverse(),
        usage: { prompt_tokens: tokens, total_tokens: tokens } });
    } });
  const first = await run();
  assert.ok(rounds < 300, `storage latency rounds: ${rounds}`);
  assert.ok(maximumActive <= 6, `concurrent artifact operations: ${maximumActive}`);
  assert.deepEqual(first.artifacts.map(item => item.inputSha256), inputs.map(item => item.inputSha256));
  const second = await run();
  assert.deepEqual(second.artifacts, first.artifacts);
  assert.equal(requests, 1);
  assert.equal(first.providerInputTokens, tokens);
  assert.equal((await new DocumentEmbeddingLedger(storage).status()).reservedTokens, tokens);
});

test("unknown provider outcomes retain the reservation and cannot be dispatched twice", async () => {
  const item = await input("Unknown outcome.");
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  let requests = 0;
  const run = () => ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
    bucket: bucket.binding(), inputs: [item], ownerId: "unknown", provider: async () => { requests++; throw Error("network"); } });
  await assert.rejects(run(), /network/);
  await assert.rejects(run(), /OUTCOME_UNRESOLVED/);
  assert.equal(requests, 1);
  assert.equal((await new DocumentEmbeddingLedger(storage).status()).reservedTokens, item.inputTokens);
  assert.equal(bucket.objects.size, 0);
});

test("request inspection is bounded, content-free and does not change pending reservations", async () => {
  const item = await input("Inspect a pending request without dispatch.");
  const storage = new MemoryStore();
  const ledger = new DocumentEmbeddingLedger(storage);
  const request = await ledger.begin(configuration, [item], "inspection", 1000);
  const before = structuredClone(storage.values);
  const result = await ledger.inspect([item.inputSha256, item.inputSha256, "b".repeat(64)]);
  assert.deepEqual(result.requests, [request]);
  assert.deepEqual(result.inputs, [
    { inputSha256: item.inputSha256, requestId: request.id },
    { inputSha256: "b".repeat(64), requestId: null },
  ]);
  assert.equal(result.accounting.reservedTokens, item.inputTokens);
  assert.doesNotMatch(JSON.stringify(result), /Inspect a pending|officialText|embeddingTokenCount/);
  await assert.rejects(ledger.inspect(["invalid"]), /INSPECTION_INVALID/);
  await assert.rejects(ledger.inspect(Array(65).fill(item.inputSha256)), /INSPECTION_INVALID/);
  assert.deepEqual(storage.values, before);
});

test("disabled and over-budget configurations never dispatch", async () => {
  const item = await input("Budget guard.");
  for (const config of [{ ...configuration, enabled: false }, { ...configuration, authorizedTokens: item.inputTokens - 1 }]) {
    let requests = 0;
    await assert.rejects(ensureDocumentEmbeddings({ configuration: config, ledger: new DocumentEmbeddingLedger(new MemoryStore()),
      bucket: new MemoryR2().binding(), inputs: [item], ownerId: "budget",
      provider: async () => { requests++; throw Error("unexpected"); } }), /DISABLED|COST_STOP/);
    assert.equal(requests, 0);
  }
});

test("malformed successful responses produce no artifacts and keep the unknown-outcome fence", async () => {
  const item = await input("Response checks.");
  const valid = { model: "text-embedding-3-large", data: [{ index: 0, embedding: Array(1536).fill(1) }],
    usage: { prompt_tokens: item.inputTokens, total_tokens: item.inputTokens } };
  for (const payload of [
    { ...valid, model: "another-model" }, { ...valid, data: [{ index: 1, embedding: Array(1536).fill(1) }] },
    { ...valid, data: [valid.data[0], valid.data[0]] },
    { ...valid, data: [{ index: 0, embedding: Array(1535).fill(1) }] },
    { ...valid, data: [{ index: 0, embedding: Array(1536).fill(0) }] },
    { ...valid, data: [{ index: 0, embedding: Array(1536).fill(null) }] },
    { ...valid, usage: { prompt_tokens: item.inputTokens + 1, total_tokens: item.inputTokens + 1 } },
  ]) {
    const storage = new MemoryStore();
    const bucket = new MemoryR2();
    let requests = 0;
    const run = () => ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
      bucket: bucket.binding(), inputs: [item], ownerId: "malformed",
      provider: async () => { requests++; return Response.json(payload); } });
    await assert.rejects(run());
    assert.equal(bucket.objects.size, 0);
    await assert.rejects(run(), /OUTCOME_UNRESOLVED/);
    assert.equal(requests, 1);
  }
});

test("concurrent duplicate delivery makes only one provider request", async () => {
  const item = await input("Concurrent delivery.");
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const run = () => ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
    bucket: bucket.binding(), inputs: [item], ownerId: "duplicate", provider: async () => {
      requests++; entered(); await pending;
      return Response.json({ model: "text-embedding-3-large", data: [{ index: 0, embedding: Array(1536).fill(1) }],
        usage: { prompt_tokens: item.inputTokens, total_tokens: item.inputTokens } });
    } });
  const first = run();
  await started;
  await assert.rejects(run(), /OUTCOME_UNRESOLVED/);
  release();
  await first;
  assert.equal(requests, 1);
});

test("restart after vector persistence finishes pointers and accounting without another charge", async () => {
  const item = await input("Recover persisted response.");
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  const originalPut = bucket.put.bind(bucket);
  let failPointer = true;
  bucket.put = async (key, bytes, options) => {
    if (failPointer && key.includes('/verified/')) throw Error("R2 interruption");
    return originalPut(key, bytes, options);
  };
  let requests = 0;
  const run = () => ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
    bucket: bucket.binding(), inputs: [item], ownerId: "restart", provider: async () => {
      requests++;
      return Response.json({ model: "text-embedding-3-large", data: [{ index: 0, embedding: Array(1536).fill(1) }],
        usage: { prompt_tokens: item.inputTokens, total_tokens: item.inputTokens } });
    } });
  await assert.rejects(run(), /R2 interruption/);
  failPointer = false;
  const result = await run();
  assert.equal(requests, 1);
  assert.equal(result.providerInputTokens, item.inputTokens);
  assert.equal(result.artifacts.length, 1);
});

test("pointer failure settles other started writes before a restart reuses the paid response", async () => {
  const inputs = [await input("First persisted vector."), await input("Second persisted vector.")];
  const tokens = inputs.reduce((sum, item) => sum + item.inputTokens, 0);
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  const put = bucket.put.bind(bucket);
  let fail = true;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  bucket.put = async (key, bytes, options) => {
    if (fail && key.includes("/verified/")) {
      if (key.includes(inputs[0]!.inputSha256)) throw Error("R2 interruption");
      entered();
      await pending;
    }
    return put(key, bytes, options);
  };
  let requests = 0;
  const run = () => ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
    bucket: bucket.binding(), inputs, ownerId: "settled-restart", provider: async () => {
      requests++;
      return Response.json({ model: "text-embedding-3-large",
        data: inputs.map((_, index) => ({ index, embedding: Array(1536).fill(1) })),
        usage: { prompt_tokens: tokens, total_tokens: tokens } });
    } });
  let settled = false;
  const first = run().finally(() => { settled = true; });
  const rejected = assert.rejects(first, /R2 interruption/);
  await started;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await rejected;
  fail = false;
  const result = await run();
  assert.equal(requests, 1);
  assert.equal(result.providerInputTokens, tokens);
  assert.equal(result.artifacts.length, 2);
  assert.equal((await new DocumentEmbeddingLedger(storage).status()).reservedTokens, tokens);
});

test("credit exhaustion stops later dispatch and does not retry unrelated inputs", async () => {
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  let requests = 0;
  const run = (inputs: Awaited<ReturnType<typeof input>>[]) => ensureDocumentEmbeddings({
    configuration, ledger: new DocumentEmbeddingLedger(storage), bucket: bucket.binding(), inputs,
    ownerId: "quota-page", provider: async () => { requests++;
      return Response.json({ error: { code: "credit_balance_exhausted", type: "insufficient_quota" } }, { status: 429 });
    }, now: () => 1000,
  });
  await assert.rejects(run([await input("First provision.")]), /CUSTOM_EMBEDDING_CREDIT_STOP/);
  await assert.rejects(run([await input("Another provision.")]), /CUSTOM_EMBEDDING_CREDIT_STOP/);
  assert.equal(requests, 1);
  assert.equal(bucket.objects.size, 0);
});

test("a full request reserves atomically within durable storage call limits", async () => {
  const inputs = await Promise.all(Array.from({ length: 64 }, (_, index) => input(`Provision ${index}.`)));
  const tokens = inputs.reduce((sum, item) => sum + item.inputTokens, 0);
  let requests = 0;
  const storage = new MemoryStore();
  const result = await ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
    bucket: new MemoryR2().binding(), inputs, ownerId: "full-request", provider: async request => {
      requests++;
      assert.equal(request.input.length, 64);
      return Response.json({ model: "text-embedding-3-large", data: inputs.map((_, index) => ({ index, embedding: Array(1536).fill(1) })),
        usage: { prompt_tokens: tokens, total_tokens: tokens } });
    } });
  assert.equal(requests, 1);
  assert.equal(result.providerInputTokens, tokens);
  assert.equal((await new DocumentEmbeddingLedger(storage).status()).reservedTokens, tokens);
});

test("a known rate-limit rejection can retry once the durable cooldown ends", async () => {
  const item = await input("Retryable provision.");
  const storage = new MemoryStore();
  const bucket = new MemoryR2();
  let requests = 0;
  let now = 1000;
  const run = () => ensureDocumentEmbeddings({ configuration, ledger: new DocumentEmbeddingLedger(storage),
    bucket: bucket.binding(), inputs: [item], ownerId: "rate-page", now: () => now,
    provider: async () => {
      requests++;
      if (requests === 1) return Response.json({ error: { type: "rate_limit_error", code: "rate_limit_exceeded" } },
        { status: 429, headers: { "retry-after": "90" } });
      return Response.json({ model: "text-embedding-3-large", data: [{ index: 0, embedding: Array(1536).fill(1) }],
        usage: { prompt_tokens: item.inputTokens, total_tokens: item.inputTokens } });
    },
  });
  await assert.rejects(run(), /CUSTOM_EMBEDDING_RATE_LIMIT/);
  now = 61000;
  await assert.rejects(run(), /CUSTOM_EMBEDDING_RATE_LIMIT/);
  assert.equal(requests, 1);
  now = 91001;
  const result = await run();
  assert.equal(result.providerInputTokens, item.inputTokens);
  assert.equal(requests, 2);
});

async function interruptedEmbeddingFixture() {
  const inputs = [await input("Saved response vector."), await input("Missing response vector.")];
  const storage = new MemoryStore(), bucket = new MemoryR2();
  const ledger = new DocumentEmbeddingLedger(storage);
  const request = await ledger.begin(configuration, inputs, "page-recovery", 1000);
  const artifact = await createCustomEmbeddingArtifact(inputs[0]!.chunk,
    Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0));
  await putImmutableCustomArtifact(bucket.binding(), artifact.key, artifact.bytes,
    { contentType: "application/octet-stream" });
  const decisionJson = JSON.stringify({ schemaVersion: 1, releaseId: configuration.releaseId,
    acceptedManifestSha256: configuration.manifestSha256, originalUnknownReservedTokens: request.tokens,
    supplementalTokens: inputs[1]!.inputTokens, requests: [{ requestId: request.id, ownerId: request.ownerId,
      originalReservedTokens: request.tokens, inputs: inputs.map((item, index) => ({
        inputSha256: item.inputSha256, inputTokens: item.inputTokens,
        existingArtifact: index === 0 ? { key: artifact.key, sha256: artifact.vectorSha256, sizeBytes: 6144 } : null,
      })) }] });
  const authorizedDecisionSha256 = await customCurrentSha256(decisionJson);
  return { inputs, storage, bucket, ledger, request, decisionJson, authorizedDecisionSha256 };
}

test("authorized reconciliation preserves original fences and bills only missing vectors to a separate reservation", async () => {
  const fixture = await interruptedEmbeddingFixture();
  const { inputs, ledger, request } = fixture;
  let calls = 0;
  const run = () => reconcileDocumentEmbeddings({ ...fixture, bucket: fixture.bucket.binding(), configuration,
    supplementalInputs: [inputs[1]!], provider: async body => {
      calls++;
      assert.deepEqual(body.input, [serializeCustomEmbeddingInput(inputs[1]!.chunk)]);
      return Response.json({ model: "text-embedding-3-large", data: [{ index: 0,
        embedding: Array.from({ length: 1536 }, (_, index) => index === 1 ? 1 : 0) }],
      usage: { prompt_tokens: inputs[1]!.inputTokens, total_tokens: inputs[1]!.inputTokens } });
    } });
  await run();
  await run();
  assert.equal(calls, 1);
  const inspected = await ledger.inspect(inputs.map(item => item.inputSha256));
  assert.ok(inspected.inputs.every(item => item.requestId === request.id));
  assert.equal(inspected.requests[0]?.state, "complete");
  assert.equal(await ledger.ownerTokens(request.ownerId), request.tokens);
  const accounting = await ledger.status();
  assert.equal(accounting.reservedTokens, request.tokens);
  assert.equal(accounting.reconciliation?.supplementalReservedTokens, inputs[1]!.inputTokens);
  assert.equal(accounting.reconciliation?.originalUnknownReservedTokens, request.tokens);
  assert.equal(accounting.reconciliation?.state, "complete");
  const ordinary = await ensureDocumentEmbeddings({ configuration, ledger, bucket: fixture.bucket.binding(),
    inputs, ownerId: request.ownerId, provider: async () => { throw Error("UNEXPECTED_PROVIDER_RETRY"); } });
  assert.equal(ordinary.artifacts.length, 2);
  assert.equal(ordinary.providerInputTokens, request.tokens);
});

test("an unknown supplemental outcome stays fenced across reconciliation retries", async () => {
  const fixture = await interruptedEmbeddingFixture();
  let calls = 0;
  const run = () => reconcileDocumentEmbeddings({ ...fixture, bucket: fixture.bucket.binding(), configuration,
    supplementalInputs: [fixture.inputs[1]!], provider: async () => { calls++; throw Error("NETWORK_OUTCOME_UNKNOWN"); } });
  await assert.rejects(run, /NETWORK_OUTCOME_UNKNOWN/);
  await assert.rejects(run, /OUTCOME_UNRESOLVED/);
  assert.equal(calls, 1);
  const inspected = await fixture.ledger.inspect(fixture.inputs.map(item => item.inputSha256));
  assert.equal(inspected.requests[0]?.state, "pending");
  assert.ok(inspected.inputs.every(item => item.requestId === fixture.request.id));
  assert.equal(await fixture.ledger.ownerTokens(fixture.request.ownerId), 0);
  assert.equal(inspected.accounting.reservedTokens, fixture.request.tokens);
  assert.equal(inspected.accounting.reconciliation?.supplementalReservedTokens, fixture.inputs[1]!.inputTokens);
});

test("reconciliation rejects altered authority and mismatched original inputs before provider dispatch", async () => {
  const fixture = await interruptedEmbeddingFixture();
  const before = await fixture.ledger.inspect(fixture.inputs.map(item => item.inputSha256));
  let calls = 0;
  const provider = async () => { calls++; throw Error("UNEXPECTED_PROVIDER"); };
  await assert.rejects(() => reconcileDocumentEmbeddings({ ...fixture, bucket: fixture.bucket.binding(), configuration,
    supplementalInputs: [fixture.inputs[1]!], decisionJson: fixture.decisionJson + " ", provider }), /RECONCILIATION_UNAUTHORIZED/);
  const altered = JSON.parse(fixture.decisionJson);
  altered.requests[0].ownerId = "other-page";
  const decisionJson = JSON.stringify(altered);
  const authorizedDecisionSha256 = await customCurrentSha256(decisionJson);
  await assert.rejects(() => reconcileDocumentEmbeddings({ ...fixture, bucket: fixture.bucket.binding(), configuration,
    supplementalInputs: [fixture.inputs[1]!], decisionJson, authorizedDecisionSha256,
    provider }), /RECONCILIATION_CONFLICT/);
  assert.equal(calls, 0);
  assert.deepEqual(await fixture.ledger.inspect(fixture.inputs.map(item => item.inputSha256)), before);
});

test("reconciliation resumes after accounting interruption without another provider charge", async () => {
  const fixture = await interruptedEmbeddingFixture();
  let calls = 0, failOnce = true;
  const ordinaryPut = fixture.storage.put.bind(fixture.storage);
  fixture.storage.put = async values => {
    if (failOnce && Object.keys(values).some(key => key === `embedding:owner:${fixture.request.ownerId}`)) {
      failOnce = false;
      throw Error("ACCOUNTING_INTERRUPTED");
    }
    return ordinaryPut(values);
  };
  const run = () => reconcileDocumentEmbeddings({ ...fixture, bucket: fixture.bucket.binding(), configuration,
    supplementalInputs: [fixture.inputs[1]!], provider: async () => {
      calls++;
      return Response.json({ model: "text-embedding-3-large", data: [{ index: 0,
        embedding: Array.from({ length: 1536 }, (_, index) => index === 1 ? 1 : 0) }],
      usage: { prompt_tokens: fixture.inputs[1]!.inputTokens, total_tokens: fixture.inputs[1]!.inputTokens } });
    } });
  await assert.rejects(run, /ACCOUNTING_INTERRUPTED/);
  await run();
  assert.equal(calls, 1);
  assert.equal(await fixture.ledger.ownerTokens(fixture.request.ownerId), fixture.request.tokens);
  assert.equal((await fixture.ledger.status()).reconciliation?.state, "complete");
});
