import assert from "node:assert/strict";
import test from "node:test";
import { runCompleteReadFixture as runLegalAnswer } from "./helpers/complete-read-agent";
import type { LegalRequest, WorkflowPorts, WrittenAnswer } from "../lib/legal-answer-workflow/contracts";

const request = (): LegalRequest => ({ question: "Does the artificial public event need a permit?", language: "en",
  format: "short", mode: "fast", submittedAt: Date.now(), deadlineMs: 30_000,
  actor: { tenantId: "a", userId: "b" }, history: [], privateDocuments: [] });
const interpretation = { complexity: "difficult", needsClarification: false,
  requirements: [{ id: "permit", question: "Permit rule and exceptions?" }], queries: ["public event permit"],
  scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
const answer: WrittenAnswer = { summary: "Public events need a permit; private gatherings are exempt.",
  summarySourceIds: ["rule", "exception"], issues: [{ title: "Permit", explanation: "Public events need a permit; private gatherings are exempt.",
    requirementIds: ["permit"], sourceIds: ["rule", "exception"], actions: [] }],
  conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
  clarificationQuestions: [], urgency: "normal" };

for (const available of [false, true]) test(`automatic discovery never loads whole sources implicitly (${available})`, async () => {
  const reads: string[] = [];
  await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "document",
      search: async () => ({ candidates: ["rule", ...Array.from({ length: 12 }, (_, index) => `sibling-${index}`), "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity,
        sourceUrl: `https://lex.uz/docs/${identity === "exception" ? "456" : "123"}`,
        language: "en", text: "Navigation", truncated: true })),
      resolveDocument: async identity => { reads.push(`document:${identity}`); return available ? locator(identity) : null; },
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity).sort(), []);
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "ranked-documents", outcome }) },
  });
  assert.deepEqual(reads, []);
});

test("automatic section completion never satisfies a different requested temporal scope", async () => {
  const reads: string[] = [];
  await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "section",
      search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        language: "en", text: "Navigation", truncated: false, readRange: { key: identity, kind: "provision" as const,
          language: "en", sections: [{ key: "same-section", position: "10", title: "Procedure" }] } })),
      resolve: async (_identity, scope, _signal, position) => {
        assert.equal(position, "10"); reads.push(scope.kind);
        return { ...locator(scope.kind), ...(scope.kind === "historical"
          ? { temporalState: "historical_only" as const, applicableAt: scope.at } : {}) };
      }, get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, scopes: [{ kind: "current" }, { kind: "historical", at: "2020-01-01" }] };
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity).sort(), ["current", "historical"]);
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "scoped-sections", outcome }) },
  });
  assert.deepEqual(reads, ["current", "historical"]);
});

for (const sectionAvailable of [false, true]) test(`automatic enclosing reads retain complete law and recover unavailable boundaries (available: ${sectionAvailable})`, async () => {
  const reads: (string | undefined)[] = [];
  await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "section",
      search: async () => ({ candidates: ["rule", "sibling"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        language: "en", text: "Navigation", truncated: false, readRange: { key: identity, kind: "provision" as const,
          language: "en", sections: [{ key: "section", position: "10", title: "Procedure and conditions" }] } })),
      resolve: async (identity, _scope, _signal, position) => {
        reads.push(position);
        return position ? sectionAvailable ? locator("section") : null : locator(identity);
      }, get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const packet = input as { evidence: { identity: string; text: string }[] };
      assert.deepEqual(packet.evidence.map(item => [item.identity, item.text]),
        (sectionAvailable ? ["section"] : ["rule", "sibling"]).map(identity => [identity, `Complete artificial law: ${identity}`]));
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "enclosing", outcome }) },
  });
  assert.deepEqual(reads, sectionAvailable ? ["10"] : ["10", undefined, undefined]);
});

for (const reason of ["repealed", "dated_url", "dated_metadata"])
for (const historical of [false, true]) test(`automatic reads prefer current navigation without removing ${reason} matches (historical: ${historical})`, async () => {
  const reads: string[] = [];
  await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async () => ({ candidates: ["expired", "rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: `https://lex.uz/docs/${identity === "expired" ? "123" : "456"}${identity === "expired" && reason === "dated_url" ? "?ONDATE=01.01.1999" : ""}`,
        ...(identity === "expired" && reason === "dated_metadata" ? { requestedEdition: "01.01.1999" } : {}),
        language: "ru", text: "Navigation", truncated: false,
        sourceNotes: identity === "expired" && reason === "repealed" ? ["Акт утратил силу 01.01.2000"] : [],
        readRange: { key: identity, kind: "provision" as const, language: "ru" } })),
      resolve: async identity => { reads.push(identity); return { ...locator(identity),
        ...(historical ? { temporalState: "historical_only" as const, applicableAt: "1999-01-01" } : {}) }; },
      get: async key => Buffer.from(`Complete artificial rule: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation,
        scopes: historical ? [{ kind: "historical", at: "1999-01-01" }] : interpretation.scopes };
      const packet = input as { unreadCandidates: { id: string }[] };
      assert.ok(packet.unreadCandidates.some(item => item.id === (historical ? "c2" : "c1")), "Other authority remains available");
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "status-priority", outcome }) },
  });
  assert.deepEqual(reads, [historical ? "expired" : "rule"]);
});

test("initial complete reads reconcile matching navigation before the first research decision", async () => {
  let decisions = 0;
  await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule", "other1", "other2", "alias"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async (ids, _scope, _signal, full) => ids.map(identity => ({ identity,
        sourceUrl: "https://lex.uz/docs/123", language: "en", text: "Navigation", truncated: false,
        ...(full ? { readRange: { key: identity === "alias" ? "rule" : identity, kind: "provision" as const, language: "en" } } : {}) })),
      resolve: async identity => locator(identity), get: async key => Buffer.from(`Complete artificial rule: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      decisions++;
      assert.ok(!(input as { unreadCandidates: { id: string }[] }).unreadCandidates.some(item => item.id === "c4"));
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "reconciled", outcome }) },
  });
  assert.equal(decisions, 1);
});

for (const concurrency of [3, 4]) test(`independent research starts queued work with ${concurrency} configured workers`, async () => {
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  let turns = 0, active = 0, maximum = 0, fourthStarted = false, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; release(); }, 1000);
  try {
    await runLegalAnswer(request(), {
      corpus: { automaticReadLimit: 3, researchConcurrency: concurrency,
        search: async query => {
          if (query.startsWith("followup")) {
            maximum = Math.max(maximum, ++active);
            if (query === "followup4") { fourthStarted = true; release(); }
            if (query === "followup1" || query === "followup2" || (query === "followup3" && concurrency === 4)) {
              await slow;
              assert.equal(fourthStarted, true, "Queued search must start before slow searches finish");
            }
            active--;
          }
          return { candidates: ["rule"], sparseAvailable: true, denseAvailable: true };
        },
        describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
          text: "Synthetic navigation", truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
        resolve: async identity => locator(identity), get: async key => Buffer.from(`Complete artificial rule: ${key}`) },
      model: { complete: async ({ stage }) => stage === "interpret" ? interpretation : ++turns === 1
        ? { decision: "research", content: null, gaps: [], actions: [1, 2, 3, 4].map(n => ({ requirementId: "permit", query: `followup${n}` })) }
        : { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] } },
      publication: { publish: async ({ outcome }) => ({ answerId: "workers", outcome }) },
    });
    assert.equal(fourthStarted, true);
    assert.equal(timedOut, false, "All configured workers must run before the fallback timeout");
    assert.equal(maximum, concurrency);
  } finally { clearTimeout(timer); release(); }
});

