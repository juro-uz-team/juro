import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import type { Interpretation, ModelOperation, WorkflowPorts } from "../lib/legal-answer-workflow/contracts";
import { automaticReadPriority, discoverReadCandidates, interleaveCandidateReads } from "../lib/legal-answer-workflow/candidate-selection";
import type { EvidenceScope } from "../lib/legal-answer-workflow/evidence";

const initialCandidates = ["governing", ...Array.from({ length: 15 }, (_, index) => `aux${index + 1}`)];

test("automatic navigation priority recognizes whole-instrument publisher notices only", () => {
  for (const [notice, expected] of [
    ["Акт утратил силу\u00a001.01.2000 зарегистрировано", 1],
    ["Ҳужжат кучини йўқотган 01.01.2000 маълумот", 1],
    ["Hujjat kuchini yo‘qotgan 01.01.2000 ma’lumot", 1],
    ["Акт утратил силу 01.01.2040", 0],
    ["Акт утратил силу 31.02.2000", 0],
    ["Пункт утратил силу 01.01.2000", 0],
    ["Акт утратил силу 01.01.2000 в части отдельных положений", 0],
    ["Акт утратил силу 01.01.2000 за исключением приложения", 0],
    ["Hujjat kuchini yo‘qotgan 01.01.2000 qisman", 0],
    ["The text quotes: Акт утратил силу 01.01.2000", 0],
  ] as const) {
    assert.equal(automaticReadPriority({ identity: "candidate", id: "c1", sourceUrl: "https://lex.uz/docs/123",
      text: "Navigation", truncated: false, sourceNotes: [notice], scope: { kind: "current" },
      query: "query", queries: ["query"], ranks: [] }, "2026-01-01"), expected);
  }
});

function fixture(omitException = false, unresolved = false) {
  const stages: string[] = [], reads: string[] = [];
  let assessments = 0;
  const bytes = (id: string) => Buffer.from(`Complete authenticated artificial rule and exception ${id}.`);
  const ports: WorkflowPorts = {
    corpus: { search: async query => ({ candidates: query === "initial" ? (omitException ? [...initialCandidates, "exception", "irrelevant"] : ["irrelevant", "governing", "exception"]) : ["recovered"],
      sparseAvailable: true, denseAvailable: true }),
    describeCandidates: async identities => identities.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
      text: `Discovery-only incomplete preview ${identity}`, truncated: false,
      title: "Artificial Act", hierarchy: ["Artificial Part"] })),
    resolve: async identity => { reads.push(identity); return { identity, snapshot: "fixture", objectKey: identity,
      sha256: createHash("sha256").update(bytes(identity)).digest("hex"), byteCount: bytes(identity).length,
      sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
      canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }; },
    get: async key => bytes(key) },
    model: legalEntryFixture({ complete: async ({ stage, input }: ModelOperation) => {
      stages.push(stage);
      if (stage === "interpret") return { candidateIds: [], interpretation: { complexity: "difficult", needsClarification: false,
        requirements: [{ id: "r", question: "Governing artificial rule and exception?" }], queries: ["initial"],
        scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] } };
      assert.notEqual(stage, "select", "ranked discovery must not invoke a selection model");
      if (stage === "write") {
        assessments++;
        const context = input as { evidence: { identity: string; text: string }[]; unreadCandidates: { id: string; text: string }[] };
        assert.ok(context.evidence.every(item => item.text.startsWith("Complete authenticated")));
        if (!context.evidence.length) return researchTurn([{ requirementId: "r", description: "Read governing law and exception." }],
          context.unreadCandidates.filter(item => /(?:governing|exception)$/.test(item.text)).map(item => ({ requirementId: "r", candidateId: item.id })));
        if (unresolved) return researchTurn([{ requirementId: "r", description: "Missing material exception." }], [{ requirementId: "r", query: `recovery-${assessments}` }]);
        return answered(["governing", "exception"]);
      }
      throw new Error("Unexpected model stage");
    } }), publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  };
  return { ports, stages, reads };
}
const request = () => ({ question: "Which artificial rule governs?", language: "en" as const, format: "detailed" as const,
  mode: "fast" as const, actor: { tenantId: "tenant", userId: "user" }, history: [], privateDocuments: [],
  submittedAt: Date.now(), deadlineMs: 30_000 });

