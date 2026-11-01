import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { legalEntryFixture } from "./helpers/legal-entry-agent";
import type { WrittenAnswer } from "../lib/legal-answer-workflow/contracts";
import type { ResearchDiagnostic } from "../lib/legal-answer-workflow/diagnostics";

const content: WrittenAnswer = { summary: "Artificial rule with its exception.", summarySourceIds: ["rule"],
  issues: [{ title: "Rule", explanation: "Artificial rule with its exception.", requirementIds: ["r"], sourceIds: ["rule"], actions: [] }],
  conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
  clarificationQuestions: [], urgency: "normal" };

test("capacity overflow retains evidence and stops without another model call", async () => {
  let decisions = 0;
  const events: ResearchDiagnostic[] = [], bytes = Buffer.from("Complete artificial rule.");
  const result = await runLegalAnswer({ question: "Artificial rule?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 120_000,
    onDiagnostic: event => { events.push(event); } }, {
    model: legalEntryFixture({ complete: async ({ stage, instruction }) => {
      if (stage === "interpret") return { complexity: "simple", needsClarification: false, requirements: [{ id: "r", question: "Rule?" }],
        queries: ["initial"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      decisions++;
      if (decisions === 1) return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: "c1" }] };
      if (decisions === 2) throw new Error("PROVIDER_INPUT_LIMIT");
      assert.match(instruction, /context repair, not a new corpus search/);
      return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", selectSourceIds: [] }] };
    } }),
    corpus: { search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => ({ identity, snapshot: "fixture", objectKey: identity, sha256: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }), get: async () => bytes },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(decisions, 2);
  assert.ok(events.some(event => event.event === "stop" && event.reason === "context_capacity"));
});

test("last acquisition overflow saves an explicit incomplete result without dropping law", async () => {
  let decisions = 0;
  let rejected = false;
  const bytes = Buffer.from("Artificial rule with its exception.");
  const result = await runLegalAnswer({ question: "Artificial rule?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 120_000 }, {
    model: legalEntryFixture({ complete: async ({ stage, input }) => {
      if (stage === "interpret") return { complexity: "simple", needsClarification: false, requirements: [{ id: "r", question: "Rule?" }],
        queries: ["initial"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      const packet = input as { evidence: { identity: string }[]; availableEvidence: { identity: string }[];
        canSelectEvidence?: boolean; canResearch: boolean; unreadCandidates: { id: string }[]; availableSections: unknown[]; retainedResults: unknown[] };
      if (decisions < 5) {
        decisions++;
        return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", query: `alternative ${decisions}` }] };
      }
      if (decisions === 5) {
        decisions++;
        return { decision: "research", content: null, gaps: [], actions: packet.unreadCandidates.map(item => ({ requirementId: "r", candidateId: item.id })) };
      }
      if (!rejected) { rejected = true; throw new Error("PROVIDER_INPUT_LIMIT"); }
      if (!packet.evidence.length) {
        assert.equal(packet.canSelectEvidence, true);
        assert.equal(packet.canResearch, false);
        assert.deepEqual(packet.unreadCandidates, []);
        assert.deepEqual(packet.availableSections, []);
        assert.deepEqual(packet.retainedResults, []);
        assert.deepEqual(packet.availableEvidence.map(item => item.identity), ["rule"]);
        return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", selectSourceIds: ["rule"] }] };
      }
      assert.equal(packet.canResearch, false);
      return { decision: "answer", actions: [], gaps: [], content };
    } }),
    corpus: { search: async query => ({ candidates: query === "alternative 5" ? ["rule"] : [], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => ({ identity, snapshot: "fixture", objectKey: identity, sha256: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }), get: async () => bytes },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(result.answerId, "saved");
});


test("a research decision crossing acquisition cutoff settles declined work before terminal composition", async context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  let decisions = 0, extraSearches = 0;
  const bytes = Buffer.from("Artificial rule with its exception.");
  const diagnostics: unknown[] = [];
  const result = await runLegalAnswer({ question: "Artificial rule?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [{ role: "user", content: "Private fact" }], privateDocuments: [],
    submittedAt: Date.now(), deadlineMs: 120_000, onDiagnostic: event => { diagnostics.push(event); } }, {
    model: legalEntryFixture({ complete: async ({ stage, input }) => {
      if (stage === "interpret") return { complexity: "simple", needsClarification: false, requirements: [{ id: "r", question: "Rule?" }],
        queries: ["initial"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      const packet = input as { canResearch: boolean; canSelectEvidence: boolean; history: unknown[];
        actionOutcomes: { kind: string; code?: string }[]; unreadCandidates: { id: string }[] };
      decisions++;
      if (decisions === 1) return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: packet.unreadCandidates[0].id }] };
      if (decisions === 2) {
        context.mock.timers.tick(68_501);
        return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", query: "late query" }] };
      }
      assert.equal(packet.canResearch, false);
      assert.equal(packet.canSelectEvidence, false);
      assert.ok(packet.actionOutcomes.some(item => item.kind === "not_executed" && item.code === "ACQUISITION_CLOSED"));
      assert.deepEqual(packet.history, [{ role: "user", content: "Private fact" }]);
      return { decision: "answer", actions: [], gaps: [], content };
    } }),
    corpus: { search: async query => { if (query !== "initial") extraSearches++; return { candidates: ["rule"], sparseAvailable: true, denseAvailable: true }; },
      resolve: async identity => ({ identity, snapshot: "fixture", objectKey: identity, sha256: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }), get: async () => bytes },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(extraSearches, 0);
  assert.doesNotMatch(JSON.stringify(diagnostics), /Private fact|Artificial|late query|lex\.uz/);
});


test("invalid acquisition is observable before an alternative, and provisional issues can be dropped", async () => {
  let decisions = 0;
  const bytes = Buffer.from("Artificial rule with its exception.");
  const result = await runLegalAnswer({ question: "Artificial rule?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 120_000,
    onDiagnostic: () => { throw new Error("Observer unavailable"); } }, {
    model: legalEntryFixture({ complete: async ({ stage, input }) => {
      if (stage === "interpret") return { complexity: "simple", needsClarification: false, requirements: [{ id: "r", question: "Rule?" }],
        queries: ["initial"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      const packet = input as { actionOutcomes: { kind: string; code?: string }[]; coverageRecords: { status: string; relevance: string }[] };
      decisions++;
      const issue = { id: "optional", issue: "Possible separate question", relevance: "Initially plausible", status: "open", sourceIds: [], dependency: "Unknown law", nextAction: "Inspect relevant source" };
      if (decisions === 1) return { decision: "research", content: null, gaps: [], coverageUpdates: [issue], actions: [{ requirementId: "r", candidateId: "unreturned" }] };
      if (decisions === 2) {
        assert.ok(packet.actionOutcomes.some(item => item.kind === "invalid" && item.code === "RECOVERY_CANDIDATE_INVALID"));
        assert.equal(packet.coverageRecords[0].status, "open");
        return { decision: "research", content: null, gaps: [], coverageUpdates: [{ ...issue, status: "dropped", relevance: "Not asked by this user", dependency: "", nextAction: "" }],
          actions: [{ requirementId: "r", candidateId: "c1" }] };
      }
      assert.equal(packet.coverageRecords[0].status, "dropped");
      assert.equal(packet.coverageRecords[0].relevance, "Not asked by this user");
      return { decision: "answer", actions: [], gaps: [], content };
    } }),
    corpus: { search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => ({ identity, snapshot: "fixture", objectKey: identity, sha256: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }), get: async () => bytes },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
});

test("late context overflow preserves saving time without dispatching context repair", async context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  let decisions = 0;
  const events: ResearchDiagnostic[] = [], bytes = Buffer.from("Complete artificial rule.");
  const result = await runLegalAnswer({ question: "Artificial rule?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 120_000,
    onDiagnostic: event => { events.push(event); } }, {
    model: legalEntryFixture({ complete: async ({ stage, instruction }) => {
      if (stage === "interpret") return { complexity: "simple", needsClarification: false, requirements: [{ id: "r", question: "Rule?" }],
        queries: ["initial"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      decisions++;
      if (decisions === 1) return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: "c1" }] };
      if (decisions === 2) { context.mock.timers.tick(70_000); throw new Error("PROVIDER_INPUT_LIMIT"); }
      assert.match(instruction, /context repair, not a new corpus search/);
      return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", selectSourceIds: [] }] };
    } }),
    corpus: { search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => ({ identity, snapshot: "fixture", objectKey: identity, sha256: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }), get: async () => bytes },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(decisions, 2);
  assert.ok(events.some(event => event.event === "stop" && event.reason === "context_capacity"));
});
