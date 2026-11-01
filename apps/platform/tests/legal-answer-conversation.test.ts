import assert from "node:assert/strict";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { entrySchema, type LegalRequest } from "../lib/legal-answer-workflow/contracts";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";

const request = (question: string, language: LegalRequest["language"] = "en"): LegalRequest => ({
  question, language, format: "short", mode: "fast", submittedAt: Date.now(), deadlineMs: 60_000,
  actor: { tenantId: "tenant", userId: "user" }, history: [], privateDocuments: [],
});
const interpretation = { complexity: "simple" as const, needsClarification: false,
  requirements: [{ id: "rule", question: "Artificial legal rule?" }], queries: ["artificial rule"],
  scopes: [{ kind: "current" as const }], facts: [], clarificationQuestions: [] };

test("the first agent turn handles general conversation before any legal corpus access", async () => {
  for (const language of ["en", "ru", "uz"] as const) {
    for (const question of ["hello", "Thank you, that was helpful", "What can you help me with?", "Tell me a little about yourself", "How are you today?"]) {
      const stages: string[] = [], calls: string[] = [];
      const reply = { en: "Happy to help.", ru: "Рад помочь.", uz: "Yordam berishdan mamnunman." }[language];
      const input = { ...request(question, language), onProgress: (stage: string) => stages.push(stage) };
      const result = await runLegalAnswer(input, {
        model: { complete: async operation => {
          calls.push(operation.stage);
          assert.equal(operation.stage, "interpret");
          assert.equal((operation.input as { question: string }).question, question);
          assert.equal("unreadCandidates" in (operation.input as object), false);
          return { conversationReply: reply, interpretation: null };
        } },
        corpus: { search: async () => assert.fail("Conversation must not search"),
          resolve: async () => assert.fail("Conversation must not read law"), get: async () => assert.fail("No source bytes needed") },
        publication: { publish: async ({ outcome, signal }) => {
          signal.throwIfAborted();
          assert.deepEqual(outcome, { kind: "conversation", text: reply, checkedEvidence: [], clarificationQuestions: [] });
          const saved = serializeLegalOutcome(outcome, input, { sources: [], legalDatabaseAsOf: "2026-01-01" });
          assert.equal(saved.responseKind, "answer");
          assert.equal(saved.summary, reply);
          assert.equal(saved.answer, reply);
          assert.equal(saved.evidenceMode, "none");
          assert.deepEqual(saved.clarificationQuestions, []);
          assert.deepEqual(saved.sources, []);
          return { answerId: "saved-conversation", outcome };
        } },
      });
      assert.equal(result.answerId, "saved-conversation");
      assert.deepEqual(calls, ["interpret"]);
      assert.deepEqual(stages, ["interpreting", "saving"]);
    }
  }
});

test("mixed conversational and legal requests research the interpreted issue before answering", async () => {
  const order: string[] = [];
  const result = await runLegalAnswer(request("Thanks! Can my employer dismiss me?"), {
    model: { complete: async operation => {
      order.push(operation.stage);
      if (operation.stage === "interpret") return { conversationReply: null, interpretation };
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "rule", description: "Missing artificial law." }] };
    } },
    corpus: { search: async query => { order.push("search"); assert.equal(query, "artificial rule");
      return { candidates: [], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => assert.fail("No selected source"), get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.deepEqual(order, ["interpret", "search", "write"]);
});

test("entry decisions cannot combine an ungrounded conversational answer with legal research", () => {
  assert.equal(entrySchema.safeParse({ conversationReply: null, interpretation: null }).success, false);
  assert.equal(entrySchema.safeParse({ conversationReply: "A legal answer", interpretation }).success, false);
  assert.equal(entrySchema.safeParse({ conversationReply: "", interpretation: null }).success, false);
});
