import assert from "node:assert/strict";
import test from "node:test";
import { executeSignedInAnswer } from "../lib/legal-answer-workflow/signed-request";
import { legalChatResponseSchema } from "../lib/ai/legal-chat-schema";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";

test("signed factual clarification persists questions and accounts once across saved replay", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    let calls = 0;
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", question: "I need help with a legal matter.",
      language: "en" as const, format: "short" as const, mode: "fast" as const,
      conversationId: null, idempotencyKey: "factual-clarification", documentIds: [],
      submittedAt: Date.now(), deadlineMs: 30_000, signal: new AbortController().signal };
    const questions = ["Which decision or dispute do you need help with?"];
    const dependencies = { model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: "fixture",
      privateObjects: { get: async () => null }, createExecution: async () => ({
        model: { complete: async ({ stage }: { stage: string }) => {
          assert.equal(stage, "interpret"); calls++;
          return { conversationReply: null, interpretation: { needsClarification: true, complexity: "simple", requirements: [{ id: "r", question: "Identify the legal matter" }],
            queries: ["artificial rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: questions } };
        } },
        corpus: { search: async () => { throw new Error("Clarification must not research an unidentified matter"); },
          resolve: async () => null, get: async () => null },
        citations: async () => [], usage: () => ({ ...fixture.input.usage, providerResponseId: "fixture-response",
          inputTokens: 123, outputTokens: 45, attempts: 1 }),
      }) };
    const delivered = await executeSignedInAnswer(input, dependencies);
    assert.equal(delivered.kind, "completed");
    if (delivered.kind !== "completed") throw new Error("Expected saved clarification");
    const response = legalChatResponseSchema.parse(delivered.response);
    assert.equal(response.responseKind, "clarification_required");
    assert.deepEqual(response.clarificationQuestions, questions);
    const saved = fixture.sqlite.prepare("SELECT structured_json FROM conversation_messages WHERE id=?").get(delivered.responseMessageId);
    assert.deepEqual(JSON.parse(String(saved?.structured_json)).clarificationQuestions, questions);
    const accounting = () => fixture.sqlite.prepare("SELECT status,units,input_tokens,output_tokens FROM ai_usage_ledger WHERE ai_run_id=?")
      .all(delivered.runId).map(row => ({ ...row }));
    const expected = [{ status: "released", units: 1, input_tokens: 123, output_tokens: 45 }];
    assert.deepEqual(accounting(), expected);
    const beforeRuns = fixture.sqlite.prepare("SELECT count(*) AS n FROM ai_runs").get()?.n;
    const replay = await executeSignedInAnswer({ ...input, submittedAt: Date.now() }, dependencies);
    assert.deepEqual(replay, delivered);
    assert.equal(calls, 1);
    assert.deepEqual(accounting(), expected);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM ai_runs").get()?.n, beforeRuns);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 2);
  } finally { fixture.sqlite.close(); }
});

test("a conversational answer persists as normal text and replays without another model or corpus call", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    let calls = 0;
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", question: "Thanks for your help!",
      language: "en" as const, format: "short" as const, mode: "fast" as const,
      conversationId: null, idempotencyKey: "conversation-reply", documentIds: [],
      submittedAt: Date.now(), deadlineMs: 30_000, signal: new AbortController().signal };
    const dependencies = { model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: "fixture",
      privateObjects: { get: async () => null }, createExecution: async () => ({
        model: { complete: async () => { calls++; return { conversationReply: "You're welcome!", interpretation: null }; } },
        corpus: { search: async () => assert.fail("Conversation must not access the corpus"),
          resolve: async () => assert.fail("Conversation must not read sources"), get: async () => null },
        citations: async () => [], usage: () => ({ ...fixture.input.usage, providerResponseId: "fixture-response",
          inputTokens: 100, outputTokens: 10, attempts: 1 }),
      }) };
    const delivered = await executeSignedInAnswer(input, dependencies);
    assert.equal(delivered.kind, "completed");
    if (delivered.kind !== "completed") throw new Error("Expected saved conversation");
    const response = legalChatResponseSchema.parse(delivered.response);
    assert.equal(response.responseKind, "answer");
    assert.equal(response.summary, "You're welcome!");
    assert.equal(response.answer, "You're welcome!");
    assert.deepEqual(response.sources, []);
    assert.deepEqual(response.clarificationQuestions, []);
    const saved = fixture.sqlite.prepare("SELECT structured_json FROM conversation_messages WHERE id=?").get(delivered.responseMessageId);
    assert.deepEqual(JSON.parse(String(saved?.structured_json)), response);
    assert.deepEqual(await executeSignedInAnswer({ ...input, submittedAt: Date.now() }, dependencies), delivered);
    assert.equal(calls, 1);
  } finally { fixture.sqlite.close(); }
});