test("a new empty research query is returned to the agent before choosing an alternative", async () => {
  const searches: string[] = [];
  let turns = 0;
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 3, automaticReadScope: "provision",
      search: async query => { searches.push(query); return {
        candidates: query === "first exception formulation" ? [] : query === "alternative exception formulation" ? ["exception"] : ["rule"],
        sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: "Synthetic navigation", truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      resolve: async identity => locator(identity), get: async key => Buffer.from(`Complete artificial rule: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      turns++;
      if (turns === 2) {
        const results = (input as { retainedResults: { query: string; retainedCount: number }[] }).retainedResults;
        assert.equal(results.find(item => item.query === "first exception formulation")?.retainedCount, 0);
      }
      if (turns <= 2) return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "permit",
        query: turns === 1 ? "first exception formulation" : "alternative exception formulation" }] };
      if (turns === 3) return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "permit",
        candidateId: (input as { unreadCandidates: { id: string }[] }).unreadCandidates[0].id }] };
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "alternative-search", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(turns, 4);
  assert.deepEqual(searches, ["public event permit", "first exception formulation", "alternative exception formulation"]);
});

test("distinct empty searches still stop at the existing research bound", async () => {
  let turns = 0, searches = 0;
  const result = await runLegalAnswer(request(), {
    corpus: { search: async () => { searches++; return { candidates: [], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => null, get: async () => null },
    model: { complete: async ({ stage }) => stage === "interpret" ? interpretation : {
      decision: "research", content: null, gaps: [],
      actions: [{ requirementId: "permit", query: `new formulation ${++turns}` }],
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "bounded-empty-research", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(searches, 7, "Initial search plus six bounded recovery searches");
  assert.equal(turns, 7, "The final turn may judge sufficiency but cannot launch further research");
});

for (const listFirst of [true, false]) test(`retained results remain readable after a new query (list first: ${listFirst})`, async () => {
  let turn = 0, searches = 0;
  const reads: string[] = [];
  let firstNavigation: unknown;
  const result = await runLegalAnswer(request(), {
    corpus: {
      search: async query => { searches++; return { candidates: query === "another topic" ? ["other"] : ["rule", "exception"],
        sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: `Complete-read preview ${identity}`, truncated: true, sourceNotes: ["Retained status notice"],
        selectedEditions: ["2020-01-01"], language: "en" })),
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { unreadCandidates: { id: string }[]; retainedResults: { id: string; query: string; retainedCount: number }[];
        candidateQueries: Record<string, string>; evidence: { identity: string }[] };
      const action = (value: object) => ({ decision: "research", content: null, gaps: [], actions: [{ requirementId: "permit", ...value }] });
      turn++;
      if (turn === 1) { firstNavigation = context.unreadCandidates[1]; return action({ candidateId: "c1" }); }
      if (turn === 2) return action({ query: "another topic" });
      if (turn === 3) {
        assert.deepEqual(context.unreadCandidates.map(item => item.id), ["c3"]);
        assert.deepEqual(context.retainedResults.map(item => [item.query, item.retainedCount]), [["public event permit", 2], ["another topic", 1]]);
        assert.equal(context.candidateQueries.q1, "public event permit");
        assert.equal(context.candidateQueries.q2, "another topic");
        assert.deepEqual(context.evidence.map(item => item.identity), ["rule"]);
        return listFirst ? action({ resultSetId: context.retainedResults[0].id, page: 0 }) : action({ candidateId: "c2" });
      }
      if (listFirst && turn === 4) {
        assert.equal(searches, 2); assert.deepEqual(reads, ["rule"]);
        assert.deepEqual(context.unreadCandidates, [firstNavigation]);
        return action({ candidateId: "c2" });
      }
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "retained-navigation", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer"); assert.equal(searches, 2);
  assert.deepEqual(reads, ["rule", "exception"]);
});

test("listing an already visible page stops without another search or complete read", async () => {
  let searches = 0, turns = 0;
  const result = await runLegalAnswer(request(), {
    corpus: { search: async () => { searches++; return { candidates: ["rule"], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: "Preview", truncated: true })),
      resolve: async () => { throw new Error("NO_READ_EXPECTED"); }, get: async () => { throw new Error("NO_READ_EXPECTED"); } },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      turns++;
      const context = input as { retainedResults: { id: string }[] };
      return { decision: "research", content: null, gaps: [],
        actions: [{ requirementId: "permit", resultSetId: context.retainedResults[0].id, page: 0 }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "repeated-list", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence"); assert.equal(searches, 1); assert.equal(turns, 1);
});

test("automatic research leaves introductory reads to explicit selection", async () => {
  const adjacent: string[] = [];
  const article = (identity: string) => ({ ...locator(identity), sourceStructure: {
    navigationOnly: true as const, rangeKind: "article" as const, rangeTitle: identity,
    anchor: { position: identity, ordinal: 1, language: "en" }, headings: [],
  } });
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: "Relevant rule", truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      resolve: async identity => article(identity),
      resolveIntroductory: async (identity, scope) => {
        adjacent.push(identity);assert.deepEqual(scope, { kind: "current" });
        return article("exception");
      }, get: async key => Buffer.from(`Complete artificial provision with all qualifications: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const evidence = (input as { evidence: { identity: string; text: string }[] }).evidence;
      assert.deepEqual(evidence.map(item => item.identity), ["rule"]);
      assert.equal(evidence[0].text, "Complete artificial provision with all qualifications: rule");
      return { decision: "answer", content: { ...answer, summarySourceIds: ["rule"], issues: [{ ...answer.issues[0], sourceIds: ["rule"] }] }, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-neighbors", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(adjacent, []);
});

test("automatic research leaves neighboring reads to explicit selection", async () => {
  const adjacent: string[] = [];
  const article = (identity: string) => ({ ...locator(identity), sourceStructure: {
    navigationOnly: true as const, rangeKind: "article" as const, rangeTitle: identity,
    anchor: { position: identity, ordinal: 1, language: "en" }, headings: [],
  } });
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: "Relevant rule", truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      resolve: async identity => article(identity),
      resolveAdjacent: async (identity, direction, scope) => {
        adjacent.push(`${identity}:${direction}`);assert.deepEqual(scope, { kind: "current" });
        return direction === "next" ? article("exception") : article("rule");
      }, get: async key => Buffer.from(`Complete artificial provision with all qualifications: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const evidence = (input as { evidence: { identity: string; text: string }[] }).evidence;
      assert.deepEqual(evidence.map(item => item.identity), ["rule"]);
      assert.equal(evidence[0].text, "Complete artificial provision with all qualifications: rule");
      return { decision: "answer", content: { ...answer, summarySourceIds: ["rule"], issues: [{ ...answer.issues[0], sourceIds: ["rule"] }] }, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-neighbors", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(adjacent, []);
});

test("distinct language parents retain primary evidence without implicit opening reads", async () => {
  const roots: string[] = [], adjacent: string[] = [];
  const article = (identity: string) => ({ ...locator(identity), sourceStructure: {
    navigationOnly: true as const, rangeKind: "article" as const, rangeTitle: identity,
    anchor: { position: identity, ordinal: 1, language: identity.endsWith("-extra") ? "ru" : "en" },
    headings: [{ position: identity, ordinal: 1, language: "en", text: "Article", hierarchy: ["Shared heading"] }],
  } });
  const queries = ["first"];
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
      search: async query => ({ candidates: [query, query + "-extra"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: identity, truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      resolve: async identity => { roots.push(identity);return article(identity); },
      resolveIntroductory: async identity => {
        assert.deepEqual(roots, queries.flatMap(query => [query, query + "-extra"]));
        adjacent.push(identity);
        if (identity.endsWith("-extra")) throw new Error("Source unavailable");
        return null;
      }, get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, queries };
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity), roots);
      const content = { ...answer, summarySourceIds: roots,
        issues: [{ ...answer.issues[0], sourceIds: roots }] };
      return { decision: "answer", content, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-parents", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(adjacent, []);
});

test("query formulations share one automatic read allowance without introductory expansion", async () => {
  const roots: string[] = [], adjacent: string[] = [];
  const article = (identity: string) => ({ ...locator(identity), sourceStructure: {
    navigationOnly: true as const, rangeKind: "article" as const, rangeTitle: identity,
    anchor: { position: identity, ordinal: 1, language: "en" }, headings: [],
  } });
  const queries = ["first", "second", "third", "fourth"];
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
      search: async query => ({ candidates: [query, query + "-extra"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: identity, truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      resolve: async identity => { roots.push(identity);return article(identity); },
      resolveIntroductory: async identity => {
        assert.deepEqual(roots, queries.flatMap(query => [query, query + "-extra"]));
        adjacent.push(identity);
        if (identity.endsWith("-extra")) throw new Error("Source unavailable");
        return null;
      }, get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, queries };
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity), roots);
      const content = { ...answer, summarySourceIds: roots,
        issues: [{ ...answer.issues[0], sourceIds: roots }] };
      return { decision: "answer", content, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-parents", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(adjacent.length, 0);
  assert.deepEqual(roots, ["first", "second"]);
});

test("additional search formulations remain navigation after the automatic allowance is exhausted", async () => {
  const roots: string[] = [], adjacent: string[] = [];
  const article = (identity: string) => ({ ...locator(identity), sourceStructure: {
    navigationOnly: true as const, rangeKind: "article" as const, rangeTitle: identity,
    anchor: { position: identity, ordinal: 1, language: "en" }, headings: [],
  } });
  const queries = ["first", "second", "third", "fourth"];
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async query => ({ candidates: [query], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: identity, truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      resolve: async identity => { roots.push(identity);return article(identity); },
      resolveAdjacent: async (identity, direction) => {
        assert.deepEqual(roots, queries);
        adjacent.push(`${identity}:${direction}`);
        if (direction === "previous") throw new Error("Source unavailable");
        return null;
      }, get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, queries };
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity), roots);
      const content = { ...answer, summarySourceIds: roots,
        issues: [{ ...answer.issues[0], sourceIds: roots }] };
      return { decision: "answer", content, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-parents", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(adjacent.length, 0);
  assert.deepEqual(roots, ["first"]);
});

for (const neighbor of ["oversized", "uncertain"]) {
test(`an ${neighbor} unselected neighbor does not expand the retained context`, async () => {
  const article = (identity: string) => ({ ...locator(identity), sourceStructure: {
    navigationOnly: true as const, rangeKind: "article" as "article" | "document", rangeTitle: identity,
    anchor: { position: identity, ordinal: 1, language: "en" }, headings: [],
  } });
  let neighborRead = false;
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: identity, truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      resolve: async identity => article(identity),
      resolveAdjacent: async (_identity, direction) => direction === "previous" ? null : {
        ...article("neighbor"), sourceStructure: { ...article("neighbor").sourceStructure,
          rangeKind: neighbor === "uncertain" ? "document" : "article" } },
      get: async key => {
        if (key === "neighbor") neighborRead = true;
        return Buffer.from(key === "neighbor" && neighbor === "oversized" ? "Complete rule. ".repeat(30_000) : `Complete artificial provision: ${key}`);
      },
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const evidence = (input as { evidence: { identity: string; text: string }[] }).evidence;
      assert.deepEqual(evidence.map(item => item.identity), ["rule"]);
      assert.equal(evidence[0].text, "Complete artificial provision: rule");
      return { decision: "answer", content: { ...answer, summarySourceIds: ["rule"],
        issues: [{ ...answer.issues[0], sourceIds: ["rule"] }] }, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-parent", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");assert.equal(neighborRead, false);
});
}

test("a section from another candidate is rejected with repair feedback while independent reads continue", async () => {
  const reads: string[] = [];
  let turns = 0;
  const result = await runLegalAnswer(request(), {
    corpus: {
      search: async () => ({ candidates: ["rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: identity, truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en",
          sourceSections: [{ key: `${identity}-section`, position: `${identity}-position`, title: identity }] } })),
      resolve: async (identity, _scope, _signal, position) => {
        assert.equal(position, `${identity}-position`);
        reads.push(identity); return locator(identity);
      }, get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      turns++;
      if (turns === 1) return { decision: "research", content: null, gaps: [], actions: [
        { requirementId: "permit", candidateId: "c1", sectionPosition: "exception-position" },
        { requirementId: "permit", candidateId: "c2", sectionPosition: "exception-position" },
      ] };
      if (turns === 2) {
        assert.deepEqual(reads, ["exception"]);
        assert.match(JSON.stringify(input), /RECOVERY_SECTION_NOT_OFFERED/);
        return { decision: "research", content: null, gaps: [], actions: [
          { requirementId: "permit", candidateId: "c1", sectionPosition: "rule-position" },
        ] };
      }
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-repaired", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(reads, ["exception", "rule"]);
  assert.equal(turns, 3);
});

test("repeating an unoffered section stops without reading it or spending every research turn", async () => {
  let turns = 0;
  const result = await runLegalAnswer(request(), {
    corpus: {
      search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: "Preview", truncated: true })),
      resolve: async () => { throw new Error("Unoffered section must never be read"); },
      get: async () => { throw new Error("No evidence object was acquired"); },
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      if (++turns === 2) assert.match(JSON.stringify(input), /RECOVERY_SECTION_NOT_OFFERED/);
      return { decision: "research", content: null, gaps: [], actions: [
        { requirementId: "permit", candidateId: "c1", sectionPosition: "not-offered" },
      ] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-unavailable", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(turns, 2);
});

test("requesting an already-read candidate supplies feedback without discarding usable evidence", async () => {
  let turns = 0;
  const reads: string[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: {
      search: async () => ({ candidates: ["rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: identity, truncated: true })),
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      if (++turns <= 2) return { decision: "research", content: null, gaps: [],
        actions: (turns === 1 ? ["c1", "c2"] : ["c1"]).map(candidateId => ({ requirementId: "permit", candidateId })) };
      assert.match(JSON.stringify(input), /RECOVERY_CANDIDATE_ALREADY_ATTEMPTED/);
      assert.deepEqual(reads, ["rule", "exception"]);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-existing-evidence", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(turns, 3);
});

for (const failure of ["lookup", "description"] as const) test(`literal ${failure} failure preserves independent reads and retained matches`, async () => {
  let turn = 0;
  const reads: string[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: {
      search: async () => ({ candidates: ["rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => {
        if (ids.includes("found")) throw new Error("Synthetic private backend message");
        return ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true }));
      },
      findInSource: async () => {
        if (failure === "lookup") throw new Error("Synthetic private backend message");
        return ["found"];
      },
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      if (++turn === 1) return { decision: "research", content: null, gaps: [], actions: [
        { requirementId: "permit", candidateId: "c1", contains: "Another heading" },
        { requirementId: "permit", candidateId: "c1" }, { requirementId: "permit", candidateId: "c2" }] };
      assert.deepEqual(reads, ["rule", "exception"]);
      assert.match(JSON.stringify(input), failure === "lookup" ? /SOURCE_LOOKUP_UNAVAILABLE/ : /CATALOG_READ_UNAVAILABLE/);
      assert.doesNotMatch(JSON.stringify(input), /Synthetic private backend message/);
      if (failure === "description") assert.match(JSON.stringify(input), /"id":"c3"/);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-literal-failure", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(turn, 2);
});

test("literal matches after a complete read retain independent unread ranges", async () => {
  let turn = 0;
  const reads: string[] = [];
  await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async (ids, _scope, _signal, navigation) => ids.map(identity => ({
        identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true,
        ...(navigation ? { readRange: { key: identity, kind: "provision" as const, language: "en" } } : {}),
      })),
      findInSource: async () => ["exception", "unread-exception"],
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`),
    },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { unreadCandidates: { id: string; text: string; readRange?: unknown; navigationOnly?: boolean }[] };
      turn++;
      const action = (value: object) => ({ decision: "research", content: null, gaps: [],
        actions: [{ requirementId: "permit", ...value }] });
      if (turn === 1) {
        assert.deepEqual(reads, ["rule"]);
        return action({ candidateId: "c1", contains: "exception" });
      }
      if (turn === 2) {
        assert.equal(context.unreadCandidates.length, 2);
        assert.ok(context.unreadCandidates.every(candidate => candidate.readRange !== undefined));
        return action({ candidateId: context.unreadCandidates[0].id });
      }
      assert.equal(context.unreadCandidates.length, 1);
      assert.equal(context.unreadCandidates[0].id, "c3");
      assert.equal(context.unreadCandidates[0].text, "unread-exception");
      assert.notEqual(context.unreadCandidates[0].navigationOnly, true);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-literal", outcome }) },
  });
  assert.equal(turn, 3);
  assert.deepEqual(reads, ["rule", "exception"]);
});

test("one agent chooses complete reads directly without a required gap report before writing", async () => {
  const reads: string[] = [], stages: string[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: { search: async () => ({ candidates: ["unrelated", "rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: `Incomplete discovery preview: ${identity}`, truncated: true })),
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      stages.push(stage);
      if (stage === "interpret") {
        assert.deepEqual(reads, []);
        assert.equal("unreadCandidates" in (input as object), false);
        return interpretation;
      }
      assert.equal(stage, "write");
      const context = input as { evidence: { identity: string }[]; unreadCandidates: { id: string; text: string }[] };
      if (!context.evidence.length) {
        assert.deepEqual(reads, []);
        return { decision: "research", content: null, gaps: [],
          actions: context.unreadCandidates.filter(item => !item.text.endsWith("unrelated"))
            .map(item => ({ requirementId: "permit", candidateId: item.id })) };
      }
      assert.deepEqual(context.evidence.map(item => item.identity), ["rule", "exception"]);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(stages, ["interpret", "write", "write"]);
  assert.deepEqual(reads, ["rule", "exception"]);
});

test("ranked search can return complete provisions directly while uncertain document ranges stay navigation", async () => {
  const stages: string[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
      search: async () => ({ candidates: ["unreadable-one", "unreadable-two", "uncertain", "rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true,
        readRange: { key: identity, kind: identity === "uncertain" ? "document" : "provision", language: "en" } })),
      resolve: async identity => { assert.notEqual(identity, "uncertain"); return identity.startsWith("unreadable") ? null : locator(identity); },
      get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      stages.push(stage);
      if (stage === "interpret") return interpretation;
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity), ["rule", "exception"]);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-hydrated", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(stages, ["interpret", "write"]);
});

test("complete section candidates retain all acquired law regardless of serialized byte size", async () => {
  const largeText = "Complete artificial section and all safeguards. ".repeat(20_000);
  const reads: string[] = [];
  let turns = 0;
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
      search: async () => ({ candidates: ["broad", "rule", "duplicate", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true,
        readRange: { key: identity, kind: identity === "duplicate" ? "provision" as const : "section" as const, language: "en",
          ...(["rule", "duplicate"].includes(identity)
            ? { sections: [{ key: "rule", position: "10", title: "Complete rule section" }] } : {}) } })),
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(key.includes("broad") ? largeText : `Complete section with all safeguards: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { evidence: { identity: string; text: string }[];
        availableSections: { sectionPosition: string }[] };
      const evidence = context.evidence;
      if (++turns === 1) {
        assert.deepEqual(evidence.map(item => item.identity), ["broad", "rule"]);
        assert.equal(evidence[0].text, largeText);
        assert.equal(reads.includes("duplicate"), false);
        assert.equal(context.availableSections.some(section => section.sectionPosition === "10"), false);
        return { decision: "research", content: null, gaps: [],
          actions: [{ requirementId: "permit", candidateId: "c4" }] };
      }
      assert.equal(evidence.find(item => item.identity === "broad")?.text, largeText);
      assert.equal(reads.filter(identity => identity === "broad").length, 1);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-direct-sections", outcome }) },
  });
  assert.equal(turns, 2);
  assert.equal(result.outcome.kind, "answer");
});

test("a failed matched section does not hide its complete article from automatic acquisition", async () => {
  const reads: string[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
      search: async () => ({ candidates: ["bad-section", "rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity,
        truncated: true, readRange: { key: identity === "bad-section" ? "section" : identity,
          kind: identity === "bad-section" ? "section" as const : "provision" as const, language: "en",
          sections: identity === "rule" ? [{ key: "section", position: "10", title: "Enclosing section" }] : [] } })),
      resolve: async identity => { reads.push(identity); return identity === "bad-section" ? null : locator(identity); },
      get: async key => Buffer.from(`Complete provision with qualifications: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      assert.deepEqual(reads, ["bad-section", "rule", "exception"]);
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity).sort(), ["exception", "rule"]);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-fallback", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
});

test("complex automatic research reads complete matched provisions and leaves wider sections selectable", async () => {
  const reads: string[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 3, automaticReadScope: "provision",
      search: async () => ({ candidates: ["a", "b", "c"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true,
        readRange: { key: identity, kind: "provision" as const, language: "en",
          sections: [{ key: identity === "c" ? "exceptions" : "procedure", position: identity === "c" ? "20" : "10", title: "Complete section" }] } })),
      resolve: async (identity, _scope, _signal, position) => {
        reads.push(`${identity}:${position}`);
        assert.equal(position, undefined);
        return locator(identity === "a" ? "rule" : identity === "b" ? "companion" : "exception");
      }, get: async key => Buffer.from(`Complete provision including its exceptions: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { evidence: { identity: string; text: string }[]; availableSections: unknown[] };
      assert.deepEqual(reads, ["a:undefined", "b:undefined", "c:undefined"]);
      assert.deepEqual(context.evidence.map(item => item.identity), ["rule", "companion", "exception"]);
      assert.ok(context.evidence.every(item => item.text.includes("including its exceptions")));
      assert.equal(context.availableSections.length, 2);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-sections", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
});

test("automatic complete provisions leave even a large enclosing section explicitly readable", async () => {
  const largeText = "Complete artificial section including every qualification. ".repeat(20_000);
  const reads: string[] = [];
  let turns = 0;
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true,
        readRange: { key: identity, kind: "provision" as const, language: "en",
          sections: [{ key: "broad-section", position: "10", title: "Complete broad section" }] } })),
      resolve: async (identity, _scope, _signal, position) => {
        reads.push(`${identity}:${position}`);
        return locator(position ? "broad-section" : identity);
      }, get: async key => Buffer.from(key.includes("broad-section") ? largeText : `Complete provision: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { evidence: { identity: string; text: string }[];
        availableSections: { candidateId: string; sectionPosition: string }[] };
      if (++turns === 1) {
        assert.deepEqual(context.evidence.map(item => item.identity).sort(), ["exception", "rule"]);
        assert.ok(context.evidence.every(item => item.text.startsWith("Complete provision:")));
        assert.ok(context.availableSections.some(item => item.sectionPosition === "10"));
        return { decision: "research", content: null, gaps: [], actions: [
          { requirementId: "permit", candidateId: "c1", sectionPosition: "10" },
        ] };
      }
      assert.equal(context.evidence.find(item => item.identity === "broad-section")?.text, largeText);
      assert.equal(reads.filter(item => item === "rule:10").length, 1);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-complete-fallback", outcome }) },
  });
  assert.equal(turns, 2);
  assert.equal(result.outcome.kind, "answer");
});

for (const scenario of ["simple", "ambiguous", "unavailable", "shared-unavailable", "oversized"] as const) {
  test(`automatic complete article reads do not require enclosing sections when ${scenario}`, async () => {
    const reads: string[] = [];
    const result = await runLegalAnswer(request(), {
      corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
        search: async () => ({ candidates: scenario === "shared-unavailable" ? ["rule", "uncertain", "exception"] : ["rule", "exception"], sparseAvailable: true, denseAvailable: true }),
        describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true,
          readRange: { key: identity, kind: identity === "uncertain" ? "document" as const : "provision" as const, language: "en",
            sections: identity === "rule" || scenario === "shared-unavailable" ? (scenario === "ambiguous" ? ["10", "20"] : ["10"])
              .map(position => ({ key: position, position, title: "Enclosing section" })) : [],
            sourceSections: [{ key: "unrelated", position: "99", title: "Other source chapter" }] } })),
        resolve: async (identity, _scope, _signal, position) => {
          reads.push(`${identity}:${position}`);
          if (position && scenario === "oversized") throw new Error("PROVISION_CONTEXT_BOUND");
          return position ? null : locator(identity);
        }, get: async key => Buffer.from(`Complete original provision: ${key}`),
      }, model: { complete: async ({ stage, input }) => {
        if (stage === "interpret") return { ...interpretation, complexity: scenario === "simple" ? "simple" : "difficult" };
        assert.deepEqual(reads.slice().sort(), ["exception:undefined", "rule:undefined"]);
        assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity).sort(), ["exception", "rule"]);
        return { decision: "answer", content: answer, gaps: [], actions: [] };
      } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-fallback", outcome }) },
    });
    assert.equal(result.outcome.kind, "answer");
  });
}

