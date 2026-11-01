import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";

test("oversized retained evidence stops explicitly without dropping any complete read", async () => {
  for (const repeatOversized of [false, true]) {
    let calls = 0, reads = 0;
    const text = Buffer.from("Artificial complete rule including its exception.");
    const result = await runLegalAnswer({ question: "Which artificial rule?", language: "en", format: "short", mode: "fast",
      submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [] }, {
      model: legalEntryFixture({ complete: async ({ stage, input }) => {
        if (stage === "interpret") return { complexity: "simple", needsClarification: false,
          requirements: [{ id: "r", question: "Rule?" }], queries: ["rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
        calls++;
        const context = input as { evidence: { identity: string; text: string }[]; availableEvidence: { identity: string }[];
          unreadCandidates: { id: string }[]; researchFailures: { code: string }[] };
        if (calls === 1) return { decision: "research", content: null, gaps: [],
          actions: context.unreadCandidates.map(item => ({ requirementId: "r", candidateId: item.id })) };
        if (context.evidence.length === 2) throw new Error("PROVIDER_INPUT_LIMIT");
        if (calls === 3) {
          assert.deepEqual(context.evidence, []);
          assert.deepEqual(context.availableEvidence.map(item => item.identity).sort(), ["long", "rule"]);
          assert.ok(context.researchFailures.some(item => item.code === "EVIDENCE_CONTEXT_LIMIT"));
          return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r",
            selectSourceIds: repeatOversized ? ["long", "rule"] : ["rule"] }] };
        }
        assert.equal(context.evidence[0].text, text.toString());
        return { decision: "answer", gaps: [], actions: [], content: {
          summary: "Complete rule and exception.", summarySourceIds: ["rule"], issues: [{ title: "Rule", explanation: "Complete rule and exception.",
            requirementIds: ["r"], sourceIds: ["rule"], actions: [] }], conditionalBranches: [], assumptions: [], risks: [],
          deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" } };
      } }),
      corpus: { search: async () => ({ candidates: ["long", "rule"], sparseAvailable: true, denseAvailable: true }),
        resolve: async identity => { reads++; return { identity, snapshot: "fixture", objectKey: identity,
          sha256: createHash("sha256").update(text).digest("hex"), byteCount: text.length,
          sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
          canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }; }, get: async () => text },
      publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
    });
    assert.equal(result.outcome.kind, "insufficient_evidence");
    assert.equal(calls, 2);
    assert.equal(reads, 2);
    if (result.outcome.kind === "insufficient_evidence") assert.deepEqual(result.outcome.checkedEvidence.map(item => item.identity), ["long", "rule"]);
  }
});

test("retained results beyond earlier read limits remain available for relevance selection", async () => {
  const searched: string[] = [];
  let assessments = 0;
  const bytes = (identity: string) => Buffer.from(`Artificial complete rule and exception for ${identity}.`);
  const result = await runLegalAnswer({ question: "Which artificial rule governs?", language: "en",
    format: "detailed", mode: "fast", submittedAt: Date.now(), deadlineMs: 30_000,
    actor: { tenantId: "tenant", userId: "user" }, history: [], privateDocuments: [] }, {
    model: legalEntryFixture({ complete: async ({ stage, input }) => {
      if (stage === "interpret") return { needsClarification: false, complexity: "difficult",
        requirements: [{ id: "r", question: "Governing rule and exception?" }],
        queries: ["first", "second", "third", "deferred"], scopes: [{ kind: "current" }],
        facts: [], clarificationQuestions: [] };
      if (stage === "write") {
        assessments++;
        const context = input as { evidence: { identity: string }[];
          candidateQueries: Record<string, string>;
          unreadCandidates: { id: string; matches: { queries: string[] }[] }[]; researchFailures: { candidate: string; code: string }[] };
        if (assessments === 1) {
          assert.deepEqual(searched, ["first", "second", "third", "deferred"]);
          assert.equal(context.evidence.length, 0);
          assert.equal(context.unreadCandidates.length, 37);
          assert.deepEqual(context.researchFailures, []);
          const selected = context.unreadCandidates.find(item => item.matches.some(match =>
            match.queries.some(query => context.candidateQueries[query] === "deferred")))!;
          return { decision: "research", content: null, gaps: [{ requirementId: "r", description: "Read the relevant rule." }],
            actions: [{ requirementId: "r", candidateId: selected.id }] };
        }
        assert.ok(context.evidence.some(item => item.identity === "deferred-0"));
      }
      return { decision: "answer", gaps: [], actions: [], content: { summary: "Artificial complete rule and exception.", summarySourceIds: ["deferred-0"],
        issues: [{ title: "Rule", explanation: "Artificial complete rule and exception.", requirementIds: ["r"], sourceIds: ["deferred-0"], actions: [] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
        clarificationQuestions: [], urgency: "normal" } };
    } }),
    corpus: { search: async query => {
      searched.push(query);
      return { candidates: Array.from({ length: query === "deferred" ? 1 : 12 }, (_, index) => `${query}-${index}`),
        sparseAvailable: true, denseAvailable: true };
    }, resolve: async identity => ({ identity, snapshot: "artificial", objectKey: identity,
      sha256: createHash("sha256").update(bytes(identity)).digest("hex"), byteCount: bytes(identity).length,
      sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
      canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }),
    get: async identity => bytes(identity) },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(assessments, 2);
  assert.deepEqual(searched, ["first", "second", "third", "deferred"]);
});
