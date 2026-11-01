import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";
import type { LegalRequest } from "../lib/legal-answer-workflow/contracts";

test("facts-only clarification publishes focused questions without claiming a failed legal search", async () => {
  for (const language of ["en", "ru", "uz"] as const) {
    const request: LegalRequest = { question: "Help with my situation", language, format: "short", mode: "fast",
      actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000 };
    let calls = 0;
    const result = await runLegalAnswer(request, {
      model: legalEntryFixture({ complete: async ({ stage }) => {
        calls++; assert.equal(stage, "interpret");
        return { complexity: "simple", needsClarification: true,
          requirements: [{ id: "r", question: "What situation needs legal advice?" }], queries: ["case topic"],
          scopes: [{ kind: "current" }], facts: [], clarificationQuestions: ["What happened, and what outcome do you want?"] };
      } }),
      corpus: { search: async () => { throw new Error("Unexpected legal research"); },
        resolve: async () => { throw new Error("Unexpected evidence read"); }, get: async () => null },
      publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
    });
    assert.equal(result.outcome.kind, "clarification_required");
    assert.equal(calls, 1);
    const response = serializeLegalOutcome(result.outcome, request, { sources: [], legalDatabaseAsOf: "2026-10-29" });
    assert.equal(response.responseKind, "clarification_required");
    assert.deepEqual(response.clarificationQuestions, ["What happened, and what outcome do you want?"]);
    assert.deepEqual(response.coverageGaps, []);
    assert.equal(response.failureReason, undefined);
    assert.doesNotMatch(response.summary, /could not be verified|проверить применимое право|huquqni yetarlicha/);
  }
});

test("material factual questions do not skip research when conditional legal guidance remains possible", async () => {
  let searches = 0;
  const result = await runLegalAnswer({ question: "Artificial notice rule with an unknown date", language: "en",
    format: "short", mode: "fast", actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [],
    submittedAt: Date.now(), deadlineMs: 30_000 }, {
    model: legalEntryFixture({ complete: async ({ stage }) => stage === "interpret"
      ? { complexity: "difficult", needsClarification: false, requirements: [{ id: "r", question: "Notice rule?" }],
        queries: ["notice rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: ["When was the notice received?"] }
      : { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Official rule unavailable" }] } }),
    corpus: { search: async () => { searches++; return { candidates: [], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(searches, 1);
  assert.equal(result.outcome.kind, "insufficient_evidence");
});
