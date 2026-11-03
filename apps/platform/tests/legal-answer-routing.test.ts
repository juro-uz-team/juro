import assert from "node:assert/strict";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";

for (const contextual of [false, true]) test(`direct replies do not access the corpus (${contextual})`, async () => {
  const result = await runLegalAnswer({ question: "Explain how to ask a clear question", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, submittedAt: Date.now(), deadlineMs: 30_000,
    history: contextual ? [{ role: "user", content: "Help me write clearly." }] : [], privateDocuments: [] }, {
    corpus: { entryNavigation: true, prefetchInitialSearch: true, questionFirstResearch: true,
      search: async () => assert.fail("Direct replies must not start retrieval"),
      describeCandidates: async () => assert.fail("Direct replies must not read navigation"),
      resolve: async () => assert.fail("Direct replies must not read law"), get: async () => null },
    model: { complete: async ({ stage }) => { assert.equal(stage, "interpret"); return { conversationReply: "State what you want to know and add relevant context.", interpretation: null }; } },
    publication: { publish: async ({ outcome }) => ({ answerId: "direct", outcome }) },
  });
  assert.equal(result.outcome.kind, "conversation");
});
