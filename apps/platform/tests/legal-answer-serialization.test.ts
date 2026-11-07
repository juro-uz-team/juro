import assert from "node:assert/strict";
import test from "node:test";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";
import type { LegalOutcome, LegalRequest } from "../lib/legal-answer-workflow/contracts";

const request: LegalRequest = { question: "An artificial question", language: "en", format: "detailed", mode: "deep",
  actor: { tenantId: "t", userId: "u" }, submittedAt: 0, deadlineMs: 30_000, history: [], privateDocuments: [] };
const outcome: LegalOutcome = { kind: "answer", evidence: [{ identity: "rule", snapshot: "revision", objectKey: "object",
  sha256: "a".repeat(64), byteCount: 17, sourceUrl: "https://lex.uz/docs/123#456", privacyClass: "public_official_source",
  quarantined: false, canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true,
  text: "Full source text." }], content: {
  summary: "Follow the artificial rule.", summarySourceIds: ["rule"],
  issues: [{ title: "Rule", explanation: "Explanation with qualification.", requirementIds: ["r"], sourceIds: ["rule"],
    actions: [{ title: "First action", description: "Keep a record.", sourceIds: ["rule"] }] },
  { title: "Consequence", explanation: "Consequence.", requirementIds: ["r"], sourceIds: ["rule"],
    actions: [{ title: "Second action", description: "Check the record.", sourceIds: ["rule"] }] }],
  conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
  clarificationQuestions: [], urgency: "normal",
} };

test("serialization preserves issue/action relationships and authenticated citation presentation", () => {
  const result = serializeLegalOutcome(outcome, request, {
    legalDatabaseAsOf: "2026-10-28", sources: [{ sourceId: "rule", actTitle: "Artificial act", actIdentifier: null,
      article: "1", excerpt: "Source excerpt.", originalUrl: "https://lex.uz/docs/123#456", status: "current",
      effectiveDate: null, verifiedAt: "2026-10-28T00:00:00Z" }],
  });
  assert.deepEqual(result.issues, [{ findingIndex: 0, actionIndices: [0] }, { findingIndex: 1, actionIndices: [1] }]);
  assert.equal(result.actionPlan[1].description, "Check the record.");
  assert.equal(result.sources[0].originalUrl, "https://lex.uz/docs/123#456");
  assert.equal(result.summary, "Follow the artificial rule.");
  assert.equal(result.validationMethod, "programmatic");
  assert.ok(!JSON.stringify(result).includes("Full source text."));
});

test("an unavailable result retains its separate localized presentation without an empty answer outline", () => {
  const result = serializeLegalOutcome({ kind: "insufficient_evidence", checkedEvidence: [],
    gaps: [{ requirementId: "r", description: "Не найдено применимое правило." }], clarificationQuestions: ["Какова дата события?"] },
  { ...request, language: "ru" }, { sources: [], legalDatabaseAsOf: "2026-10-28" });
  assert.equal(result.responseKind, "clarification_required");
  assert.match(result.summary, /проверить/);
  assert.deepEqual(result.coverageGaps, ["Не найдено применимое правило."]);
  assert.deepEqual(result.confirmedFindings, []);
  assert.deepEqual(result.actionPlan, []);
  assert.deepEqual(result.clarificationQuestions, ["Какова дата события?"]);
});

test("citation metadata cannot substitute a different source URL for authenticated evidence", () => {
  assert.throws(() => serializeLegalOutcome(outcome, request, { legalDatabaseAsOf: "2026-10-28", sources: [
    { sourceId: "rule", actTitle: "Artificial act", actIdentifier: null, article: "1", excerpt: null,
      originalUrl: "https://lex.uz/docs/999", status: "current", effectiveDate: null, verifiedAt: "2026-10-28T00:00:00Z" },
  ] }), /CITATION_PRESENTATION_MISMATCH/);
});

test("conversational replies retain their plain presentation through serialization", () => {
  const result = serializeLegalOutcome({kind: "conversation", text: "Здравствуйте! Чем могу помочь?", checkedEvidence: [], clarificationQuestions: []},
    {...request, language: "ru"}, {sources: [], legalDatabaseAsOf: "2026-10-28"});
  assert.equal(result.presentationKind, "conversation");
  assert.equal(result.summary, "Здравствуйте! Чем могу помочь?");
  assert.equal(result.responseKind, "answer");
});
