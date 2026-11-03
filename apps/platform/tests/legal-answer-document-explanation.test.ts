import assert from "node:assert/strict";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";
import type { LegalRequest } from "../lib/legal-answer-workflow/contracts";

const title = "Об утверждении перечня иностранных государств, граждане которых имеют право на приобретение новых объектов недвижимого имущества, строящихся в Республике Узбекистан";
const request: LegalRequest = { question: `${title} ; о чем говорится тут?`, language: "ru", format: "short", mode: "fast",
  actor: { tenantId: "t", userId: "u" }, submittedAt: Date.now(), deadlineMs: 30_000, history: [], privateDocuments: [] };

test("a named act is searched verbatim and read before explaining its contents", async () => {
  const searches: string[] = [], reads: string[] = [];
  const text = "Synthetic complete act for testing document explanation, not real law.";
  const result = await runLegalAnswer({ ...request, submittedAt: Date.now() }, {
    corpus: { entryNavigation: true,
      search: async query => { searches.push(query); return { candidates: query === title ? ["act"] : [], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, title, sourceUrl: "https://lex.uz/docs/123", text: "Synthetic act preview", truncated: true })),
      resolve: async identity => { reads.push(identity); return { identity, snapshot: "revision", objectKey: "act", sha256: "a".repeat(64),
        byteCount: Buffer.byteLength(text), sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" }; }, get: async () => Buffer.from(text) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") {
        assert.ok(searches.includes(title), "Search the supplied title without conversational suffixes");
        return { conversationReply: null, candidateIds: ["c1"], interpretation: { needsClarification: false, complexity: "simple",
          requirements: [{ id: "r", question: "Explain the named act" }], queries: [request.question], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] } };
      }
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity), ["act"]);
      return { decision: "answer", gaps: [], actions: [], content: { summary: "Описание тестового акта.", summarySourceIds: ["act"],
        issues: [{ title: "Содержание", explanation: "Описание тестового акта.", requirementIds: ["r"], sourceIds: ["act"], actions: [] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" } };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer"); assert.deepEqual(reads, ["act"]);
});

test("a completed unsuccessful search retains its specific gap without inventing an outage", async () => {
  const gap = "Не найдено приложение с перечнем государств к указанному акту.";
  const result = await runLegalAnswer({ ...request, submittedAt: Date.now() }, {
    corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }), resolve: async () => null, get: async () => null },
    model: { complete: async ({ stage }) => stage === "interpret" ? { conversationReply: null, interpretation: { needsClarification: false,
      complexity: "simple", requirements: [{ id: "r", question: "Explain the act" }], queries: [title], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] } }
      : { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "r", description: gap }], actions: [] } },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  const serialized = serializeLegalOutcome(result.outcome, request, { sources: [], legalDatabaseAsOf: "2026-11-04" });
  assert.deepEqual(serialized.coverageGaps, [gap]);
  assert.equal(serialized.failureReason, undefined);
});
