import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { requestLifetime, withinSignal } from "../lib/legal-answer-workflow/lifetime";

test("exceptional research leaves finalization time within the absolute four-minute ceiling", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const lifetime = requestLifetime(Date.now(), 240_000);
  try {
    context.mock.timers.tick(231_999);
    assert.equal(lifetime.researchSignal.aborted, false);
    context.mock.timers.tick(1);
    assert.equal(lifetime.researchSignal.aborted, true);
    assert.equal(lifetime.writingSignal.aborted, false);
    context.mock.timers.tick(6500);
    assert.equal(lifetime.writingSignal.aborted, true);
    assert.equal(lifetime.signal.aborted, false);
    context.mock.timers.tick(1500);
    assert.equal(lifetime.signal.aborted, true);
    assert.throws(() => requestLifetime(Date.now(), 240_001), /REQUEST_DEADLINE_INVALID/);
  } finally { lifetime.dispose(); context.mock.timers.reset(); }
});

test("budget selection preserves submission time and cannot revive expired research", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const lifetime = requestLifetime(Date.now(), 60_000, undefined, 15_000);
  try {
    context.mock.timers.tick(5000);
    lifetime.setDuration(30_000);
    context.mock.timers.tick(16_999);
    assert.equal(lifetime.researchSignal.aborted, false);
    context.mock.timers.tick(1);
    assert.equal(lifetime.researchSignal.aborted, true);
    assert.throws(() => lifetime.setDuration(60_000), /RESEARCH_DEADLINE/);
    context.mock.timers.tick(8000);
    assert.equal(lifetime.signal.aborted, true);
  } finally { lifetime.dispose(); context.mock.timers.reset(); }
});

test("interpretation selects a target while publication retains the overall caller ceiling", async () => {
  for (const [complexity, ceiling, expected] of [
    ["simple", 60_000, 15_000], ["difficult", 60_000, 30_000],
    ["very_difficult", 120_000, 30_000], ["very_difficult", 30_000, 30_000],
  ] as const) {
    const selected: number[] = [], submittedAt = Date.now();
    await runLegalAnswer({ question: "Artificial complexity case", language: "en", format: "short", mode: "fast",
      actor: { tenantId: "t", userId: "u" }, submittedAt, deadlineMs: ceiling, history: [], privateDocuments: [],
      onBudgetSelected: duration => selected.push(duration) }, {
      model: legalEntryFixture({ complete: async ({ stage, schema }) => {
        if (stage === "interpret") {
          assert.deepEqual(new Set(schema.required as string[]), new Set(["interpretation", "conversationReply"]));
          assert.match(JSON.stringify(schema), /"complexity"/);
          assert.doesNotMatch(JSON.stringify(schema), /"default"/);
          return { needsClarification: false, complexity, requirements: [{ id: "r", question: "Artificial rule?" }], queries: ["rule"],
            scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
        }
        return { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "r", description: "Unavailable." }], actions: [] };
      } }),
      corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }), resolve: async () => null, get: async () => null },
      publication: { publish: async ({ request, outcome }) => {
        assert.equal(request.submittedAt, submittedAt); assert.equal(request.deadlineMs, ceiling);
        return { answerId: "saved", outcome };
      } },
    });
    assert.deepEqual(selected, [expected]);
  }
});

test("a stalled research agent cannot consume the reserved publication time", { timeout: 3000 }, async () => {
  let assessmentSignal: AbortSignal | undefined;
  const result = await runLegalAnswer({ question: "Artificial rule?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, submittedAt: Date.now(), deadlineMs: 500, history: [], privateDocuments: [] }, {
    model: legalEntryFixture({ complete: async ({ stage, signal }) => {
      if (stage === "interpret") return { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Applicable rule?" }], queries: ["rule"],
        scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      assert.equal(stage, "write");
      assessmentSignal = signal;
      return new Promise(() => {});
    } }),
    corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
      resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome, signal }) => {
      assert.equal(signal.aborted, false);
      return { answerId: "persisted", outcome };
    } },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(assessmentSignal?.aborted, true);
});

test("writing has a separate deadline before the persistence deadline", async () => {
  const lifetime = requestLifetime(Date.now(), 500);
  try {
    await assert.rejects(() => withinSignal(lifetime.writingSignal, () => new Promise(() => {})), /WRITING_DEADLINE/);
    assert.equal(lifetime.signal.aborted, false);
  } finally { lifetime.dispose(); }
});

test("a stalled corpus read leaves time to persist an explicit source-unavailable result", { timeout: 3000 }, async () => {
  let observedSignal: AbortSignal | undefined;
  const result = await runLegalAnswer({ question: "Explain the artificial permit rule.",
    language: "en", format: "detailed", mode: "deep", actor: { tenantId: "t", userId: "u" },
    submittedAt: Date.now(), deadlineMs: 500, history: [], privateDocuments: [],
  }, {
    model: legalEntryFixture({ complete: async ({ stage }) => {
      assert.equal(stage, "interpret");
      return { needsClarification: false, complexity: "difficult", requirements: [{ id: "permit", question: "What is required?" }], queries: ["permit"],
        scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
    } }),
    corpus: { search: async (_query, _scope, signal) => {
      observedSignal = signal;
      return new Promise(() => {});
    }, resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome, signal }) => {
      assert.equal(signal.aborted, false);
      return { answerId: "saved-unavailable", outcome };
    } },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(observedSignal?.aborted, true);
});

test("a recovery timeout preserves the legal gap and still permits publication", { timeout: 3000 }, async () => {
  const result = await runLegalAnswer({ question: "Explain an artificial rule.", language: "en", format: "short",
    mode: "deep", actor: { tenantId: "t", userId: "u" }, submittedAt: Date.now(), deadlineMs: 500,
    history: [], privateDocuments: [],
  }, {
    model: legalEntryFixture({ complete: async ({ stage }) => stage === "interpret"
      ? { needsClarification: false, complexity: "difficult", requirements: [{ id: "rule", question: "What rule applies?" }], queries: ["initial"],
        scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] }
      : { decision: "research", content: null, gaps: [{ requirementId: "rule", description: "Missing governing rule." }],
        actions: [{ requirementId: "rule", query: "targeted" }] } }),
    corpus: { search: async query => query === "initial"
      ? { candidates: [], sparseAvailable: true, denseAvailable: true } : new Promise(() => {}),
    resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  if (result.outcome.kind === "insufficient_evidence") {
    assert.equal(result.outcome.researchIncomplete, true);
    assert.match(result.outcome.gaps[0].description, /could not finish/);
  }
});
