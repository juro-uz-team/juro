import assert from "node:assert/strict";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import type { LegalRequest } from "../lib/legal-answer-workflow/contracts";
import { createQueryEmbeddings } from "../lib/legal-answer-workflow/embeddings";

test("follow-up discovery retains navigation until the model chooses a complete read", async () => {
  let turns = 0;
  const read: string[] = [];
  await runLegalAnswer({ question: "Artificial permit procedure", language: "en", format: "short", mode: "fast",
    submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [] }, {
    corpus: { automaticReadLimit: 1,
      search: async query => ({ candidates: [query], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, text: "Navigation", truncated: true,
        sourceUrl: `https://lex.uz/docs/${identity === "initial" ? "123" : "124"}`,
        readRange: { kind: "provision" as const, key: identity, language: "en" } })),
      resolve: async identity => { read.push(identity); return { identity, snapshot: "fixture", objectKey: identity,
        sha256: "0".repeat(64), byteCount: 30, sourceUrl: `https://lex.uz/docs/${identity === "initial" ? "123" : "124"}`,
        privacyClass: "public_official_source", quarantined: false, canonicalizationConflict: false,
        currentPointerVerified: true, temporalState: "current_supported" }; }, get: async () => Buffer.from("Complete artificial permit law.") },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { conversationReply: null, interpretation: { needsClarification: false, complexity: "simple",
        requirements: [{ id: "r", question: "Permit procedure" }], queries: ["initial"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] } };
      const packet = input as { evidence: { identity: string }[]; unreadCandidates: { id: string }[] };
      const phase = turns++;
      if (phase < 2) assert.deepEqual(packet.evidence.map(item => item.identity), ["initial"]);
      if (phase === 0) return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", query: "procedure" }] };
      if (phase === 1) {
        assert.deepEqual(read, ["initial"]);
        return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: packet.unreadCandidates[0].id }] };
      }
      assert.deepEqual(packet.evidence.map(item => item.identity), ["initial", "procedure"]);
      return { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "r", description: "Fixture complete" }], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "selected-read", outcome }) },
  });
});

test("cancelled entry navigation keeps its embedding settlement owned until drained", async () => {
  const abort = new AbortController();
  let started!: () => void, release!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const settlement = new Promise<void>(resolve => { release = resolve; });
  let settled = false;
  const embeddings = createQueryEmbeddings({ apiKey: "fixture", dimensions: 3072, inputRate: 1,
    phase: "diagnostic", deadlineAt: Date.now() + 30_000,
    ledger: { reserve: () => "embedding", dispatch: () => {}, cancel: () => {},
      settle: async () => { await settlement; settled = true; } }, receipt: async () => {},
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      started();
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  const request: LegalRequest = { question: "Artificial permit conditions", language: "en", format: "short", mode: "fast",
    submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], signal: abort.signal };
  const running = runLegalAnswer(request, {
    corpus: { entryNavigation: true, search: async (query, _scope, signal) => {
      await embeddings.embed(query, signal); return { candidates: [], sparseAvailable: true, denseAvailable: true };
    }, describeCandidates: async () => [], resolve: async () => null, get: async () => null },
    model: { complete: async () => assert.fail("Cancelled preload must not begin generation") },
    publication: { publish: async () => assert.fail("Cancelled preload must not publish") },
    drain: () => embeddings.drain(),
  });
  let completed = false;
  const rejected = assert.rejects(running, /Fixture cancellation/).then(() => { completed = true; });
  await dispatched;
  abort.abort(new Error("Fixture cancellation"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  release();
  await rejected;
  assert.equal(settled, true);
});

for (const scenario of ["current", "historical", "supplemental", "failed"]) test(`entry navigation selects complete law without losing scope or queries (${scenario})`, async () => {
  const historical = scenario === "historical";
  const searched: string[] = [], read: string[] = [], stages: string[] = [];
  const request: LegalRequest = { question: "Artificial permit conditions", language: "en", format: "short", mode: "fast",
    submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [] };
  const scope = historical ? { kind: "historical" as const, at: "2020-01-01" } : { kind: "current" as const };
  await runLegalAnswer(request, {
    corpus: { entryNavigation: true, candidateReadScope: "section", automaticReadLimit: 1,
      search: async (query, scope) => { searched.push(`${scope.kind}:${query}`); return {
        candidates: scenario === "failed" ? ["current", "alternative"] : [query === "Additional condition" ? "condition" : scope.kind], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: "Artificial rule", truncated: true, readRange: { kind: "provision" as const, key: identity, language: "en" } })),
      resolve: async (identity, scope) => { read.push(identity); if (scenario === "failed" && identity === "current") return null;
        return { identity, snapshot: "revision", objectKey: identity,
        sha256: "0".repeat(64), byteCount: 30, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source" as const,
        quarantined: false, canonicalizationConflict: false, currentPointerVerified: true,
        temporalState: scope.kind === "current" ? "current_supported" as const : "historical_only" as const,
        ...(scope.kind === "historical" ? { applicableAt: scope.at } : {}) }; },
      get: async () => Buffer.from("Complete artificial permit law.") },
    model: { complete: async ({ stage, input }) => {
      stages.push(stage);
      if (stage === "interpret") {
        assert.deepEqual(searched, [`current:${request.question}`]);
        assert.equal((input as { unreadCandidates: { id: string }[] }).unreadCandidates[0].id, "c1");
        return { conversationReply: null, candidateIds: ["c1"], interpretation: { needsClarification: false, complexity: "simple",
          requirements: [{ id: "r", question: "Artificial rule" }], queries: [scenario === "supplemental" ? "Additional condition" : request.question], scopes: [scope], facts: [], clarificationQuestions: [] } };
      }
      if (scenario === "failed" && stages.length === 2) {
        const packet = input as { evidence: unknown[]; actionOutcomes: { kind: string }[] };
        assert.equal(packet.evidence.length, 0);
        assert.equal(packet.actionOutcomes[0].kind, "unavailable");
        return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: "c2" }] };
      }
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity).sort(),
        scenario === "supplemental" ? ["condition", "current"] : scenario === "failed" ? ["alternative"] : [scope.kind]);
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "entry-reads", outcome }) },
  });
  assert.deepEqual(stages, scenario === "failed" ? ["interpret", "write", "write"] : ["interpret", "write"]);
  assert.deepEqual(read.sort(), scenario === "supplemental" ? ["condition", "current"] : scenario === "failed" ? ["alternative", "current"] : [scope.kind]);
  assert.deepEqual(searched, historical ? [`current:${request.question}`, `historical:${request.question}`]
    : scenario === "supplemental" ? [`current:${request.question}`, "current:Additional condition"] : [`current:${request.question}`]);
});

