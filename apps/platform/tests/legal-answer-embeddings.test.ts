import assert from "node:assert/strict";
import test from "node:test";
import { createQueryEmbeddings, type EmbeddingReceipt } from "../lib/legal-answer-workflow/embeddings";

function setup(fetchImpl: typeof fetch, dimensions: 1536 | 3072 = 3072) {
  const categories: string[] = [], charges: (number | null)[] = [], receipts: EmbeddingReceipt[] = [];
  const embeddings = createQueryEmbeddings({ apiKey: "fixture", dimensions, inputRate: 130_000,
    phase: "final", deadlineAt: Date.now() + 30_000, fetchImpl,
    ledger: { reserve: input => { categories.push(input.category); return "fixture"; }, dispatch: () => {},
      settle: (_id, charge) => { charges.push(charge); }, cancel: () => {} }, receipt: async record => { receipts.push(record); },
  });
  return { embeddings, categories, charges, receipts };
}
const payload = (dimensions: number) => ({ model: "text-embedding-3-large", object: "list",
  usage: { prompt_tokens: 10, total_tokens: 10 },
  data: [{ object: "embedding", index: 0, embedding: Array.from({ length: dimensions }, () => 0.01) }] });

test("embedding rejection preserves status and safe metadata without inventing charge details", async () => {
  const fixture = setup(async () => Response.json({ error: { type: "invalid_request_error", code: "invalid_value",
    param: "dimensions", message: "Private input" } }, { status: 400 }));
  await assert.rejects(() => fixture.embeddings.embed("Artificial query", new AbortController().signal), /EMBEDDING_HTTP_FAILED/);
  assert.equal(fixture.receipts.find(item => item.event === "received")?.httpStatus, 400);
  assert.deepEqual(fixture.receipts.find(item => item.event === "failed")?.providerError,
    { type: "invalid_request_error", code: "invalid_value", param: "dimensions" });
  assert.doesNotMatch(JSON.stringify(fixture.receipts), /Private input/);
  assert.deepEqual(fixture.charges, [null]);
});

test("retained-index embeddings use exact dimensions, separate spending, and request-local read reuse", async () => {
  let calls = 0;
  const fixture = setup(async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "text-embedding-3-large");
    assert.equal(body.dimensions, 3072);
    assert.equal(body.input, "Artificial rule query");
    return Response.json(payload(3072));
  });
  const signal = new AbortController().signal;
  const [first, second] = await Promise.all([
    fixture.embeddings.embed("Artificial rule query", signal), fixture.embeddings.embed("Artificial rule query", signal),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.length, 3072);
  assert.notEqual(first, second);
  assert.deepEqual(fixture.categories, ["embedding"]);
  assert.deepEqual(fixture.charges, [2]);
});

test("wrong dimensions are billed but cannot enter the retained vector index", async () => {
  const fixture = setup(async () => Response.json(payload(3072)), 1536);
  await assert.rejects(() => fixture.embeddings.embed("Artificial query", new AbortController().signal), /EMBEDDING_VECTOR_INVALID/);
  assert.deepEqual(fixture.charges, [2]);
});

test("lost embedding responses retain unknown charges and block further dispatch", async () => {
  let calls = 0;
  const fixture = setup(async () => { calls++; throw new Error("Network detail"); });
  await assert.rejects(() => fixture.embeddings.embed("First query", new AbortController().signal), /EMBEDDING_TRANSPORT_FAILED/);
  await assert.rejects(() => fixture.embeddings.embed("Second query", new AbortController().signal), /EMBEDDING_SESSION_BLOCKED/);
  assert.equal(calls, 1);
  assert.deepEqual(fixture.charges, [null]);
});

test("draining cancelled embeddings waits for reservation settlement", async () => {
  let release!: () => void;
  const settlement = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const controller = new AbortController();
  const embeddings = createQueryEmbeddings({ apiKey: "fixture", dimensions: 3072, inputRate: 130_000,
    phase: "final", deadlineAt: Date.now() + 30_000,
    fetchImpl: async () => new Promise<Response>(() => {}),
    ledger: { reserve: () => "reservation", dispatch: () => {}, cancel: () => {},
      settle: async () => { await settlement; settled = true; } }, receipt: async () => {},
  });
  const result = assert.rejects(() => embeddings.embed("Query", controller.signal));
  await new Promise<void>(resolve => setImmediate(resolve));
  controller.abort();
  await result;
  let drained = false;
  const drain = embeddings.drain().then(() => { drained = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(drained, false);
  release();
  await drain;
  assert.equal(settled, true);
});

test("every concurrent lost embedding response retains its own unknown reservation", async () => {
  const failures: ((error: Error) => void)[] = [], settled: string[] = [];
  let reservations = 0;
  const embeddings = createQueryEmbeddings({ apiKey: "fixture", dimensions: 3072, inputRate: 130_000,
    phase: "final", deadlineAt: Date.now() + 30_000,
    fetchImpl: () => new Promise<Response>((_resolve, reject) => failures.push(reject)),
    ledger: { reserve: () => `reservation-${++reservations}`, dispatch: () => {}, cancel: () => {},
      settle: (id, charge) => { assert.equal(charge, null); settled.push(id); } }, receipt: async () => {},
  });
  const signal = new AbortController().signal;
  const first = assert.rejects(() => embeddings.embed("First query", signal), /EMBEDDING_TRANSPORT_FAILED/);
  const second = assert.rejects(() => embeddings.embed("Second query", signal), /EMBEDDING_TRANSPORT_FAILED/);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(failures.length, 2);
  failures[0](new Error("Lost first response"));
  await first;
  failures[1](new Error("Lost second response"));
  await second;
  assert.deepEqual(settled, ["reservation-1", "reservation-2"]);
  await assert.rejects(() => embeddings.embed("Third query", signal), /EMBEDDING_SESSION_BLOCKED/);
  assert.equal(reservations, 2);
});