test("refined discovery chooses full reads when the initial question previews were not selected", async () => {
  const f = fixture(); const result = await runLegalAnswer(request(), f.ports);
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(f.stages, ["interpret", "write", "write"]);
  assert.deepEqual(f.reads, ["governing", "exception"]);
});
test("targeted research stops within the eight-call budget without automatic reads", async () => {
  const f = fixture(false, true);
  const search = f.ports.corpus.search;
  f.ports.corpus.search = async (query, ...args) => query === "initial" ? search(query, ...args)
    : { candidates: [query], sparseAvailable: true, denseAvailable: true };
  const result = await runLegalAnswer(request(), f.ports);
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.deepEqual(f.stages, ["interpret", ...Array.from({ length: 7 }, () => "write")]);
  assert.deepEqual(f.reads, ["governing", "exception"]);
});

test("repeating an exhausted search closes acquisition and composes from retained law", async () => {
  const f = fixture(); let searches = 0, assessments = 0;
  const search = f.ports.corpus.search, complete = f.ports.model.complete;
  f.ports.corpus.search = async (...args) => { searches++; return search(...args); };
  f.ports.model.complete = async operation => {
    if (operation.stage === "write") {
      assessments++;
      const evidence = (operation.input as { evidence: { identity: string }[] }).evidence;
      if (assessments === 1) {
        return complete(operation);
      }
      if (assessments === 2) {
        return researchTurn([{ requirementId: "r", description: "Missing exception." }], [{ requirementId: "r", query: "initial" }]);
      }
      assert.ok(evidence.some(item => item.identity === "exception"));
      assert.equal((operation.input as { canResearch: boolean }).canResearch, false);
      return answered(["governing", "exception"]);
    }
    return complete(operation);
  };
  const result = await runLegalAnswer(request(), f.ports);
  assert.equal(result.outcome.kind, "answer"); assert.equal(assessments, 3); assert.equal(searches, 1);
  assert.deepEqual(f.reads, ["governing", "exception"]);
});

test("coverage recovery requests an exact unread candidate without another search or unrelated reads", async () => {
  const f = fixture(true); let searches = 0, assessments = 0;
  let governingId = "", exceptionId = "";
  const search = f.ports.corpus.search, complete = f.ports.model.complete;
  f.ports.corpus.search = async (...args) => { searches++; return search(...args); };
  f.ports.model.complete = async operation => {
    if (operation.stage === "write") {
      assessments++;
      const context = operation.input as { evidence: { identity: string }[];
        unreadCandidates: { id: string; text: string; scope: EvidenceScope; navigationOnly?: boolean }[] };
      if (assessments === 1) {
        const candidate = context.unreadCandidates.find(item => item.text.endsWith("governing"))!;
        governingId = candidate.id;
        exceptionId = context.unreadCandidates.find(item => item.text.endsWith("exception"))!.id;
        return researchTurn([{ requirementId: "r", description: "Read the governing rule." }], [{ requirementId: "r", candidateId: candidate.id }]);
      }
      assert.ok(!context.unreadCandidates.some(item => item.id === governingId));
      if (assessments === 2) {
        const candidate = context.unreadCandidates.find(item => item.id === exceptionId)!;
        assert.notEqual(candidate.navigationOnly, true);
        assert.ok(candidate.text.endsWith("exception"));
        assert.deepEqual(candidate.scope, { kind: "current" });
        return researchTurn([{ requirementId: "r", description: "Missing exception." }], [{ requirementId: "r", candidateId: candidate.id }]);
      }
      assert.deepEqual(context.evidence.map(item => item.identity), ["governing", "exception"]);
      assert.ok(!context.unreadCandidates.some(item => item.id === exceptionId));
      return answered(["governing", "exception"]);
    }
    return complete(operation);
  };
  const result = await runLegalAnswer(request(), f.ports);
  assert.equal(result.outcome.kind, "answer"); assert.equal(assessments, 3); assert.equal(searches, 1);
  assert.deepEqual(f.reads, ["governing", "exception"]);
});

test("candidate recovery rejects fabricated IDs before any additional read", async () => {
  const f = fixture(); const complete = f.ports.model.complete;
  f.ports.model.complete = async operation => operation.stage === "write"
    ? researchTurn([{ requirementId: "r", description: "Missing rule." }], [{ requirementId: "r", candidateId: "invented" }])
    : complete(operation);
  const result = await runLegalAnswer(request(), f.ports);
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.deepEqual(f.reads, []);
});

