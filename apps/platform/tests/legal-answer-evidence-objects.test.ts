import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createEvidenceObjects } from "../lib/legal-answer-workflow/evidence-objects";
import { indexedRetrievalSignal, indexedRetrievalRemainingMs } from "../lib/runtime/indexed-retrieval";

test("bounded original files can exceed the normalized text limit without raising that text limit", async () => {
  const bytes = Buffer.alloc(9 * 1024 * 1024, 32);
  bytes.write("%PDF-1.7");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const key = `legal-evidence/raw/${digest}`;
  const objects = createEvidenceObjects({ namespace: `legal-prepared-${"a".repeat(64)}`,
    put: async (key, value) => ({ key, size: value.length }),
    get: async key => ({ key, size: bytes.length, bytes: async () => bytes }),
  }, Date.now() + 30_000);
  await objects.put(key, bytes, AbortSignal.timeout(3000));
  assert.deepEqual(await objects.get(key), bytes);
  await assert.rejects(() => objects.put(`legal-evidence/normalized/${digest}.json`, bytes, AbortSignal.timeout(3000)), /EVIDENCE_OBJECT_IDENTITY/);
});

test("fresh evidence storage binds content-addressed bytes and forwards deadline/cancellation into retained SQL infrastructure", async () => {
  const bytes = Buffer.from("Artificial official bytes");
  const key = `legal-evidence/raw/${createHash("sha256").update(bytes).digest("hex")}`;
  let retained: Uint8Array | null = null, calls = 0;
  const objects = createEvidenceObjects({ namespace: `legal-prepared-${"a".repeat(64)}`,
    put: async (objectKey, value) => {
      calls++; assert.equal(objectKey, key); assert.ok(indexedRetrievalSignal());
      assert.ok(indexedRetrievalRemainingMs() <= 30_000);
      retained = value.slice(); return { key, size: value.byteLength };
    },
    get: async () => {
      calls++; assert.ok(indexedRetrievalSignal());
      const value = retained;
      return value ? { key, size: value.byteLength, bytes: async () => value.slice() } : null;
    },
  }, Date.now() + 30_000);
  const controller = new AbortController();
  await objects.put(key, bytes, controller.signal);
  assert.deepEqual(await objects.get(key, controller.signal), bytes);
  await assert.rejects(() => objects.put(key, Buffer.from("Different bytes"), controller.signal), /EVIDENCE_OBJECT_IDENTITY/);
  assert.equal(calls, 2);
  retained = Buffer.from("Changed stored bytes");
  await assert.rejects(() => objects.get(key, controller.signal), /EVIDENCE_OBJECT_IDENTITY/);
  controller.abort(new Error("request cancelled"));
  await assert.rejects(() => objects.get(key, controller.signal), /request cancelled/);
  assert.equal(calls, 3);
});

test("evidence storage expires while an uncooperative read is pending and cannot renew its budget", async () => {
  const key = `legal-evidence/raw/${"b".repeat(64)}`;
  let calls = 0;
  const objects = createEvidenceObjects({ namespace: `legal-prepared-${"a".repeat(64)}`,
    get: async () => { calls++; return new Promise<never>(() => {}); },
    put: async () => { throw new Error("unexpected write"); },
  }, Date.now() + 40);
  await assert.rejects(() => objects.get(key), /deadline exceeded/);
  await assert.rejects(() => objects.get(key), /deadline exceeded/);
  assert.equal(calls, 1);
});

test("an observed retrieval timeout remains terminal even before the local clock reaches its boundary", async () => {
  let calls = 0;
  const timeout = new DOMException("Indexed retrieval deadline exceeded", "TimeoutError");
  const objects = createEvidenceObjects({ namespace: `legal-prepared-${"a".repeat(64)}`,
    get: async () => { calls++; throw timeout; },
    put: async () => { throw new Error("unexpected write"); },
  }, Date.now() + 30_000);
  const key = `legal-evidence/raw/${"b".repeat(64)}`;
  await assert.rejects(() => objects.get(key), error => error === timeout);
  await assert.rejects(() => objects.get(key), error => error === timeout);
  assert.equal(calls, 1);
});