test("the final synthesis keeps complete law but omits navigation that can no longer be used", async () => {
  let turn = 0;
  const result = await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 2, automaticReadScope: "provision",
      search: async query => ({ candidates: ["rule", "exception", `unread-${query}`], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true,
        readRange: { key: identity, kind: "provision" as const, language: "en", sections: [{ key: "chapter", position: "10", title: "Chapter" }] } })),
      resolve: async identity => locator(identity), get: async key => Buffer.from(`Complete artificial law: ${key}`),
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, complexity: "simple" };
      const context = input as { canResearch: boolean; evidence: { identity: string }[]; unreadCandidates: unknown[]; availableSections: unknown[] };
      if (++turn <= 6) {
        assert.equal(context.canResearch, true);
        if (turn === 1) assert.ok(context.unreadCandidates.length);
        return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "permit", query: `next-${turn}` }] };
      }
      assert.equal(context.canResearch, false);
      assert.deepEqual(context.unreadCandidates, []); assert.deepEqual(context.availableSections, []);
      assert.deepEqual(context.evidence.map(item => item.identity), ["rule", "exception"]);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-final", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer"); assert.equal(turn, 7);
});

for (const distinction of ["none", "range", "language", "position", "heading"]) {
test(`section navigation preserves selectable distinctions while removing duplicate menus (${distinction})`, async () => {
  const reads: (string | undefined)[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: { search: async () => ({ candidates: ["rule", "other-hit"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: "Rule preview", truncated: true, readRange: { key: identity, kind: "provision" as const,
          language: identity === "other-hit" && distinction === "language" ? "ru" : "en",
          sourceSections: [{ key: identity === "other-hit" && distinction === "range" ? "another-version" : "section",
            position: identity === "other-hit" && distinction === "position" ? "99" : "0",
            title: identity === "other-hit" && distinction === "heading" ? "Different heading" : "Chapter A" }] } })),
      resolve: async (id, _scope, _signal, position) => {
        assert.equal(id, position ? "other-hit" : "rule");
        reads.push(position); return locator(position ? "exception" : "rule");
      },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { evidence: unknown[]; unreadCandidates: { id: string; readRange: { sourceSectionsRef: string } }[];
        candidateSourceSections: Record<string, { candidateId: string; sectionPosition: string; title: string }[]>; availableSections: unknown[] };
      if (!context.evidence.length) return { decision: "research", content: null, gaps: [],
        actions: [{ requirementId: "permit", candidateId: "c1" }] };
      if (context.evidence.length === 1) {
        assert.equal(context.availableSections.length, distinction === "none" ? 0 : 1);
        const unread = context.unreadCandidates.find(candidate => candidate.id === "c2")!;
        const [section] = context.candidateSourceSections[unread.readRange.sourceSectionsRef];
        assert.equal(section.title, distinction === "heading" ? "Different heading" : "Chapter A");
        return { decision: "research", content: null, gaps: [],
          actions: [{ requirementId: "permit", candidateId: section.candidateId, sectionPosition: section.sectionPosition }] };
      }
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-section", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(reads, [undefined, distinction === "position" ? "99" : "0"]);
});
}

test("after reading an article the agent can still choose its unread enclosing section", async () => {
  const reads: (string | undefined)[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: { candidateReadScope: "provision", search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async () => [{ identity: "rule", sourceUrl: "https://lex.uz/docs/123", text: "Rule preview", truncated: true,
        readRange: { key: "article", kind: "provision", language: "en", sections: [{ key: "section", position: "0", title: "Chapter A" }] } }],
      resolve: async (_id, _scope, _signal, position) => { reads.push(position); return locator(position ? "exception" : "rule"); },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { evidence: unknown[]; unreadCandidates: { id: string }[];
        availableSections: { candidateId: string; sectionPosition: string; title: string }[] };
      if (!context.evidence.length) return { decision: "research", content: null, gaps: [],
        actions: [{ requirementId: "permit", candidateId: context.unreadCandidates[0].id }] };
      if (context.evidence.length === 1) {
        assert.deepEqual(context.unreadCandidates, []);
        assert.equal(context.availableSections[0].title, "Chapter A");
        return { decision: "research", content: null, gaps: [], actions: [{ requirementId: "permit",
          candidateId: context.availableSections[0].candidateId, sectionPosition: context.availableSections[0].sectionPosition }] };
      }
      assert.deepEqual(context.availableSections, []);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-section", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(reads, [undefined, "0"]);
});

test("a narrower complete read retains its complete parent section in context", async () => {
  const reads: (string | undefined)[] = [];
  let turn = 0;
  const result = await runLegalAnswer(request(), {
    corpus: { candidateReadScope: "provision", automaticReadLimit: 0, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async () => [{ identity: "rule", sourceUrl: "https://lex.uz/docs/123", text: "Synthetic preview", truncated: true,
        readRange: { key: "article", kind: "provision", language: "en", sections: [{ key: "chapter", position: "10", title: "Chapter" }] } }],
      resolve: async (_id, _scope, _signal, position) => { reads.push(position); return locator(position ? "exception" : "rule"); },
      get: async key => Buffer.from(`Complete artificial provision: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      turn++;
      if (turn === 1) return { decision: "research", content: null, gaps: [],
        actions: [{ requirementId: "permit", candidateId: "c1", wholeSection: true }] };
      if (turn === 2) return { decision: "research", content: null, gaps: [],
        actions: [{ requirementId: "permit", candidateId: "c1" }] };
      assert.deepEqual((input as { evidence: { identity: string }[] }).evidence.map(item => item.identity), ["exception", "rule"]);
      return { decision: "answer", content: { ...answer, summarySourceIds: ["rule"],
        issues: answer.issues.map(issue => ({ ...issue, sourceIds: ["rule"] })) }, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "narrow-complete-context", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(reads, ["10", undefined]);
});

for (const separation of ["language", "source", "edition", "scope"]) test(`selected enclosing reads preserve ${separation} boundaries`, async () => {
  const reads: string[] = [];
  let turn = 0;
  await runLegalAnswer(request(), {
    corpus: { candidateReadScope: "section",
      search: async (_query, scope) => ({ candidates: separation === "scope" ? [scope.kind] : ["rule", "sibling"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity,
        sourceUrl: `https://lex.uz/docs/${separation === "source" && identity === "sibling" ? "456" : "123"}`,
        ...(separation === "edition" ? { selectedEditions: [identity === "sibling" ? "2021-01-01" : "2020-01-01"] } : {}),
        text: "Navigation", truncated: true, readRange: { key: identity, kind: "provision" as const,
          language: separation === "language" && identity === "sibling" ? "uz" : "en",
          sections: [{ key: "shared-local-key", position: "10", title: "Procedure" }] } })),
      resolve: async (identity, scope, _signal, position) => {
        assert.equal(position, "10"); reads.push(identity);
        return { ...locator(identity), ...(scope.kind === "historical"
          ? { temporalState: "historical_only" as const, applicableAt: scope.at } : {}) };
      }, get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, ...(separation === "scope"
        ? { scopes: [{ kind: "current" }, { kind: "historical", at: "2020-01-01" }] } : {}) };
      if (++turn === 1) return { decision: "research", content: null, gaps: [],
        actions: ["c1", "c2"].map(candidateId => ({ requirementId: "permit", candidateId })) };
      assert.equal((input as { evidence: unknown[] }).evidence.length, 2);
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "selected-boundaries", outcome }) },
  });
  assert.deepEqual(reads.sort(), separation === "scope" ? ["current", "historical"] : ["rule", "sibling"]);
});

