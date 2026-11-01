import assert from "node:assert/strict";
import test from "node:test";
import { readProviderError } from "../lib/legal-answer-workflow/provider-http";

test("provider diagnostics retain known labels and redact arbitrary values in every field", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await readProviderError(Response.json({ error: {
    type: "rate_limit_error", code: "insufficient_quota", param: null, message: "Private input",
  } }), signal), { type: "rate_limit_error", code: "insufficient_quota", param: null });
  for (const value of ["Private input", { secret: "Private input" }, ["Private input"], 123]) {
    assert.deepEqual(await readProviderError(Response.json({ error: { type: value, code: value, param: value } }), signal),
      { type: "unrecognized", code: "unrecognized", param: "unrecognized" });
  }
});

test("malformed, oversized, empty and cancelled error bodies yield no private diagnostics", async () => {
  const empty = { type: null, code: null, param: null };
  for (const response of [new Response("Invalid JSON"), new Response("x".repeat(16_385)),
    new Response(null), Response.json(null), Response.json({ error: "Private input" })]) {
    assert.deepEqual(await readProviderError(response, new AbortController().signal), empty);
  }
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await readProviderError(new Response(new ReadableStream({ start() {} })), controller.signal), empty);
});
