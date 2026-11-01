import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createCorpusTransport } from "../lib/legal-answer-workflow/corpus-transport";
import { runIndexedRetrieval } from "../lib/runtime/indexed-retrieval";
import { preparedCandidateConfigurationSchema } from "../lib/legal-corpus/prepared-candidate-configuration";
import { withResearchDiagnostics, type ResearchDiagnostic } from "../lib/legal-answer-workflow/diagnostics";

const hash = "a".repeat(64), token = "synthetic-worker-token-1234567890123456";
const artifacts = { packageSha256: hash, vectorCompletionSha256: hash, vectorIdentitySha256: hash,
  membershipSha256: hash, workIndexSha256: hash, navigationSha256: hash, sparseSha256: hash };
const request = { artifacts, references: [[1, 2] as [number, number]] };

test("worker queue and service durations survive transport without content or observer failures", async () => {
  const events: ResearchDiagnostic[] = [];
  const server = await worker(response => {
    response.setHeader("Server-Timing", 'queue;dur=12.5, service;dur=23.75, private;desc="private content"');
    response.end('{"complete":true}');
  });
  try {
    const result = await withResearchDiagnostics(event => { events.push(event); throw new Error("Observer failed"); },
      () => createCorpusTransport(server.configuration).readExact(request));
    assert.deepEqual(result, { complete: true });
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "corpus_timing");
    if (events[0].event === "corpus_timing") {
      assert.equal(events[0].queueMs, 12.5);
      assert.equal(events[0].serviceMs, 23.75);
      assert.ok(events[0].durationMs >= 0);
      assert.ok(events[0].admissionWaitMs! >= 0);
      assert.ok(events[0].responseWaitMs! >= 0);
      assert.ok(events[0].bodyReadParseMs! >= 0);
    }
    assert.doesNotMatch(JSON.stringify(events), /private content|synthetic-worker|references|packageSha256/);
  } finally { await server.close(); }
});
test("app admission waiting is measured separately from worker queue and body parsing", async () => {
  const pending: ServerResponse[] = [];
  let ready!: () => void;
  const full = new Promise<void>(resolve => { ready = resolve; });
  const server = await worker(response => {
    response.setHeader("Server-Timing", "queue;dur=0, service;dur=1");
    pending.push(response);
    if (pending.length === 4) ready();
    if (pending.length === 5) response.end('{}');
  });
  try {
    const client = createCorpusTransport(server.configuration), signal = AbortSignal.timeout(3000);
    const active = Array.from({ length: 4 }, () => client.readExact(request, signal));
    await full;
    const events: ResearchDiagnostic[] = [];
    const queued = withResearchDiagnostics(event => events.push(event), () => client.readExact(request, signal));
    await new Promise(resolve => setTimeout(resolve, 30));
    for (const response of pending) response.end('{}');
    await Promise.all([...active, queued]);
    const timing = events.find(event => event.event === "corpus_timing");
    assert.ok(timing && timing.event === "corpus_timing");
    assert.ok(timing.admissionWaitMs! >= 20);
    assert.equal(timing.queueMs, 0);
    assert.ok(timing.durationMs >= timing.admissionWaitMs! + timing.responseWaitMs! + timing.bodyReadParseMs!);
  } finally { await server.close(); }
});
async function worker(handler: (response: ServerResponse, path: string, body: unknown) => void) {
  const server = createServer(async (incoming, response) => {
    assert.equal(incoming.headers.authorization, `Bearer ${token}`);
    assert.equal(incoming.method, "POST");
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    response.setHeader("Content-Type", "application/json"); response.setHeader("X-Juro-Worker-Sha256", hash);
    handler(response, incoming.url!, JSON.parse(Buffer.concat(chunks).toString("utf8")));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { configuration: { url: `http://127.0.0.1:${address.port}`, token, workerSha256: hash },
    async close() { server.closeAllConnections(); server.close(); await once(server, "close"); } };
}

test("four worker slots are shared across transport instances and queued cancellation never dispatches", async () => {
  const pending: ServerResponse[] = []; let fourReady: () => void = () => {};
  const ready = new Promise<void>(resolve => { fourReady = resolve; });
  const server = await worker((response, path, body) => {
    assert.equal(path, "/read-exact"); assert.deepEqual(body, request);
    pending.push(response); if (pending.length === 4) fourReady();
  });
  try {
    const first = createCorpusTransport(server.configuration), second = createCorpusTransport(server.configuration);
    const signal = AbortSignal.timeout(3000);
    const active = [first, second, first, second].map(client => client.readExact(request, signal));
    await Promise.race([ready, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
    const controller = new AbortController();
    const cancelled = assert.rejects(first.readExact(request, controller.signal), /fixture cancellation/);
    controller.abort(new Error("fixture cancellation")); await cancelled;
    assert.equal(pending.length, 4);
    for (const response of pending) response.end('{"complete":true}');
    assert.deepEqual(await Promise.all(active), Array(4).fill({ complete: true }));
  } finally { await server.close(); }
});

test("waiting capacity is bounded and all completed slots become reusable", async () => {
  const pending: ServerResponse[] = []; let fourReady: () => void = () => {};
  const ready = new Promise<void>(resolve => { fourReady = resolve; });
  let held = true;
  const server = await worker(response => {
    if (!held) { response.end('{}'); return; }
    pending.push(response); if (pending.length === 4) fourReady();
  });
  try {
    const client = createCorpusTransport(server.configuration), signal = AbortSignal.timeout(3000);
    const active = Array.from({ length: 4 }, () => client.readExact(request, signal));
    await Promise.race([ready, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
    const queued = Array.from({ length: 32 }, () => client.readExact(request, signal));
    await assert.rejects(client.readExact(request, signal), /CORPUS_TRANSPORT_CAPACITY/);
    held = false; for (const response of pending) response.end('{}');
    await Promise.all([...active, ...queued]);
    assert.deepEqual(await createCorpusTransport(server.configuration).readExact(request, signal), {});
  } finally { await server.close(); }
});

test("only the pinned catalog endpoint can request a smaller page", async () => {
  for (const pinned of [true, false]) {
    const server = await worker(response => {
      if (!pinned) response.setHeader("X-Juro-Worker-Sha256", "b".repeat(64));
      response.statusCode = 413; response.end('{"error":"catalog_page_required"}');
    });
    try {
      await assert.rejects(createCorpusTransport(server.configuration).readExact(request, AbortSignal.timeout(3000)),
        pinned ? /PREPARED_CATALOG_PAGE_REQUIRED/ : /CORPUS_WORKER_IDENTITY/);
    } finally { await server.close(); }
  }
});

test("worker pin, content type and response bounds fail closed", async () => {
  for (const failure of ["pin", "type", "size", "redirect", "json"]) {
    const server = await worker(response => {
      if (failure === "pin") response.setHeader("X-Juro-Worker-Sha256", "b".repeat(64));
      if (failure === "type") response.setHeader("Content-Type", "text/html");
      if (failure === "size") response.setHeader("Content-Length", 64 * 1024 * 1024 + 1);
      if (failure === "redirect") { response.statusCode = 302; response.setHeader("Location", "https://example.invalid/"); }
      response.end(failure === "json" ? '{invalid' : '{}');
    });
    try {
      await assert.rejects(createCorpusTransport(server.configuration).readExact(request, AbortSignal.timeout(3000)), /CORPUS_/);
    } finally { await server.close(); }
  }
});

test("body cancellation releases admission while a stalled worker cannot hold the request", async () => {
  let sent: () => void = () => {}; const headers = new Promise<void>(resolve => { sent = resolve; });
  let calls = 0;
  const server = await worker(response => {
    calls++; response.write('{'); sent();
    if (calls > 1) response.end('}');
  });
  try {
    const client = createCorpusTransport(server.configuration), controller = new AbortController();
    const reading = assert.rejects(client.readExact(request, controller.signal), /fixture cancellation/);
    await headers; controller.abort(new Error("fixture cancellation")); await reading;
    assert.deepEqual(await client.readExact(request, AbortSignal.timeout(3000)), {});
  } finally { await server.close(); }
});

test("transport rejects non-loopback and ambiguous credential destinations before network access", () => {
  for (const url of ["https://example.invalid", "http://127.0.0.1@outside.invalid", "http://127.0.0.1:1234/path", "http://127.0.0.1:1234?token=x"]) {
    assert.throws(() => createCorpusTransport({ url, token, workerSha256: hash }), /CORPUS_TRANSPORT_CONFIGURATION/);
  }
});

test("expired indexed retrieval cannot dispatch even when its caller signal is live", async () => {
  let calls = 0;
  const server = await worker(response => { calls++; response.end('{}'); });
  try {
    const client = createCorpusTransport(server.configuration);
    await assert.rejects(runIndexedRetrieval(undefined, () => client.readExact(request, new AbortController().signal), Date.now() - 1));
    assert.equal(calls, 0);
  } finally { await server.close(); }
});

test("chunked search responses cannot bypass the body limit", async () => {
  const server = await worker(response => {
    response.write(Buffer.alloc(4 * 1024 * 1024, 32)); response.end('{}');
  });
  try {
    const client = createCorpusTransport(server.configuration);
    const search: Parameters<typeof client.execute>[0] = { version: "prepared-search-v1", releaseId: "fixture-release", environment: "staging",
      configuration: preparedCandidateConfigurationSchema.parse({ backend: "prepared-corpus-v1", navigationBackend: "pgvector", identity: "fixture-config",
        embeddingModel: "openai/text-embedding-3-large", dimensions: 3072, artifacts,
        evidenceSemantics: "discovery-only", categoryRanking: { mode: "disabled" },
        gatewayIdentity: "fixture-gateway", providerProjectIdentity: "fixture-project",
        gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false }),
      endpoint: { kind: "current" }, limit: 50, embedding: [0.1], termHashes: [hash], requestSha256: hash };
    await assert.rejects(client.execute(search, AbortSignal.timeout(3000)), /CORPUS_TRANSPORT_BODY_LIMIT/);
  } finally { await server.close(); }
});


test("catalog reads bypass queued long work in bounded bursts without starving that work", async () => {
  const held: ServerResponse[] = [], order: string[] = [];
  let ready: () => void = () => {};
  const occupied = new Promise<void>(resolve => { ready = resolve; });
  const server = await worker((response, path) => {
    if (held.length < 4) { held.push(response); if (held.length === 4) ready(); return; }
    order.push(path); response.end('{}');
  });
  const active: Promise<unknown>[] = [];
  try {
    const first = createCorpusTransport(server.configuration), second = createCorpusTransport(server.configuration);
    const signal = AbortSignal.timeout(3000);
    for (let index = 0; index < 4; index++) active.push(first.readSources({ artifacts, works: [] }, signal));
    await occupied;
    const queued = [first.readSources({ artifacts, works: [] }, signal),
      second.readExact(request, signal), second.readExact(request, signal), second.readExact(request, signal)];
    held[0].end('{}');
    await Promise.all(queued);
    assert.deepEqual(order, ['/read-exact', '/read-exact', '/read-sources', '/read-exact']);
  } finally {
    for (const response of held) if (!response.writableEnded) response.end('{}');
    await Promise.allSettled(active); await server.close();
  }
});