for (const scenario of ["shared", "language", "edition", "source", "unavailable"]) test(`selected whole documents preserve complete context and boundaries (${scenario})`, async () => {
  const reads: string[] = [];
  let turn = 0;
  await runLegalAnswer(request(), {
    corpus: { candidateReadScope: "section",
      search: async () => ({ candidates: ["rule", "sibling"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async ids => ids.map(identity => ({ identity,
        sourceUrl: `https://lex.uz/docs/${scenario === "source" && identity === "sibling" ? "456" : "123"}`,
        selectedEditions: [scenario === "edition" ? identity : "same"], text: "Navigation", truncated: true,
        readRange: { key: identity, kind: "provision" as const, language: scenario === "language" ? identity : "en" } })),
      resolveDocument: async identity => {
        reads.push(`document:${identity}`);
        return scenario === "unavailable" ? null : locator(scenario === "shared" ? "document" : identity);
      },
      resolve: async identity => { reads.push(identity); return locator(identity); },
      get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      if (++turn === 1) return { decision: "research", content: null, gaps: [],
        actions: ["c1", "c2"].map(candidateId => ({ requirementId: "permit", candidateId, wholeDocument: true })) };
      const packet = input as { evidence: { identity: string; text: string }[] };
      assert.deepEqual(packet.evidence.map(item => [item.identity, item.text]).sort(),
        (scenario === "unavailable" ? [] : scenario === "shared" ? ["document"] : ["rule", "sibling"]).map(identity => [identity, `Complete artificial law: ${identity}`]).sort());
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "document-context", outcome }) },
  });
  assert.deepEqual(reads.sort(), scenario === "shared" ? ["document:rule"] : scenario === "unavailable"
    ? ["document:rule"] : ["document:rule", "document:sibling"]);
});

for (const boundary of ["single", "ambiguous", "missing", "unavailable"])
for (const sectionAvailable of [false, true]) test(`selected articles acquire their enclosing context with independent fallback (${boundary}, available: ${sectionAvailable})`, async () => {
  const reads: string[] = [];
  let turn = 0;
  await runLegalAnswer(request(), {
    corpus: { candidateReadScope: "section",
      search: async () => ({ candidates: ["rule", "sibling"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async (ids, _scope, _signal, navigation) => {
        if (boundary === "unavailable" && navigation) throw new Error("Navigation unavailable");
        return ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
          language: "en", text: "Navigation", truncated: true,
          ...(boundary === "unavailable" ? {} : { readRange: { key: identity, kind: "provision" as const,
            language: "en", sections: (boundary === "single" ? ["10"] : boundary === "ambiguous" ? ["10", "20"] : [])
              .map(position => ({ key: `section-${position}`, position, title: "Procedure and conditions" })) } }) }));
      },
      resolve: async (identity, _scope, _signal, position) => {
        reads.push(position ?? identity);
        return position ? sectionAvailable ? locator("section") : null : locator(identity);
      }, get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      if (++turn === 1) return { decision: "research", content: null, gaps: [],
        actions: ["c1", "c2"].map(candidateId => ({ requirementId: "permit", candidateId })) };
      const packet = input as { evidence: { identity: string; text: string }[] };
      assert.deepEqual(packet.evidence.map(item => [item.identity, item.text]).sort(),
        (sectionAvailable && boundary === "single" ? ["section"] : ["rule", "sibling"]).map(identity => [identity, `Complete artificial law: ${identity}`]).sort());
      return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "permit", description: "Fixture complete" }] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "selected-context", outcome }) },
  });
  assert.deepEqual(reads.sort(), boundary === "single" ? sectionAvailable ? ["10"] : ["10", "rule", "sibling"] : ["rule", "sibling"]);
});

