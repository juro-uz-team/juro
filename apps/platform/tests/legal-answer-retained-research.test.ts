import { ResearchWorkspace } from "../lib/legal-answer-workflow/research-workspace";
import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceInventory } from "../lib/legal-answer-workflow/inventory";
import { discoverReadCandidates } from "../lib/legal-answer-workflow/candidate-selection";
import type { WorkflowPorts } from "../lib/legal-answer-workflow/contracts";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { researchCandidates } from "../lib/legal-answer-workflow/research-context";
import { createAnswerEventStream } from "../lib/legal-answer-workflow/answer-stream";
import { requestLifetime } from "../lib/legal-answer-workflow/lifetime";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";

test("workspace refuses evidence removal", () => {
  const workspace = new ResearchWorkspace();
  assert.throws(() => workspace.select([]), /EVIDENCE_REMOVAL_DISABLED/);
  assert.deepEqual(workspace.active(), []);
});

test("initial publisher headings batch distinct complete reads and coalesce aliases without a navigation turn", async () => {
  const reads: string[] = [], scope = { kind: "current" } as const;
  let turn = 0, searches = 0;
  const ports: WorkflowPorts = {
    corpus: {
      search: async () => { searches++; return { candidates: ["one", "alias"], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        language: "en", text: identity, truncated: false,
        publisherContents: [{ position: "10", title: "Rules" }, { position: "20", title: "Procedure" }] })),
      resolve: async (_identity, requestedScope, _signal, position) => {
        assert.deepEqual(requestedScope, scope); assert.ok(position === "10" || position === "20"); reads.push(position);
        return { identity: position, snapshot: "fixture", objectKey: position, sha256: "a".repeat(64), byteCount: 14,
          sourceUrl: `https://lex.uz/docs/123#${position}`, privacyClass: "public_official_source", quarantined: false,
          canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true };
      }, get: async () => Buffer.from("Complete rule."),
    },
    model: legalEntryFixture({ complete: async operation => {
      if (operation.stage === "interpret") return { interpretation: { complexity: "simple", needsClarification: false,
        requirements: [{ id: "r", question: "Rule and procedure?" }], queries: ["rule"], scopes: [scope], facts: [], clarificationQuestions: [] }, candidateIds: [] };
      turn++;
      if (turn === 1) {
        assert.equal(operation.researchSession, true);
        assert.match(operation.instruction, /publisherContents[\s\S]*candidateId[\s\S]*sectionPosition/);
        assert.match(operation.instruction, /not yet validated complete sections or legal evidence/);
        const context = operation.input as { unreadCandidates: { id: string; sourceRef: string; readRange?: unknown }[];
          candidateSources: Record<string, { publisherContents: { position: string; title: string }[] }> };
        assert.equal(context.unreadCandidates[0].readRange, undefined);
        assert.equal(context.candidateSources[context.unreadCandidates[0].sourceRef].publisherContents.length, 2);
        return { decision: "research", content: null, gaps: [], actions: [
          { requirementId: "r", candidateId: "c1", sectionPosition: "10" },
          { requirementId: "r", candidateId: "c2", sectionPosition: "10" },
          { requirementId: "r", candidateId: "c2", sectionPosition: "20" },
        ] };
      }
      return { decision: "answer", gaps: [], actions: [], content: { summary: "Rule and procedure", summarySourceIds: ["10", "20"],
        issues: [{ title: "Rule", explanation: "Complete rule and procedure", requirementIds: ["r"], sourceIds: ["10", "20"], actions: [] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" } };
    } }),
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  };
  const result = await runLegalAnswer({ question: "Question", language: "en", format: "short", mode: "fast", actor: { tenantId: "t", userId: "u" },
    history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 60_000 }, ports);
  assert.equal(result.outcome.kind, "answer"); assert.equal(turn, 2); assert.equal(searches, 1);
  assert.deepEqual(reads.sort(), ["10", "20"]);
});

test("later discovery reconciles exact acquired sections while keeping other ranges and editions unread", async () => {
  const scope = { kind: "current" } as const;
  let turn = 0, reads = 0;
  const section = { position: "10", title: "Rules", key: "edition-one-section" };
  const ports: WorkflowPorts = {
    corpus: {
      search: async query => ({ candidates: query === "first" ? ["first"] : ["inside", "outside", "other-edition"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async (ids, _scope, _signal, full) => ids.map(identity => ({ identity,
        sourceUrl: "https://lex.uz/docs/123", language: "en", selectedEditions: [identity === "other-edition" ? "two" : "one"],
        text: identity, truncated: false, publisherContents: [{ position: section.position, title: section.title }],
        ...(full ? { readRange: { key: identity, kind: "provision" as const, language: "en",
          sections: [identity === "outside" ? { ...section, key: "other-section", position: "20" } : section], sourceSections: [section] } } : {}) })),
      resolve: async (_id, _scope, _signal, position) => {
        reads++; assert.equal(position, "10");
        return { identity: "complete-section", snapshot: "fixture", objectKey: "section", sha256: "a".repeat(64), byteCount: 14,
          sourceUrl: "https://lex.uz/docs/123#10", privacyClass: "public_official_source", quarantined: false,
          canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true };
      }, get: async () => Buffer.from("Complete rule."),
    },
    model: legalEntryFixture({ complete: async operation => {
      if (operation.stage === "interpret") return { interpretation: { complexity: "simple", needsClarification: false,
        requirements: [{ id: "r", question: "Rules?" }], queries: ["first"], scopes: [scope], facts: [], clarificationQuestions: [] }, candidateIds: [] };
      if (++turn === 1) return { decision: "research", content: null, gaps: [], actions: [
        { requirementId: "r", candidateId: "c1", sectionPosition: "10" }, { requirementId: "r", query: "second" },
      ] };
      const packet = operation.input as { unreadCandidates: { id: string }[]; evidence: { identity: string }[] };
      assert.deepEqual(packet.unreadCandidates.map(item => item.id), ["c3", "c4"]);
      assert.equal(packet.evidence.length, 1);
      return { decision: "answer", gaps: [], actions: [], content: { summary: "Rule", summarySourceIds: ["complete-section"],
        issues: [{ title: "Rule", explanation: "Complete rule", requirementIds: ["r"], sourceIds: ["complete-section"], actions: [] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" } };
    } }), publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  };
  const result = await runLegalAnswer({ question: "Rules?", language: "en", format: "short", mode: "fast", actor: { tenantId: "t", userId: "u" },
    history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 60_000 }, ports);
  assert.equal(result.outcome.kind, "answer"); assert.equal(reads, 1);
});

test("complete reads beyond former count and byte ceilings remain available for exact selection", () => {
  const inventory = new EvidenceInventory<{ identity: string; text: string }>();
  for (let index = 0; index < 80; index++) {
    inventory.retain({ identity: `rule-${index}`, text: "Complete qualification. ".repeat(1000) });
  }
  assert.equal(inventory.all().length, 80);
  const selected = inventory.select(inventory.all().map(item => item.identity));
  assert.equal(selected.length, 80);
  assert.equal(selected[79].text, "Complete qualification. ".repeat(1000));
  selected[0].text = "Caller mutation";
  assert.equal(inventory.select(["rule-0"])[0].text, "Complete qualification. ".repeat(1000));
});

test("a complete stored provision beyond eight MiB remains readable without an integrity gate", async () => {
  const text = "x".repeat(9 * 1024 * 1024);
  const provision = await readOfficialProvision({ identity: "large", snapshot: "prepared", objectKey: "large",
    sha256: "a".repeat(64), byteCount: text.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source",
    quarantined: false, canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true },
  { get: async () => Buffer.from(text) });
  assert.equal(provision.text, text);
});

test("historical interpretation never discovers current previews and rejects an unreturned choice", async () => {
  let reads = 0;
  const result = await runLegalAnswer({ question: "Which rule applied in 2020?", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 60_000 }, {
    corpus: { search: async (_query, scope) => {
      assert.deepEqual(scope, { kind: "historical", at: "2020-01-01" });
      return { candidates: ["match"], sparseAvailable: true, denseAvailable: true };
    },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: "Preview", truncated: true })),
      resolve: async () => { reads++; return null; }, get: async () => null },
    model: legalEntryFixture({ complete: async ({ stage }) => stage === "interpret" ? { candidateIds: [], interpretation: {
      complexity: "difficult", needsClarification: false, requirements: [{ id: "r", question: "Historical rule?" }], queries: ["historical rule"],
      scopes: [{ kind: "historical", at: "2020-01-01" }], facts: [], clarificationQuestions: [] } }
      : { decision: "research", content: null, gaps: [{ requirementId: "r", description: "Read the law" }], actions: [{ requirementId: "r", candidateId: "unreturned" }] } }),
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(reads, 0);
});

test("terminal delivery closes at the hard stop even when execution ignores cancellation", async () => {
  const disconnected = new AbortController();
  const lifetime = requestLifetime(Date.now(), 50, disconnected.signal);
  const stream = createAnswerEventStream({ lifetime, disconnected, execute: () => new Promise(() => {}) });
  const result = await new Response(stream).text();
  assert.match(result, /REQUEST_DEADLINE/);
  assert.equal(lifetime.signal.aborted, true);
});

test("selecting a conversational time target does not announce legal research", async () => {
  const disconnected = new AbortController();
  const lifetime = requestLifetime(Date.now(), 1000, disconnected.signal);
  const stream = createAnswerEventStream({ lifetime, disconnected, execute: async (target, progress) => {
    target(1000);
    progress("saving");
    return { saved: true };
  } });
  const text = await new Response(stream).text();
  assert.doesNotMatch(text, /researching/);
  assert.match(text, /"stage":"saving"/);
  assert.match(text, /event: result/);
});

test("passing a completion target reports continuing progress without shortening terminal delivery", async () => {
  const disconnected = new AbortController();
  const lifetime = requestLifetime(Date.now(), 1000, disconnected.signal);
  const stream = createAnswerEventStream({ lifetime, disconnected, execute: async (target, progress) => {
    target(20);
    progress("researching");
    await new Promise(resolve => setTimeout(resolve, 60));
    progress("writing");
    return { saved: true };
  } });
  const text = await new Response(stream).text();
  assert.match(text, /"targetMissed":true/);
  assert.match(text, /"stage":"writing"/);
  assert.match(text, /event: result/);
});

test("complete-range choices group chunk matches without merging languages or losing discovery associations", () => {
  const matches = ["a", "b", "translation"].map((identity, index) => ({ identity, id: `c${index + 1}`,
    sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true, query: "rule", queries: ["rule"],
    ranks: [{ query: "rule", rank: index }], scope: { kind: "current" as const },
    readRange: { key: index < 2 ? "same-range" : "translated-range", kind: "provision" as const, language: index < 2 ? "ru" : "uz-Latn" } }));
  const choices = researchCandidates(matches);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].matches.length, 2);
  assert.equal(choices[0].matches[1].identity, "b");
  assert.equal(choices[1].readRange?.language, "uz-Latn");
});

test("follow-up search offers retained choices without automatically reading ranked results", async () => {
  const reads: string[] = [];
  let turn = 0;
  const ports: WorkflowPorts = {
    corpus: {
      search: async query => ({ candidates: query === "targeted exception" ? ["irrelevant", "exception"] : ["initial"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: false })),
      resolve: async identity => { reads.push(identity); return { identity, snapshot: "fixture", objectKey: identity,
        sha256: "a".repeat(64), byteCount: 14, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source",
        quarantined: false, canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true }; },
      get: async () => Buffer.from("Complete rule."),
    },
    model: legalEntryFixture({ complete: async operation => {
      if (operation.stage === "interpret") return { interpretation: { complexity: "simple", needsClarification: false,
        requirements: [{ id: "r", question: "Rule?" }], queries: ["initial"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] }, candidateIds: [] };
      const context = operation.input as { unreadCandidates: { id: string; text: string }[];
        retainedResults: { id: string; query: string; retainedCount: number }[] };
      turn++;
      if (turn === 1) return { decision: "research", content: null, gaps: [{ requirementId: "r", description: "Exception" }], actions: [{ requirementId: "r", query: "targeted exception" }] };
      if (turn === 2) {
        assert.deepEqual(reads, []);
        assert.ok(!context.unreadCandidates.some(item => item.text === "initial"));
        const initial = context.retainedResults.find(item => item.query === "initial")!;
        assert.equal(initial.retainedCount, 1);
        return { decision: "research", content: null, gaps: [{ requirementId: "r", description: "Read exception" }],
          actions: [{ requirementId: "r", candidateId: context.unreadCandidates.find(item => item.text === "exception")!.id },
            { requirementId: "r", resultSetId: initial.id, page: 0 }] };
      }
      assert.ok(context.unreadCandidates.some(item => item.text === "initial"));
      return { decision: "answer", gaps: [], actions: [], content: { summary: "Conditional rule", summarySourceIds: ["exception"],
        issues: [{ title: "Rule", explanation: "Complete conditional rule", requirementIds: ["r"], sourceIds: ["exception"], actions: [] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" } };
    } }),
    publication: { publish: async ({ request, outcome }) => { assert.equal(request.deadlineMs, 60_000); return { answerId: "saved", outcome }; } },
  };
  const result = await runLegalAnswer({ question: "Question", language: "en", format: "short", mode: "fast", actor: { tenantId: "t", userId: "u" },
    history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 60_000 }, ports);
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(reads, ["exception"]);
});

test("discovery retains every returned match and association despite a failed description batch", async () => {
  const corpus: WorkflowPorts["corpus"] = {
    search: async () => ({ candidates: Array.from({ length: 160 }, (_, i) => `match-${i}`), sparseAvailable: true, denseAvailable: true }),
    describeCandidates: async ids => {
      if (ids.includes("match-24")) throw new Error("Temporary metadata failure");
      return ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true }));
    }, resolve: async () => null, get: async () => null,
  };
  const candidates = await discoverReadCandidates({ corpus, interpretation: { queries: ["rule", "exception"], scopes: [{ kind: "current" }] },
    signal: AbortSignal.timeout(3000), searches: new Set(), failures: [], limits: [] });
  assert.equal(candidates.length, 160);
  assert.deepEqual(candidates.find(item => item.identity === "match-159")?.queries.sort(), ["exception", "rule"]);
  assert.ok(candidates.some(item => item.identity === "match-24"));
});