test("direct candidate recovery preserves historical scope and deduplicates requested reads", async () => {
  const f = fixture(true); const complete = f.ports.model.complete, resolve = f.ports.corpus.resolve;
  const scope = { kind: "historical" as const, at: "2020-04-15" };
  let assessments = 0;
  f.ports.corpus.resolve = async (identity, suppliedScope, signal) => {
    assert.deepEqual(suppliedScope, scope);
    const locator = await resolve(identity, suppliedScope, signal);
    assert.ok(locator);
    return { ...locator, temporalState: "historical_only", currentPointerVerified: false, applicableAt: scope.at };
  };
  f.ports.model.complete = async operation => {
    if (operation.stage === "interpret") return { conversationReply: null, interpretation: { complexity: "difficult", needsClarification: false,
      requirements: [{ id: "r", question: "Historical rule and exception?" }], queries: ["initial"],
      scopes: [scope], facts: [], clarificationQuestions: [] } };
    if (operation.stage === "write") {
      assessments++;
      if (assessments === 1) {
        const candidates = (operation.input as { unreadCandidates: { id: string; text: string; scope: EvidenceScope }[] }).unreadCandidates;
        const candidate = candidates.find(item => item.text.endsWith("exception"))!;
        assert.deepEqual(candidate.scope, scope);
        const action = { requirementId: "r", candidateId: candidate.id };
        const governing = candidates.find(item => item.text.endsWith("governing"))!;
        return researchTurn([{ requirementId: "r", description: "Read historical rule and exception." }],
          [{ requirementId: "r", candidateId: governing.id }, action, action]);
      }
      return answered(["governing", "exception"]);
    }
    return complete(operation);
  };
  const result = await runLegalAnswer({ ...request(), legalContextDate: scope.at }, f.ports);
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(f.reads, ["governing", "exception"]);
});

test("an unread candidate ID cannot establish coverage", async () => {
  const f = fixture(true); const complete = f.ports.model.complete;
  f.ports.model.complete = async operation => {
    if (operation.stage !== "write") return complete(operation);
    const candidates = (operation.input as { unreadCandidates: { id: string }[] }).unreadCandidates;
    return answered([candidates[0].id]);
  };
  await assert.rejects(() => runLegalAnswer(request(), f.ports), /WRITING_EVIDENCE_EMPTY/);
});

test("follow-up visual evidence is read only after explicit candidate selection", async () => {
  const f = fixture(); const complete = f.ports.model.complete, resolve = f.ports.corpus.resolve, get = f.ports.corpus.get;
  const pdf = Buffer.from("%PDF-artificial original"), sha256 = createHash("sha256").update(pdf).digest("hex");
  const stages: string[] = []; let assessments = 0;
  assert.equal(typeof f.ports.corpus.describeCandidates, "function");
  f.ports.corpus.search = async query => ({ candidates: query === "initial" || query === "Which artificial rule governs?" ? [] : [query],
    sparseAvailable: true, denseAvailable: true });
  f.ports.corpus.resolve = async (...args) => {
    const locator = await resolve(...args); assert.ok(locator);
    return { ...locator, sourceFile: { objectKey: "original.pdf", sha256, byteCount: pdf.length } };
  };
  f.ports.corpus.get = async (key, signal) => key === "original.pdf" ? pdf : get(key, signal);
  f.ports.model.complete = async operation => {
    stages.push(operation.stage);
    if (operation.stage === "write") {
      assessments++;
      const evidence = (operation.input as { evidence: { identity: string }[] }).evidence;
      assert.equal(operation.sourceFiles?.length, assessments === 3 ? 2 : 0);
      assert.equal(evidence.length, assessments === 3 ? 2 : 0);
      if (assessments === 1) return researchTurn([{ requirementId: "r", description: "Missing complete artificial rule." }],
        [{ requirementId: "r", query: "governing" }, { requirementId: "r", query: "exception" }]);
      if (assessments === 2) {
        const context = operation.input as { unreadCandidates: { id: string }[] };
        return researchTurn([{ requirementId: "r", description: "Read selected rules." }],
          context.unreadCandidates.map(item => ({ requirementId: "r", candidateId: item.id })));
      }
      return answered(["governing", "exception"]);
    }
    return complete(operation);
  };
  const result = await runLegalAnswer(request(), f.ports);
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(stages, ["interpret", "write", "write", "write"]);
  assert.deepEqual(f.reads, ["governing", "exception"]);
});

