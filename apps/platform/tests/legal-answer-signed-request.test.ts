import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { executeSignedInAnswer } from "../lib/legal-answer-workflow/signed-request";
import type { LegalRequest } from "../lib/legal-answer-workflow/contracts";

test("the signed-in runner executes the fresh graph, persists delivery, and replays without another model call", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    let calls = 0;
    const histories: LegalRequest["history"][] = [];
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", question: "Artificial permit question",
      language: "en" as const, format: "detailed" as const, mode: "deep" as const,
      conversationId: null, idempotencyKey: "runner", documentIds: [],
      submittedAt: Date.now(), deadlineMs: 30_000, signal: new AbortController().signal };
    const dependencies = {
      model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: "fixture",
      privateObjects: { get: async () => null },
      createExecution: async ({ request }: {request: LegalRequest}) => {
        histories.push(request.history);
        return {
        model: legalEntryFixture({ complete: async ({ stage }: {stage: string}) => {
          calls++;
          return stage === "interpret" ? { needsClarification: false, complexity: "difficult",
            requirements: [{ id: "rule", question: "Which rule applies?" }], queries: ["artificial rule"],
            scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [],
          } : { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "rule", description: "Rule not found." }], actions: [] };
        } }),
        corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
          resolve: async () => null, get: async () => null },
        citations: async () => [],
        usage: () => fixture.input.usage,
        };
      },
    };
    const delivered = await executeSignedInAnswer(input, dependencies);
    assert.equal(delivered.kind, "completed");
    if (delivered.kind !== "completed") throw new Error("Expected delivery");
    assert.equal(calls, 2);
    const replay = await executeSignedInAnswer(input, dependencies);
    assert.deepEqual(replay, delivered);
    assert.equal(calls, 2);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM conversation_messages").get()?.count, 2);
    const follow = await executeSignedInAnswer({ ...input, question: "Follow-up question", idempotencyKey: "runner-follow",
      conversationId: delivered.conversationId, submittedAt: Date.now(),
      branch: { operation: "follow_up", responseMessageId: delivered.responseMessageId } }, dependencies);
    assert.equal(follow.kind, "completed");
    assert.equal(histories.length, 2);
    assert.deepEqual(histories[0], []);
    assert.deepEqual(histories[1], [{ role: "user", content: input.question },
      { role: "assistant", content: JSON.stringify(delivered.response) }]);
    await assert.rejects(() => executeSignedInAnswer({ ...input, idempotencyKey: "runner-private",
      submittedAt: Date.now(), documentIds: ["unavailable-document"] }, dependencies), /PRIVATE_DOCUMENT_UNAVAILABLE/);
    assert.equal(calls, 4);
    for (const [message, expected] of [["PROVIDER_USAGE_UNRECONCILED", "PROVIDER_USAGE_UNRECONCILED"],
      ["PROVIDER_SPENDING_CAP", "PROVIDER_SPENDING_CAP"], ["transport artificial-secret", "LEGAL_ANSWER_FAILED"]]) {
      const idempotencyKey = `failure-${expected}`;
      await assert.rejects(() => executeSignedInAnswer({ ...input, idempotencyKey, submittedAt: Date.now() },
        { ...dependencies, createExecution: async () => { throw new Error(message); } }));
      const run = fixture.sqlite.prepare("SELECT status,error_code FROM ai_runs WHERE idempotency_key=?").get(idempotencyKey);
      assert.equal(run?.status, "failed");
      assert.equal(run?.error_code, expected);
    }
  } finally { fixture.sqlite.close(); }
});