test("the agent can request the complete enclosing section on its first candidate selection", async () => {
  for (const positions of [["0"], [], ["0", "1"]]) {
  const reads: (string | undefined)[] = [];
  const result = await runLegalAnswer(request(), {
    corpus: { search: async () => ({ candidates: positions.length === 1 ? ["rule", "other-hit"] : ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async (ids, _scope, _signal, navigation) => ids.map(identity => ({ identity,
        sourceUrl: "https://lex.uz/docs/123", text: "Rule and safeguards", truncated: true,
        ...(navigation ? { readRange: { key: "article", kind: "provision" as const, language: "en",
          sections: positions.map(position => ({ key: `section-${position}`, position, title: "Complete permit procedure" })) } } : {}) })),
      resolve: async (_id, _scope, _signal, position) => { reads.push(position); return locator("rule"); },
      get: async () => Buffer.from("Complete permit rule and every exception in its enclosing section.") },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { evidence: unknown[] };
      if (!context.evidence.length) return { decision: "research", content: null, gaps: [],
        actions: (positions.length === 1 ? ["c1", "c2"] : ["c1"]).map(candidateId => ({ requirementId: "permit", candidateId, wholeSection: true })) };
      return { decision: "answer", content: { ...answer, summarySourceIds: ["rule"],
        issues: answer.issues.map(issue => ({ ...issue, sourceIds: ["rule"] })) }, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved-section-batch", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(reads, [positions.length === 1 ? "0" : undefined]);
  }
});

test("literal matches in an unread source keep fresh distinguishing previews", async () => {
  let turn = 0;
  await runLegalAnswer(request(), {
    corpus: { automaticReadLimit: 1, automaticReadScope: "provision",
      search: async () => ({ candidates: ["rule", "other-source"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async (ids, _scope, _signal, navigation) => ids.map(identity => ({ identity,
        sourceUrl: `https://lex.uz/docs/${identity === "rule" ? "123" : "456"}`,
        text: `Distinguishing text ${identity}`, truncated: true,
        ...(navigation ? { readRange: { key: identity, kind: "provision" as const, language: "en" } } : {}) })),
      resolve: async identity => locator(identity), get: async key => Buffer.from(`Complete artificial ${key}`),
      findInSource: async () => ["first-match", "second-match"],
    }, model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      if (++turn === 1) return { decision: "research", content: null, gaps: [],
        actions: [{ requirementId: "permit", candidateId: "c2", contains: "conditions" }] };
      const context = input as { unreadCandidates: { id: string; text: string; navigationOnly?: boolean }[] };
      for (const id of ["c3", "c4"]) {
        const candidate = context.unreadCandidates.find(item => item.id === id)!;
        assert.ok(candidate.text.startsWith("Distinguishing text"));
        assert.notEqual(candidate.navigationOnly, true);
      }
      return { decision: "insufficient_evidence", content: null,
        gaps: [{ requirementId: "permit", description: "Artificial fixture ends after navigation." }], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "literal-navigation", outcome }) },
  });
  assert.equal(turn, 2);
});

test("failed direct reads still save explicit unresolved law when no further research is available", async () => {
  let turns = 0;
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage }) => stage === "interpret" ? interpretation : {
      decision: "research", content: null, gaps: [], actions: [++turns === 1
        ? { requirementId: "permit", candidateId: "c1" }
        : { requirementId: "permit", query: "public event permit" }],
    } },
    corpus: { search: async () => ({ candidates: ["unavailable-rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async () => [{ identity: "unavailable-rule", sourceUrl: "https://lex.uz/docs/123", text: "Artificial preview", truncated: true }],
      resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-gap", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  if (result.outcome.kind !== "insufficient_evidence") throw new Error("Expected unresolved law");
  assert.deepEqual(result.outcome.gaps.map(gap => gap.requirementId), ["permit"]);
  assert.ok(result.outcome.gaps[0].description.length > 0);
  assert.equal(result.answerId, "saved-gap");
});

test("distinct legal questions cannot collapse under a duplicated requirement identity", async () => {
  await assert.rejects(() => runLegalAnswer(request(), {
    model: { complete: async () => ({ ...interpretation, requirements: [
      { id: "permit", question: "Permit rule?" }, { id: "permit", question: "Appeal procedure?" }] }) },
    corpus: { search: async () => { throw new Error("Invalid interpretation must not start research"); },
      resolve: async () => null, get: async () => null },
    publication: { publish: async () => { throw new Error("Invalid interpretation must not publish"); } },
  }), /REQUIREMENT_ID_CONFLICT/);
});

test("interpretation of a date precedes discovery and every complete read", async () => {
  const scopes: unknown[] = [], reads: unknown[] = [];
  const historical = { kind: "historical" as const, at: "2020-04-15" };
  const result = await runLegalAnswer({ ...request(), question: "What permit was needed on 15 April 2020?" }, {
    corpus: {
      search: async (_query, scope) => { scopes.push(scope); return { candidates: ["rule", "exception"], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123", text: identity, truncated: true })),
      resolve: async (identity, scope) => {
        reads.push(scope); assert.deepEqual(scope, historical);
        return { ...locator(identity), temporalState: "historical_only", applicableAt: historical.at, currentPointerVerified: false };
      }, get: async key => Buffer.from(`Complete dated rule: ${key}`),
    },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, scopes: [historical] };
      const context = input as { evidence: unknown[]; unreadCandidates: { id: string; scope: unknown }[] };
      if (!context.evidence.length) {
        assert.deepEqual(reads, []);
        assert.ok(context.unreadCandidates.every(item => JSON.stringify(item.scope) === JSON.stringify(historical)));
        return { decision: "research", content: null, gaps: [{ requirementId: "permit", description: "Read the dated law." }],
          actions: context.unreadCandidates.map(item => ({ requirementId: "permit", candidateId: item.id })) };
      }
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(scopes, [historical]);
  assert.deepEqual(reads, [historical, historical]);
});

test("read selection rejects unknown IDs without reading source text", async () => {
    const result = await runLegalAnswer(request(), {
      corpus: { search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
        describeCandidates: async () => [{ identity: "rule", sourceUrl: "https://lex.uz/docs/123", text: "preview", truncated: true }],
        resolve: async () => { throw Error("Unadmitted read"); }, get: async () => null },
      model: { complete: async ({ stage }) => stage === "interpret" ? interpretation : {
        decision: "research", content: null, gaps: [{ requirementId: "permit", description: "Read law." }],
        actions: [{ requirementId: "permit", candidateId: "invented" }] } },
      publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
    });
    assert.equal(result.outcome.kind, "insufficient_evidence");
});

test("a temporal comparison can rediscover the literal question in both required scopes", async () => {
  const question = "Compare the artificial permit rule now and in 2020.";
  const scopes = [{ kind: "current" as const }, { kind: "historical" as const, at: "2020-01-01" }];
  const result = await runLegalAnswer({ ...request(), question }, {
    corpus: { search: async () => ({ candidates: ["rule"], sparseAvailable: true, denseAvailable: true }),
      describeCandidates: async () => [{ identity: "rule", sourceUrl: "https://lex.uz/docs/123", text: "preview", truncated: true }],
      resolve: async () => { throw Error("No complete read requested"); }, get: async () => null },
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, queries: [question], scopes };
      const candidates = (input as { unreadCandidates: { scope: unknown }[] }).unreadCandidates;
      assert.equal(candidates.length, 2);
      assert.ok(scopes.every(scope => candidates.some(item => JSON.stringify(item.scope) === JSON.stringify(scope))));
      return { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "permit", description: "Complete dated reads remain necessary." }], actions: [] };
    } }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
});

test("deadline outcomes preserve the requested Russian and Uzbek language", { timeout: 4000 }, async () => {
  for (const language of ["ru", "uz"] as const) {
    const result = await runLegalAnswer({ ...request(), language, deadlineMs: 500 }, {
      model: { complete: async ({ stage }) => stage === "interpret" ? interpretation : new Promise(() => {}) },
      corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
        resolve: async () => null, get: async () => null },
      publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
    });
    assert.equal(result.outcome.kind, "insufficient_evidence");
    if (result.outcome.kind === "insufficient_evidence") {
      assert.match(result.outcome.gaps[0].description, language === "ru" ? /^Не удалось подготовить полный ответ/ : /^Mavjud materiallar/);
    }
  }
});

test("targeted stored-reference research supplies the exception before delivery and rejects invented references", async () => {
  for (const forged of [false, true]) {
    const target = "https://lex.uz/docs/456#11";
    let references = 0;
    const run = runLegalAnswer(request(), {
      model: { complete: async ({ stage, input }) => {
        if (stage === "interpret") return interpretation;
        assert.equal(stage, "write");
        const evidence = (input as { evidence: { identity: string }[] }).evidence;
        assert.deepEqual((input as { availableReferences: unknown }).availableReferences, [{
          sourceId: "rule", url: target, texts: ["Exceptions"], scope: { kind: "current" }, attempted: references > 0,
        }]);
        return evidence.some(item => item.identity === "exception")
          ? { decision: "answer", content: answer, gaps: [], actions: [] }
          : { decision: "research", content: null, gaps: [{ requirementId: "permit", description: "The exception is missing." }],
            actions: [{ requirementId: "permit", sourceId: "rule", url: forged ? "https://lex.uz/docs/789" : target }] };
      } },
      corpus: { search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
        resolve: async () => ({ ...locator("rule"), operativeReferences: [{ url: target, text: "Exceptions" }] }),
        resolveReference: async () => { references++; return locator("exception"); },
        get: async key => Buffer.from(key === "rule" ? "Public events need a permit, except as specified in the linked rule."
          : "Private gatherings are exempt from the permit rule.") },
      publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
    });
    if (forged) { assert.equal((await run).outcome.kind, "insufficient_evidence"); assert.equal(references, 0); }
    else { assert.equal((await run).outcome.kind, "answer"); assert.equal(references, 1); }
  }
});

function locator(identity: string) {
  return { identity, snapshot: "revision", objectKey: identity, sha256: "0".repeat(64), byteCount: 100,
    sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source" as const, quarantined: false,
    canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" as const };
}

test("exhausted equivalent searches persist the named legal gap without inventing law", async () => {
  const searches: string[] = [];
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage }) => stage === "interpret" ? interpretation : {
      decision: "research", content: null, gaps: [{ requirementId: "permit", description: "Permit exception missing." }],
      actions: [{ requirementId: "permit", query: "  PUBLIC EVENT PERMIT  " }] } },
    corpus: { search: async query => { searches.push(query); return { candidates: [], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-gap", outcome }) },
  });
  assert.equal(result.answerId, "saved-gap");
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.deepEqual(searches, ["public event permit"]);
});

test("unknown citations cannot be published by the research agent", async () => {
  let published = false;
  const ports: WorkflowPorts = {
    model: { complete: async ({ stage }) => stage === "interpret" ? interpretation
      : { decision: "answer", content: answer, gaps: [], actions: [] } },
    corpus: { search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
      resolve: async () => locator("rule"), get: async () => Buffer.from("Public event rule.") },
    publication: { publish: async ({ outcome }) => { published = true; return { answerId: "saved", outcome }; } },
  };
  await assert.rejects(() => runLegalAnswer(request(), ports), /ANSWER_CITATION_INVALID/);
  assert.equal(published, false);
});

test("a supported answer may discard an unnecessary provisional research topic", async () => {
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage }) => stage === "interpret"
      ? { ...interpretation, requirements: [...interpretation.requirements,
        { id: "future-dispute", question: "What happens in a possible unrelated future dispute?" }] }
      : { decision: "answer", content: answer, gaps: [], actions: [] } },
    corpus: { search: async () => ({ candidates: ["rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => locator(identity), get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-revised-plan", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(result.answerId, "saved-revised-plan");
});

test("additional research retains all previously acquired complete law and provenance", async () => {
  let turn = 0;
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { evidence: { identity: string; sourceTitle: string }[];
        availableEvidence: { identity: string; sourceTitle: string }[];
        previousResearch: { consideredEvidenceIds: string[]; newlyReadEvidenceIds: string[] } | null };
      turn++;
      if (turn === 1) {
        assert.deepEqual(context.previousResearch?.consideredEvidenceIds, []);
        assert.deepEqual(context.previousResearch?.newlyReadEvidenceIds, ["rule", "exception"]);
        return { decision: "research", content: null, gaps: [],
          actions: [{ requirementId: "permit", query: "recheck scope" }] };
      }
      assert.deepEqual(context.evidence.map(item => item.identity), ["rule", "exception"]);
      assert.deepEqual(context.previousResearch?.consideredEvidenceIds, ["rule", "exception"]);
      assert.deepEqual(context.previousResearch?.newlyReadEvidenceIds, [], "Reopening existing evidence is not a new read");
      assert.deepEqual(context.evidence.map(item => item.sourceTitle), ["General Act", "Exception Act"]);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } },
    corpus: { search: async () => ({ candidates: ["rule", "exception"], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => ({ ...locator(identity), sourceTitle: identity === "rule" ? "General Act" : "Exception Act" }),
      get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-selected-evidence", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
});

test("prior gap observations retain their evidence provenance after new reads and failed reads", async () => {
  let turn = 0;
  const gaps = [{ requirementId: "permit", description: "The exception has not yet been read." }];
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      const context = input as { previousResearch: { gaps: typeof gaps; consideredEvidenceIds: string[];
        newlyReadEvidenceIds: string[]; newCandidateCount: number; newFailures: { code: string }[] } | null };
      assert.equal("unresolvedIssues" in (input as object), false);
      if (++turn === 1) {
        assert.equal(context.previousResearch, null);
        return { decision: "research", content: null, gaps,
          actions: [{ requirementId: "permit", query: "exception rule" }] };
      }
      assert.deepEqual(context.previousResearch?.gaps, gaps);
      assert.deepEqual(context.previousResearch?.consideredEvidenceIds, ["rule"]);
      if (turn === 2) {
        assert.deepEqual(context.previousResearch?.newlyReadEvidenceIds, []);
        assert.equal(context.previousResearch?.newCandidateCount, 2);
        assert.deepEqual(context.previousResearch?.newFailures, []);
        return { decision: "research", content: null, gaps,
          actions: (input as { unreadCandidates: { id: string }[] }).unreadCandidates.map(item => ({ requirementId: "permit", candidateId: item.id })) };
      }
      assert.deepEqual(context.previousResearch?.newlyReadEvidenceIds, ["exception"]);
      assert.equal(context.previousResearch?.newCandidateCount, 0);
      assert.equal(context.previousResearch?.newFailures.length, 1);
      return { decision: "answer", content: answer, gaps: [], actions: [] };
    } },
    corpus: { automaticReadLimit: 3, automaticReadScope: "provision",
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: "https://lex.uz/docs/123",
        text: "Artificial discovery", truncated: true, readRange: { key: identity, kind: "provision" as const, language: "en" } })),
      search: async query => ({ candidates: query === "public event permit" ? ["rule"] : ["exception", "missing"],
      sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => identity === "missing" ? null : locator(identity),
      get: async key => Buffer.from(`Complete artificial law: ${key}`) },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved-prior-observation", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
});

test("the research agent writes a qualified rule without separate assessor approval", async () => {
  const text = Buffer.from("Artificial rule: written notice is required unless the recipient accepts oral notice.");
  const result = await runLegalAnswer({ question: "What notice is needed?", language: "en", format: "detailed",
    mode: "fast", submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "a", userId: "b" },
    history: [], privateDocuments: [] }, {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { complexity: "difficult", needsClarification: false,
        requirements: [{ id: "notice", question: "Required notice and exceptions?" }], queries: ["artificial notice"],
        scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      assert.equal(stage, "write", "research must not require assessor approval");
      assert.ok(JSON.stringify(input).includes(text.toString()));
      return { decision: "answer", gaps: [], actions: [], content: {
        summary: "Send written notice unless the recipient accepts oral notice.", summarySourceIds: ["rule"],
        issues: [{ title: "Notice", explanation: text.toString(), requirementIds: ["notice"], sourceIds: ["rule"], actions: [] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
        clarificationQuestions: [], urgency: "normal" } };
    } },
    corpus: { search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
      resolve: async () => ({ identity: "rule", snapshot: "revision", objectKey: "text", sha256: "0".repeat(64),
        byteCount: text.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source",
        quarantined: false, canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" }),
      get: async () => text,
      resolveAdjacent: async () => { throw new Error("Unrequested blanket expansion"); } },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.answerId, "saved");
  assert.equal(result.outcome.kind, "answer");
  if (result.outcome.kind === "answer") assert.match(result.outcome.content.summary, /unless/);
});