test("candidate discovery bounds transport batches while preserving all results and scopes", async () => {
  const f = fixture(), searches = new Set<string>();
  const failures: { candidate: string; scope: EvidenceScope; code: string }[] = [];
  const limits: { query: string; scope: EvidenceScope; omittedCandidates: number }[] = [];
  const batches: number[] = [], scopes: EvidenceScope[] = [];
  f.ports.corpus.search = async (query, scope) => {
    scopes.push(scope);
    return { candidates: Array.from({ length: 50 }, (_, i) => `${query}-${i}`), sparseAvailable: true, denseAvailable: true };
  };
  f.ports.corpus.describeCandidates = async ids => { batches.push(ids.length); return ids.map(identity => ({ identity,
    sourceUrl: "https://lex.uz/docs/123", text: "Incomplete fixture preview", truncated: true })); };
  const pool = await discoverReadCandidates({ corpus: f.ports.corpus, searches, failures, limits, signal: AbortSignal.timeout(3000),
    interpretation: { complexity: "difficult", needsClarification: false, requirements: [{ id: "r", question: "Temporal rule?" }],
      queries: ["a", "b", "c", "d"], scopes: [{ kind: "current" }, { kind: "historical", at: "2020-01-01" }], facts: [], clarificationQuestions: [] } });
  assert.equal(pool.length, 400); assert.ok(batches.every(size => size <= 48));
  assert.equal(batches.length, 16, "each top-50 result set needs only two catalog pages");
  assert.equal(new Set(pool.map(item => item.id)).size, 400);
  assert.deepEqual(scopes.slice(0, 2), [{ kind: "current" }, { kind: "historical", at: "2020-01-01" }]);
  assert.ok(pool.some(item => item.identity === "a-0" && item.scope.kind === "current"));
  assert.ok(pool.some(item => item.identity === "a-0" && item.scope.kind === "historical"));
  assert.deepEqual(failures, []);
  assert.deepEqual(limits, []);
});

test("deduplicated previews retain every query association for subsequent recovery", async () => {
  const f = fixture();
  f.ports.corpus.search = async () => ({ candidates: ["shared"], sparseAvailable: true, denseAvailable: true });
  const pool = await discoverReadCandidates({ corpus: f.ports.corpus, searches: new Set(), failures: [], limits: [],
    signal: AbortSignal.timeout(3000), interpretation: { complexity: "difficult", needsClarification: false,
      requirements: [{ id: "r", question: "Artificial rule?" }], queries: ["first", "second"], scopes: [{ kind: "current" }],
      facts: [], clarificationQuestions: [] } });
  assert.equal(pool.length, 1); assert.deepEqual(pool[0].queries.sort(), ["first", "second"]);
});

test("full-read scheduling starts distinct documents before queueing more provisions from the same document", () => {
  const scope = { kind: "current" as const };
  const reads = ["a1", "a2", "a3", "b1", "b2", "c1"].map(identity => ({ identity, scope,
    sourceUrl: `https://lex.uz/docs/${identity[0]}` }));
  const ordered = interleaveCandidateReads(reads);
  assert.deepEqual(ordered.map(item => item.identity), ["a1", "b1", "c1", "a2", "b2", "a3"]);
  assert.deepEqual(reads.map(item => item.identity), ["a1", "a2", "a3", "b1", "b2", "c1"]);
  assert.deepEqual(new Set(ordered), new Set(reads));
});


test("discovery preserves search ranks despite reordered catalog responses and keeps every candidate", async () => {
  const f = fixture(true), describe = f.ports.corpus.describeCandidates!;
  f.ports.corpus.describeCandidates = async (...args) => (await describe(...args)).reverse();
  const interpretation: Interpretation = { complexity: "difficult", needsClarification: false,
    requirements: [{ id: "r", question: "Artificial rule?" }], queries: ["initial"], scopes: [{ kind: "current" }],
    facts: [], clarificationQuestions: [] };
  const pool = await discoverReadCandidates({ corpus: f.ports.corpus, interpretation, searches: new Set(), failures: [], limits: [],
    signal: AbortSignal.timeout(3000) });
  assert.deepEqual(pool.slice(0, 16).map(item => item.identity), initialCandidates);
  assert.equal(pool.length, 18);
  assert.equal(pool.find(item => item.identity === "exception")?.ranks[0].rank, 16);
});

function researchTurn(gaps: { requirementId: string; description: string }[], actions: unknown[]) {
  return { decision: actions.length ? "research" : "insufficient_evidence", content: null, gaps, actions };
}
function answered(sourceIds: string[]) {
  return { decision: "answer", gaps: [], actions: [], content: {
    summary: "Complete rule with exception.", summarySourceIds: sourceIds,
    issues: [{ title: "Rule", explanation: "Complete rule with exception.", requirementIds: ["r"], sourceIds, actions: [] }],
    conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
    clarificationQuestions: [], urgency: "normal" } };
}