for (const contextual of [false, true]) test(`entry navigation preserves conversational outcomes and contextual input (${contextual})`, async () => {
  let searches = 0;
  const request: LegalRequest = { question: "Thanks", language: "en", format: "short", mode: "fast",
    submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "t", userId: "u" },
    history: contextual ? [{ role: "user", content: "Earlier complete context." }] : [], privateDocuments: [] };
  const result = await runLegalAnswer(request, {
    corpus: { entryNavigation: true, prefetchInitialSearch: true,
      search: async () => { searches++; return { candidates: [], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async () => [], resolve: async () => assert.fail("Conversation must not read law"), get: async () => null },
    model: { complete: async ({ input }) => {
      assert.deepEqual((input as { history: unknown }).history, request.history);
      assert.equal(searches, contextual ? 0 : 1);
      return { conversationReply: "You're welcome.", interpretation: null, ...(contextual ? {} : { candidateIds: [] }) };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "conversation", outcome }) },
  });
  assert.equal(result.outcome.kind, "conversation");
});

for (const questionFirstResearch of [false, true])
for (const historical of [false, true]) test(`initial discovery overlaps interpretation and respects the interpreted scope (historical: ${historical}, question first: ${questionFirstResearch})`, async () => {
  const searches: { query: string; scope: unknown }[] = [];
  let started!: () => void;
  const discoveryStarted = new Promise<void>(resolve => { started = resolve; });
  const request: LegalRequest = { question: "An artificial legal question", language: "en", format: "short", mode: "fast",
    submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [] };
  const scope = historical ? { kind: "historical" as const, at: "2020-01-01" } : { kind: "current" as const };
  const outcome = await runLegalAnswer(request, {
    corpus: { prefetchInitialSearch: true, questionFirstResearch,
      search: async (query, scope) => { searches.push({ query, scope }); started(); return {
        candidates: [scope.kind === "current" ? "current" : "historical"], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => { throw new Error("No complete reads requested"); }, get: async () => null },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") {
        let timer!: ReturnType<typeof setTimeout>;
        try { await Promise.race([discoveryStarted, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Discovery did not overlap interpretation")), 250);
        })]); } finally { clearTimeout(timer); }
        return { conversationReply: null, interpretation: { needsClarification: false, complexity: "simple",
          requirements: [{ id: "r", question: "Artificial rule" }], queries: ["Interpreted formulation"], scopes: [scope], facts: [], clarificationQuestions: [] } };
      }
      const packet = input as { candidateQueries: Record<string, string>; interpretation: { queries: string[] } };
      assert.deepEqual(packet.interpretation.queries, ["Interpreted formulation"]);
      assert.deepEqual(Object.values(packet.candidateQueries), historical ? ["Interpreted formulation"]
        : questionFirstResearch ? [request.question] : [request.question, "Interpreted formulation"]);
      return { turn: { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Synthetic test" }] } }.turn;
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(outcome.outcome.kind, "insufficient_evidence");
  assert.deepEqual(searches, [{ query: request.question, scope: { kind: "current" } },
    ...(historical || !questionFirstResearch ? [{ query: "Interpreted formulation", scope }] : [])]);
});
