import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { handleSignedAnswerHttp } from "../lib/legal-answer-workflow/signed-http";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";

test("signed HTTP delivers only persisted results, replays without generation and rejects cross-origin requests", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    let calls = 0, authentications = 0;
    const configuration: Parameters<typeof handleSignedAnswerHttp>[1] = {
      publicOrigin: "https://juro.example", deadlineMs: 60_000,
      authenticate: async () => { authentications++; return { db: fixture.d1, workspaceId: "w", userId: "u" }; },
      dependencies: async () => ({ deadlineMs: 30_000, model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: "fixture",
        privateObjects: { get: async () => null }, createExecution: async () => ({
          model: legalEntryFixture({ complete: async ({ stage }) => {
            calls++;
            return stage === "interpret" ? { needsClarification: false, complexity: "very_difficult", requirements: [{ id: "r", question: "Artificial rule?" }],
              queries: ["artificial rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] }
              : { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "r", description: "Rule unavailable." }], actions: [] };
          } }),
          corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
            resolve: async () => null, get: async () => null }, citations: async () => [], usage: () => fixture.input.usage,
        }) }),
    };
    const request = (origin = "https://juro.example") => new Request("https://juro.example/api/platform/ai", {
      method: "POST", headers: { origin, "content-type": "application/json", "x-juro-csrf": "1" },
      body: JSON.stringify({ question: "Artificial question", locale: "en", answerMode: "detailed", reasoningMode: "deep",
        operation: "new", idempotencyKey: "http-fixture" }),
    });
    assert.equal((await handleSignedAnswerHttp(request("https://foreign.example"), configuration)).status, 403);
    const crossSite = request();
    crossSite.headers.set("sec-fetch-site", "cross-site");
    assert.equal((await handleSignedAnswerHttp(crossSite, configuration)).status, 403);
    assert.equal(authentications, 0);
    const response = await handleSignedAnswerHttp(request(), configuration);
    assert.match(response.headers.get("content-type")!, /text\/event-stream/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text();
    assert.match(text, /event: progress/);
    assert.match(text, /researching/);
    assert.doesNotMatch(text, /deeper_research/);
    const frame = text.split("\n\n").find(value => value.startsWith("event: result\n"));
    assert.ok(frame);
    const delivery = JSON.parse(frame.split("data: ")[1]);
    const stored = fixture.sqlite.prepare("SELECT structured_json FROM conversation_messages WHERE id=?").get(delivery.messageId);
    assert.ok(stored);
    assert.deepEqual(JSON.parse(String(stored.structured_json)), delivery.result);
    assert.equal(calls, 2);
    const replay = await (await handleSignedAnswerHttp(request(), configuration)).text();
    assert.ok(replay.includes(frame));
    assert.equal(calls, 2);
  } finally { fixture.sqlite.close(); }
});
