import { legalEntryFixture } from "./helpers/legal-entry-agent";
import { runCompleteReadFixture } from "./helpers/complete-read-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { z } from "zod";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";
import type { LegalRequest } from "../lib/legal-answer-workflow/contracts";
import { createEvidenceCompactor } from "../lib/legal-answer-workflow/model-identities";
import { ProviderResearchSession } from "../lib/legal-answer-workflow/provider-research-session";

test("facts-only clarification publishes focused questions without claiming a failed legal search", async () => {
  for (const language of ["en", "ru", "uz"] as const) {
    const request: LegalRequest = { question: "Help with my situation", language, format: "short", mode: "fast",
      actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000 };
    let calls = 0;
    const result = await runLegalAnswer(request, {
      model: legalEntryFixture({ complete: async ({ stage }) => {
        calls++; assert.equal(stage, "interpret");
        return { complexity: "simple", needsClarification: true,
          requirements: [{ id: "r", question: "What situation needs legal advice?" }], queries: [],
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
    assert.equal(response.presentationKind, "factual_clarification");
    assert.deepEqual(response.clarificationQuestions, ["What happened, and what outcome do you want?"]);
    assert.deepEqual(response.coverageGaps, []);
    assert.equal(response.failureReason, undefined);
    assert.doesNotMatch(response.summary, /could not be verified|проверить применимое право|huquqni yetarlicha/);
  }
});

test("a searchable question gets cited guidance alongside missing facts and an independent evidence gap", async () => {
  const request: LegalRequest = { question: "I received a notice. What can I do?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000 };
  const questions = ["Which body sent the notice?"];
  const gaps = [{ requirementId: "appeal", description: "The appeal procedure for this notice still needs to be established." }];
  const rule = "The recipient may request a copy of the notice.";
  const url = "https://lex.uz/docs/123";
  const result = await runCompleteReadFixture(request, {
    model: { complete: async ({ stage }) => stage === "interpret" ? {
      complexity: "difficult", needsClarification: true,
      requirements: [{ id: "notice", question: "Access to the notice" }, { id: "appeal", question: "Appeal procedure" }],
      queries: ["notice recipient access"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: questions,
    } : { decision: "answer", actions: [], gaps, content: {
      summary: rule, summarySourceIds: ["rule"], issues: [{ title: "Get a copy", explanation: rule,
        requirementIds: ["notice"], sourceIds: ["rule"], actions: [{ title: "Request a copy", description: rule, sourceIds: ["rule"] }] }],
      conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
      referenceNotes: [], clarificationQuestions: questions, urgency: "normal",
    } } },
    corpus: { search: async () => ({ candidates: ["rule", "other"], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => ({ identity, snapshot: "revision", objectKey: identity, byteCount: Buffer.byteLength(rule),
        sha256: createHash("sha256").update(rule).digest("hex"), sourceUrl: identity === "rule" ? url : "https://lex.uz/docs/456", privacyClass: "public_official_source",
        quarantined: false, canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" }),
      get: async () => Buffer.from(rule) },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(result.outcome.evidence.map(item => item.identity), ["rule"]);
  const answer = serializeLegalOutcome(result.outcome, request, { legalDatabaseAsOf: "2026-10-29", sources: [{ sourceId: "rule",
    actTitle: "Notice rules", actIdentifier: null, article: "1", excerpt: rule, originalUrl: url,
    status: "current", verifiedAt: "2026-10-29", effectiveDate: null }] });
  assert.equal(answer.summary, rule);
  assert.deepEqual(answer.clarificationQuestions, questions);
  assert.deepEqual(answer.coverageGaps, gaps.map(gap => gap.description));
  assert.deepEqual(answer.confirmedFindings[0].sourceIds, [answer.sources[0].sourceId]);
  assert.equal(answer.actionPlan.length, 1);
});

test("a source miss publishes the factual questions identified after searching", async () => {
  let searches = 0;
  const result = await runLegalAnswer({ question: "Artificial notice rule with an unknown date", language: "en",
    format: "short", mode: "fast", actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [],
    submittedAt: Date.now(), deadlineMs: 30_000 }, {
    model: legalEntryFixture({ complete: async ({ stage }) => stage === "interpret"
      ? { complexity: "difficult", needsClarification: false, requirements: [{ id: "r", question: "Notice rule?" }],
        queries: ["notice rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] }
      : { decision: "clarification_required", content: null, actions: [], gaps: [],
        clarificationQuestions: ["What agency sent the notice, and what is its title?"] } }),
    corpus: { search: async () => { searches++; return { candidates: [], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(searches, 1);
  assert.deepEqual(result.outcome, { kind: "clarification_required", checkedEvidence: [],
    clarificationQuestions: ["What agency sent the notice, and what is its title?"] });
});

test("source-miss clarification survives the native provider format without opening legal writing", async () => {
  const compacted = createEvidenceCompactor()({ stage: "write", schema: {}, instruction: "Ask a factual question.",
    input: { researchAgent: true, language: "ru", question: "Мне прислали уведомление. Что делать?",
      evidence: [], canResearch: false, interpretation: { requirements: [{ id: "r" }] } },
    signal: new AbortController().signal });
  const prepared = new ProviderResearchSession().prepare(compacted.operation, "{}");
  const turn = { decision: "clarification_required", content: null, actions: [], gaps: [],
    clarificationQuestions: ["Кто прислал уведомление и как оно называется?"] };
  const wire = z.fromJSONSchema(prepared.schema);
  assert.equal(wire.safeParse({ turn }).success, true);
  assert.equal(wire.safeParse({ turn: { ...turn, clarificationQuestions: [] } }).success, false);
  assert.deepEqual(compacted.restore(await prepared.restore({ turn })), turn);
});
