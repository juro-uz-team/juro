import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ProviderResearchSession } from "../lib/legal-answer-workflow/provider-research-session";
import { entrySchema, interpretationSchema } from "../lib/legal-answer-workflow/contracts";
import { discoverReadCandidates } from "../lib/legal-answer-workflow/candidate-selection";
import { createEvidenceCompactor } from "../lib/legal-answer-workflow/model-identities";
import { restoreMultilingualSearch } from "../lib/legal-answer-workflow/multilingual-search";

const queries = { en: "employee disciplinary penalty appeal deadline", ru: "работник дисциплинарное взыскание срок обжалования",
  "uz-Latn": "xodim intizomiy jazo shikoyat muddati" };

test("an agent-selected multilingual search preserves every requested corpus language", async () => {
  const input = { question: "Intizomiy jazoga qanday shikoyat qilinadi?", language: "uz" };
  const session = new ProviderResearchSession().prepare({ stage: "interpret", researchSession: true,
    instruction: "Research the question", input, schema: z.toJSONSchema(entrySchema), signal: new AbortController().signal }, JSON.stringify(input));
  const args = { complexity: "difficult", needsClarification: false, queries, scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
  const result = await session.accept([{ type: "function_call", name: "search_law", call_id: "search", arguments: JSON.stringify(args) }]);
  const interpretation = interpretationSchema.parse(z.object({ interpretation: z.unknown() }).parse(result).interpretation);
  const searched: string[] = [];
  const candidates = await discoverReadCandidates({ interpretation, searches: new Set(), failures: [], limits: [], signal: new AbortController().signal,
    corpus: { search: async query => { searched.push(query); return { candidates: [query === queries.ru ? "russian-exception" : query], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => { throw new Error("No read expected"); }, get: async () => null } });
  assert.deepEqual(searched.sort(), [...Object.values(queries), "ходим интизомий жазо шикоят муддати"].sort());
  assert(candidates.some(c => c.identity === "russian-exception"));
  assert.equal(input.language, "uz");
});

test("adaptive search omits unused languages without omitting accompanying reads or later Uzbek variants", async () => {
  assert.deepEqual(await restoreMultilingualSearch({ queries: { en: null,
    ru: ["условия договора", "порядок уведомления"], "uz-Latn": ["shartnoma", "xodim"] } }),
    { queries: ["условия договора", "порядок уведомления", "shartnoma", "xodim", "шартнома", "ходим"] });
  assert.deepEqual(await restoreMultilingualSearch({ queries: { en: null, ru: "условия договора", "uz-Latn": null } }),
    { queries: ["условия договора"] });
  const restored = await restoreMultilingualSearch({ actions: [
    { requirementId: "r", query: { en: null, ru: "условия договора", "uz-Latn": null } },
    { requirementId: "r", candidateId: "c1" },
    { requirementId: "r", query: { en: null, ru: null, "uz-Latn": "shartnoma" } },
  ] });
  assert.deepEqual(restored.actions, [
    { requirementId: "r", query: "условия договора" }, { requirementId: "r", candidateId: "c1" },
    { requirementId: "r", query: "shartnoma" }, { requirementId: "r", query: "шартнома" },
  ]);
  await assert.rejects(restoreMultilingualSearch({ queries: { en: null, ru: null, "uz-Latn": null } }), /RESEARCH_QUERY_EMPTY/u);
});

test("follow-up searches expand all languages and preserve accompanying source reads through canonical restoration", async () => {
  const operation = { stage: "write" as const, researchSession: true, instruction: "Research", signal: new AbortController().signal, schema: {},
    input: { researchAgent: true, question: "Question", language: "uz", evidence: [], canResearch: true,
      interpretation: { requirements: [{ id: "question", question: "Question" }] },
      unreadCandidates: [{ id: "c1", text: "Source", truncated: false, scope: { kind: "current" } }] } };
  const mapped = createEvidenceCompactor()(operation);
  const session = new ProviderResearchSession().prepare(mapped.operation, JSON.stringify(mapped.operation.input));
  const output = [{ type: "function_call", name: "research_law", call_id: "followup", arguments: JSON.stringify({
    actions: [{ requirementId: "question", query: queries }, { requirementId: "question", candidateId: "c1" }],
  }) }];
  const result = z.object({ actions: z.array(z.record(z.string(), z.unknown())) }).parse(mapped.restore(await session.accept(output)));
  assert.equal(result.actions.length, 5);
  assert.deepEqual(result.actions.filter(a => a.query).map(a => a.query), [...Object.values(queries), "ходим интизомий жазо шикоят муддати"]);
  assert.deepEqual(result.actions[4], { requirementId: "question", candidateId: "c1" });
});

test("native search rejects a missing language instead of silently searching only the answer language", async () => {
  const input = { question: "Question", language: "uz" };
  const session = new ProviderResearchSession().prepare({ stage: "interpret", researchSession: true, instruction: "Research", input,
    schema: z.toJSONSchema(entrySchema), signal: new AbortController().signal }, JSON.stringify(input));
  const { ru: omitted, ...incomplete } = queries;
  assert(omitted);
  await assert.rejects(() => session.accept([{ type: "function_call", name: "search_law", call_id: "bad", arguments: JSON.stringify({
    complexity: "simple", needsClarification: false, queries: incomplete, scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [],
  }) }]));
});
