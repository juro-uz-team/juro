import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOfficialCaptures } from "../lib/legal-answer-workflow/official-capture";

test("publisher capture retains exact bytes and acquisition identity while reusing a request-local read", async () => {
  const bytes = Buffer.from("<html><body>Artificial rule and its exception.</body></html>");
  let calls = 0;
  const reader = createOfficialCaptures({ signal: AbortSignal.timeout(3000), fetchImpl: async (url, init) => {
    calls++;
    assert.equal(String(url), "https://lex.uz/docs/123?ONDATE=01.01.2020");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    return new Response(bytes, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } });
  const first = await reader.read("https://lex.uz/docs/123?ONDATE=01.01.2020#article");
  assert.equal(first.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(first.byteCount, bytes.length);
  assert.equal(first.finalUrl, first.requestedUrl);
  first.bytes[0] = 0;
  const second = await reader.read("https://lex.uz/docs/123?ONDATE=01.01.2020");
  assert.equal(second.bytes[0], bytes[0]);
  assert.equal(calls, 1);
});

test("untrusted and redirected publisher URLs never send a request outside the official host", async () => {
  const visited: string[] = [];
  const reader = createOfficialCaptures({ signal: AbortSignal.timeout(3000), fetchImpl: async url => {
    visited.push(String(url));
    return new Response(null, { status: 302, headers: { Location: "https://private.example/secret" } });
  } });
  for (const url of ["http://lex.uz/docs/123", "https://lex.uz.evil.test/docs/123", "https://x@lex.uz/docs/123", "https://127.0.0.1/"]) {
    await assert.rejects(() => reader.read(url), /PUBLISHER_URL/);
  }
  await assert.rejects(() => reader.read("https://lex.uz/docs/123"), /PUBLISHER_URL/);
  assert.deepEqual(visited, ["https://lex.uz/docs/123"]);
});

test("capture bounds streamed bodies and cancels oversized source responses", async () => {
  let cancelled = false;
  const reader = createOfficialCaptures({ signal: AbortSignal.timeout(3000), fetchImpl: async () => new Response(
    new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }),
    { headers: { "Content-Type": "application/pdf" } }) });
  await assert.rejects(() => reader.read("https://lex.uz/files/attachment.pdf"), /PUBLISHER_BODY_LIMIT/);
  assert.equal(cancelled, true);
});

test("caller cancellation prevents capture dispatch and stops noncooperative body reads", async () => {
  const controller = new AbortController();
  const reader = createOfficialCaptures({ signal: controller.signal, fetchImpl: async () => new Response(
    new ReadableStream({ start() { controller.abort(new Error("fixture cancellation")); } }),
    { headers: { "Content-Type": "text/html" } }) });
  await assert.rejects(() => reader.read("https://lex.uz/docs/123"), /fixture cancellation/);
  let called = false;
  const stopped = createOfficialCaptures({ signal: controller.signal, fetchImpl: async () => { called = true; throw Error("unexpected"); } });
  await assert.rejects(() => stopped.read("https://lex.uz/docs/123"), /fixture cancellation/);
  assert.equal(called, false);
});
