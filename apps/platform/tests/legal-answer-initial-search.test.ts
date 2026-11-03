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

test("cancelled legal search keeps its embedding settlement owned until drained", async () => {
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
    model: { complete: async ({ stage }) => {
      assert.equal(stage, "interpret");
      return { conversationReply: null, interpretation: { complexity: "simple", needsClarification: false,
        requirements: [{ id: "r", question: "Permit conditions" }], queries: [request.question], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] } };
    } },
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

for (const historical of [false, true]) test(`legal research starts after routing in the interpreted scope (${historical})`, async () => {
  const searches: { query: string; scope: unknown }[] = [];
  const scope = historical ? { kind: "historical" as const, at: "2020-01-01" } : { kind: "current" as const };
  const question = "An artificial legal question";
  await runLegalAnswer({ question, language: "en", format: "short", mode: "fast", submittedAt: Date.now(), deadlineMs: 30_000,
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [] }, {
    corpus: { prefetchInitialSearch: true, entryNavigation: true, questionFirstResearch: true,
      search: async (query, scope) => { searches.push({ query, scope }); return { candidates: [], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async () => [], resolve: async () => null, get: async () => null },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") {
        assert.deepEqual(searches, []);
        assert.equal((input as { question: string }).question, question);
        return { conversationReply: null, interpretation: { needsClarification: false, complexity: "simple",
          requirements: [{ id: "r", question: "Artificial rule" }], queries: ["Interpreted formulation"], scopes: [scope], facts: [], clarificationQuestions: [] } };
      }
      assert.deepEqual(searches, [{ query: "Interpreted formulation", scope }]);
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Synthetic gap" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
});
