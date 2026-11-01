import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { runCompleteReadFixture as runLegalAnswer } from "./helpers/complete-read-agent";
import type { LegalRequest, WorkflowPorts } from "../lib/legal-answer-workflow/contracts";

test("complete visual evidence accompanies the agent and missing stored files prevent publication", async () => {
  for (const missing of [false, true]) {
    let published = false;
    const pdf = Buffer.from("%PDF-artificial full page fixture"), text = Buffer.from("Artificial page navigation.");
    const run = runLegalAnswer({ question: "Artificial rule?", language: "en", format: "short", mode: "fast",
      submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "a", userId: "b" }, history: [], privateDocuments: [] }, {
      model: { complete: async ({ stage, sourceFiles }) => {
        if (stage === "interpret") return { complexity: "difficult", needsClarification: false,
          requirements: [{ id: "r", question: "Artificial rule?" }], queries: ["artificial rule"],
          scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
        assert.equal(stage, "write");
        assert.deepEqual(Buffer.from(sourceFiles![0].bytes), pdf);
        return { decision: "answer", gaps: [], actions: [], content: {
          summary: "Artificial rule.", summarySourceIds: ["rule"], issues: [{ title: "Rule", explanation: "Artificial rule.",
            requirementIds: ["r"], sourceIds: ["rule"], actions: [] }], conditionalBranches: [], assumptions: [], risks: [],
          deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" } };
      } },
      corpus: { search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
        resolve: async () => ({ identity: "rule", snapshot: "revision", objectKey: "text", sha256: "a".repeat(64), byteCount: text.length,
          sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
          canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported",
          sourceFile: { objectKey: "pdf", sha256: "b".repeat(64), byteCount: pdf.length } }),
        get: async key => key === "text" ? text : missing ? null : pdf },
      publication: { publish: async ({ outcome }) => { published = true; return { answerId: "saved", outcome }; } },
    });
    if (missing) { await assert.rejects(() => run, /SOURCE_FILE_UNAVAILABLE/); assert.equal(published, false); }
    else assert.equal((await run).outcome.kind, "answer");
  }
});

test("a failed corpus query does not discard independent searches or bypass the evidence outcome", async () => {
  const queries: string[] = [];
  let assessed = false;
  const result = await runLegalAnswer({ question: "Artificial notice and exception?", language: "en",
    format: "detailed", mode: "fast", submittedAt: Date.now(), deadlineMs: 30_000,
    actor: { tenantId: "a", userId: "b" }, history: [], privateDocuments: [] }, {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Notice and exception?" }],
        queries: ["notice", "exception"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      assert.equal(stage, "write");
      assessed = true;
      const context = input as { researchFailures: { code: string }[] };
      assert.ok(context.researchFailures.some(failure => failure.code === "CORPUS_SEARCH_UNAVAILABLE"));
      assert.ok(!JSON.stringify(input).includes("artificial-secret"));
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Rule unavailable." }] };
    } },
    corpus: { search: async query => { queries.push(query);
      if (query === "notice") throw new Error("private endpoint artificial-secret");
      return { candidates: [], sparseAvailable: true, denseAvailable: true };
    }, resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.deepEqual(queries.sort(), ["exception", "notice"]);
  assert.equal(assessed, true);
  assert.equal(result.outcome.kind, "insufficient_evidence");
});

test("an explicitly requested legal date reaches interpretation and cannot silently become current law", async () => {
  const request: LegalRequest = { question: "Which artificial rule applied?", language: "en", format: "short", mode: "fast",
    legalContextDate: "2020-07-01", submittedAt: Date.now(), deadlineMs: 30_000,
    actor: { tenantId: "a", userId: "b" }, history: [], privateDocuments: [] };
  let historical = false, searches = 0;
  const ports: WorkflowPorts = {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") {
        assert.equal((input as { legalContextDate: string }).legalContextDate, request.legalContextDate);
        return { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Historical rule?" }], queries: ["artificial rule"],
          scopes: [historical ? { kind: "historical", at: "2020-07-01" } : { kind: "current" }], facts: [], clarificationQuestions: [] };
      }
      assert.equal(stage, "write");
      return { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "r", description: "Historical rule unavailable." }], actions: [] };
    } },
    corpus: { search: async (_query, scope) => { searches++; assert.deepEqual(scope, { kind: "historical", at: "2020-07-01" });
      return { candidates: [], sparseAvailable: true, denseAvailable: true }; }, resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  };
  await assert.rejects(() => runLegalAnswer(request, ports), /INTERPRETATION_DATE_MISMATCH/);
  assert.equal(searches, 0);
  historical = true;
  assert.equal((await runLegalAnswer(request, ports)).outcome.kind, "insufficient_evidence");
  assert.equal(searches, 1);
});

test("missing material law yields a persisted non-answer without speculative writing", async () => {
  let writing = false;
  const result = await runLegalAnswer({
    question: "Under the artificial notice rule, what must I send?", language: "en",
    format: "detailed", mode: "deep", submittedAt: Date.now(), deadlineMs: 30_000,
    actor: { tenantId: "tenant-a", userId: "user-a" }, history: [], privateDocuments: [],
  }, {
    model: {
      complete: async ({ stage }) => {
        if (stage === "interpret") return { needsClarification: false, complexity: "difficult",
          requirements: [{ id: "notice", question: "What notice is required?" }],
          queries: ["artificial notice requirements"], scopes: [{ kind: "current" }],
          facts: [], clarificationQuestions: [],
        };
        if (stage === "write") return {
          decision: "insufficient_evidence", content: null,
          gaps: [{ requirementId: "notice", description: "No authenticated notice rule found." }],
          actions: [],
        };
        writing = true;
        throw new Error("No writer should run for a material legal gap");
      },
    },
    corpus: {
      search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
      resolve: async () => null,
      get: async () => null,
    },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-non-answer", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(result.answerId, "saved-non-answer");
  assert.equal(writing, false);
});

test("a supported rule is written with its exception and published with authenticated evidence", async () => {
  const text = "Artificial rule: written notice is required unless the recipient consents to oral notice.";
  const bytes = Buffer.from(text);
  const result = await runLegalAnswer({
    question: "What notice should I send?", language: "en", format: "detailed", mode: "deep",
    submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "a", userId: "b" },
    history: [], privateDocuments: [],
  }, {
    model: { complete: async ({ stage }) => {
      if (stage === "interpret") return { needsClarification: false, complexity: "difficult",
        requirements: [{ id: "notice", question: "Required notice and exceptions?" }],
        queries: ["artificial notice"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [],
      };
      return { decision: "answer", gaps: [], actions: [], content: {
        summary: "Send written notice unless the recipient consents to oral notice.", summarySourceIds: ["rule"],
        issues: [{ title: "Notice", explanation: text, requirementIds: ["notice"], sourceIds: ["rule"],
          actions: [{ title: "Prepare written notice", description: "Record delivery and keep a copy.", sourceIds: ["rule"] }] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
        referenceNotes: [], clarificationQuestions: [], urgency: "normal",
      } };
    } },
    corpus: {
      search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
      resolve: async () => ({ identity: "rule", snapshot: "revision", objectKey: "object",
        sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
        sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source",
        quarantined: false, canonicalizationConflict: false, currentPointerVerified: true,
        temporalState: "current_supported" }),
      get: async () => bytes,
    },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-answer", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  if (result.outcome.kind !== "answer") throw new Error("Expected an answer");
  assert.match(result.outcome.content.summary, /unless the recipient consents/);
  assert.equal(result.outcome.evidence[0].text, text);
});
