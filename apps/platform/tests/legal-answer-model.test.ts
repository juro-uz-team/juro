import assert from "node:assert/strict";
import test from "node:test";
import { env } from "cloudflare:workers";
import { createLegalAnswerModel } from "../lib/legal-chat/answer-model";
import type { AnswerQuestion } from "../lib/legal-chat/answer-engine";

test("legal model transport pins each mode and keeps source locators out of provider context", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const payloads: Array<{model:string;input:string;text:{format:{strict:boolean}}}> = [];
  context.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    payloads.push(body);
    return Response.json({ id: "response", model: body.model,
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        mainPoint: { text: "Supported result", sourceIds: ["source"] }, findings: [], actions: [], risks: [], questions: [], unresolved: [],
      }) }] }], usage: { input_tokens: 12, output_tokens: 9 } });
  });
  const observations: unknown[] = [];
  const model = createLegalAnswerModel({ requestId: "request", onAttemptFinished: value => { observations.push(value); } });
  for (const mode of ["fast", "deep"] as const) {
    const question: AnswerQuestion = { question: "Question", locale: "en", mode, answerMode: "detailed",
      temporalScope: { kind: "current" }, unresolved: [], evidence: [{ source: {
        id: "source", actTitle: "Title", actIdentifier: null, officialUrl: "https://lex.uz/docs/123",
        revisionDate: null, lastCheckedAt: "2026-09-14", locale: "en", publishedAt: null,
        sourceType: "lex", status: "current", verificationState: "verified", verifiedAt: "2026-09-14",
        contentSha256: "server-only-parent-fingerprint",
      }, text: "Official provision", textSha256: "server-only-text-fingerprint", endpoint: {kind: "current"}, origin: "indexed" }] };
    await model.write({ question, correction: null });
  }
  assert.deepEqual(payloads.map(body => body.model), ["gpt-5.6-luna", "gpt-5.6-terra"]);
  assert.equal(observations.length, 2);
  for (const body of payloads) {
    assert.equal(body.text.format.strict, true);
    assert.ok(!body.input.includes("fingerprint"));
    assert.ok(!body.input.includes("https://lex.uz"));
    assert.ok(body.input.includes("Official provision"));
  }
});
