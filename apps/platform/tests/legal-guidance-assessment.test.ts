import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {assessLegalGuidance, assessedGuidanceActions, assessedGuidanceCoverage, parseLegalGuidanceAssessment} from "../lib/ai/legal-guidance-assessment";
import {parseLegalChatResponse} from "../lib/ai/legal-chat-schema";
import {validateLegalGatewayAnswer} from "../lib/ai/legal-ai-gateway";
import type {LegalChatRequest, LegalAiRunResult, LegalSourceContext} from "../lib/ai/provider";

const buyer = "Покупатель обязан предоставить подписанное заявление в комиссию.";
const seller = "Продавец обязан передать документы о качестве товара покупателю.";
const source: LegalSourceContext = {id: "official:shared", actTitle: "Правила подачи документов", actIdentifier: "42",
  officialUrl: "https://lex.uz/ru/docs/42", revisionDate: null, lastCheckedAt: "2026-09-12T00:00:00Z",
  locale: "ru", publishedAt: null, sourceType: "lex", status: "verified", verificationState: "direct_validated",
  verifiedAt: "2026-09-12T00:00:00Z", contentSha256: "a".repeat(64), article: "3", applicabilityStatus: "current",
  sourceClass: "OFFICIAL_LEGISLATION", spans: [{id: "shared-span", article: "3", paragraph: null,
    text: `${buyer} ${seller}`, textSha256: "b".repeat(64), quality: "high"}],
  sourceQuality: {passed: true, title: true, sufficientText: true, clean: true, locale: true, canonicalUrl: true, structured: true}};
const input: LegalChatRequest = {question: "Какие обязанности покупателя и продавца?", locale: "ru", answerMode: "detailed",
  reasoningMode: "fast", legalDatabaseAsOf: source.verifiedAt, sources: [source], requestId: "guidance-shared-source",
  safetyIdentifier: "test", coverageRequirements: ["buyer", "seller"].map((id, index) => ({id, statement: index ? seller : buyer,
    priority: "core", scopeKind: "general", sourceIds: [source.id]}))};
const data = parseLegalChatResponse({responseKind: "answer", summary: buyer, summarySourceIds: [source.id],
  confirmedFindings: [buyer, seller].map((explanation, index) => ({title: index ? "Продавец" : "Покупатель", explanation,
    sourceIds: [source.id], requirementIds: [index ? "seller" : "buyer"], answerRole: "governing_rule"})),
  actionPlan: [{title: "Подать заявление покупателя", description: buyer, sourceIds: [source.id], requirementIds: ["buyer", "seller"]}],
  clarificationQuestions: [], risks: [], deadlines: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false},
{...input, coverageRequirements: []});
const run: LegalAiRunResult = {data, provider: "openai", model: "gpt-5.6-terra", providerResponseId: "generated",
  attempts: 1, latencyMs: 10, usage: {inputTokens: 10, outputTokens: 10, cachedInputTokens: 0}, fallbackFromProvider: null};

test("an independently reported material rule gap prevents complete coverage while retaining a supported preparatory step", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  context.mock.method(globalThis, "fetch", async () => Response.json({id: "scope-gap", model: run.model,
    output: [{content: [{type: "output_text", text: JSON.stringify({supportedActions: [0], r1: [0], r2: [],
      sourceSupport: {a0: [source.id]}, scopeGaps: {
        r1: {quotation: buyer, sourceId: source.id, reason: "The required proof of identity is missing from the practical instruction."},
        r2: {quotation: seller, sourceId: source.id, reason: "Seller guidance is absent."},
      }})}]}], usage: {input_tokens: 100, output_tokens: 10}}));
  const candidate = {...run, data: {...data, actionPlan: data.actionPlan.map(action => ({...action,
    description: "Подготовьте подписанное заявление."}))}};
  const assessed = await assessLegalGuidance(input, candidate, {}, Date.now() + 12_000);
  assert.equal(assessedGuidanceActions({...input, actions: assessed.data.actionPlan,
    assessments: assessed.guidanceAssessments!}).get(assessed.data.actionPlan[0]!), true);
  assert.deepEqual([...assessedGuidanceCoverage({...input, actions: assessed.data.actionPlan,
    assessments: assessed.guidanceAssessments!}).values()], [[]]);
});

test("independent guidance assessment removes an irrelevant citation while retaining the supported action", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const unrelated: LegalSourceContext = {...source, id: "official:seller-only", spans: [{...source.spans![0]!, text: seller}]};
  const requestInput = {...input, sources: [source, unrelated]};
  const candidate = {...run, data: {...data, actionPlan: data.actionPlan.map(action => ({...action, sourceIds: [source.id, unrelated.id]}))}};
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    assert.equal(payload.sources.length, 2, "retain complete evidence for the independent decision");
    return Response.json({id: "citation-assessment", model: run.model,
      output: [{content: [{type: "output_text", text: JSON.stringify({supportedActions: [0], r1: [0], r2: [],
        scopeGaps: {r1: {quotation: "", sourceId: "", reason: ""}, r2: {quotation: seller, sourceId: source.id, reason: "Seller guidance is absent."}},
        sourceSupport: {a0: [source.id]}})}]}], usage: {input_tokens: 100, output_tokens: 10}});
  });
  const assessed = await assessLegalGuidance(requestInput, candidate, {}, Date.now() + 12_000);
  const checked = validateLegalGatewayAnswer({...requestInput, result: assessed.data, run: assessed});
  assert.equal(checked.run.data.actionPlan.length, 1);
  assert.deepEqual(checked.run.data.actionPlan[0]!.sourceIds, [source.id]);
  assert.deepEqual(checked.run.data.actionPlan[0]!.requirementIds, ["buyer"]);
});

for (const selectedSources of [[], ["official:uncited-source"]]) test(`guidance citation selection rejects ${selectedSources.length ? "uncited evidence" : "approval without evidence"}`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  context.mock.method(globalThis, "fetch", async () => Response.json({id: "invalid-citation-assessment", model: run.model,
    output: [{content: [{type: "output_text", text: JSON.stringify({supportedActions: [0], r1: [0], r2: [],
      scopeGaps: {r1: {quotation: "", sourceId: "", reason: ""}, r2: {quotation: "", sourceId: "", reason: ""}},
      sourceSupport: {a0: selectedSources}})}]}], usage: {input_tokens: 100, output_tokens: 10}}));
  await assert.rejects(assessLegalGuidance(input, run, {}, Date.now() + 12_000));
});

test("a separately assessed buyer step cannot cover the seller merely by sharing its source", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    assert.equal(request.reasoning.effort, "low");
    const assessment = JSON.parse(request.input);
    assert.equal("requirementIds" in assessment.actions[0], false, "do not anchor the independent decision on generated mappings");
    assert.equal(assessment.sources[0].spans[0].text, source.spans![0]!.text);
    return Response.json({id: "independent-assessment", model: run.model,
      output: [{content: [{type: "output_text", text: JSON.stringify({supportedActions: [0], r1: [0], r2: [], sourceSupport: {a0: [source.id]},
        scopeGaps: {r1: {quotation: "", sourceId: "", reason: ""}, r2: {quotation: seller, sourceId: source.id, reason: "Seller guidance is absent."}}})}]}],
      usage: {input_tokens: 100, output_tokens: 10}});
  });
  const attempts: string[] = [];
  const assessed = await assessLegalGuidance(input, run, {onProviderAttemptFinished: value => {attempts.push(value.part);}}, Date.now() + 12_000);
  assert.equal(assessed.attempts, 2);
  assert.equal(assessed.usage.inputTokens, 110);
  assert.deepEqual(attempts, ["guidance_validation"]);
  const checked = validateLegalGatewayAnswer({...input, result: assessed.data, run: assessed});
  assert.equal(checked.run.data.responseKind, "clarification_required");
  assert.deepEqual(checked.run.data.coverageGaps, [seller]);
  assert.equal(checked.coverageDiagnostics.validatedGuidanceRequirementCount, 1);
  assert.equal(checked.coverageDiagnostics.missingGuidanceRequirementCount, 1);
  assert.equal(checked.coverageDiagnostics.completeRequirementCount, 1);
  assert.deepEqual(checked.coverageDiagnostics.unresolvedCoverage, [
    {requirementIndex: 1, finding: null, guidanceMissing: true},
  ]);
  assert.deepEqual(checked.run.data.actionPlan[0]!.requirementIds, ["buyer"]);
  assert.equal(checked.run.guidanceAssessments, undefined, "private assessment input is consumed before returning the answer");
});

test("guidance decisions bind exact action, question scope and complete evidence; all assessed steps must survive", () => {
  const actions = [...data.actionPlan, {title: "Передать документы продавца", description: seller, sourceIds: [source.id]}];
  const assessment = parseLegalGuidanceAssessment({supportedActions: [0, 1], r1: [0], r2: [1]}, input, actions);
  const coverage = (overrides: Partial<Parameters<typeof assessedGuidanceCoverage>[0]> = {}) => assessedGuidanceCoverage({
    ...input, actions, assessments: [assessment], ...overrides});
  assert.deepEqual([...coverage().values()], [["buyer"], ["seller"]]);
  assert.deepEqual([...coverage({question: "A different actor and stage"}).values()], [[], []]);
  assert.deepEqual([...coverage({applicableAt: "2025-01-01"}).values()], [[], []]);
  assert.deepEqual([...coverage({sources: [{...source, revisionDate: "2025-01-01"}]}).values()], [[], []]);
  assert.deepEqual([...coverage({sources: [{...source, spans: [{...source.spans![0]!, text: buyer}]}]}).values()], [[], []]);
  assert.deepEqual([...coverage({actions: [{...actions[0]!, description: seller}, actions[1]!]}).values()], [[], ["seller"]]);
  const cumulative = parseLegalGuidanceAssessment({supportedActions: [0, 1], r1: [0, 1], r2: [1]}, input, actions);
  assert.deepEqual([...coverage({actions: [actions[0]!], assessments: [cumulative]}).values()], [[]]);
  for (const invalid of [{supportedActions: [0], r1: [2], r2: []}, {supportedActions: [0], r1: [0]},
    {supportedActions: [0], r1: [0], r2: [], unknown: []}, {supportedActions: [2], r1: [], r2: []}, {r1: [], r2: []}])
    assert.throws(() => parseLegalGuidanceAssessment(invalid, input, actions));
});

test("individual action support binds exact claims and evidence and conflicting rejection wins", () => {
  const actions = data.actionPlan;
  const approved = parseLegalGuidanceAssessment({supportedActions: [0], r1: [0], r2: []}, input, actions);
  const rejected = parseLegalGuidanceAssessment({supportedActions: [], r1: [], r2: []}, input, actions);
  const decision = {...input, actions, assessments: [approved]};
  assert.equal(assessedGuidanceActions(decision).get(actions[0]!), true);
  assert.equal(assessedGuidanceActions({...decision, question: "Different actor"}).size, 0);
  assert.equal(assessedGuidanceActions({...decision, sources: [{...source, revisionDate: "2025-01-01"}]}).size, 0);
  assert.equal(assessedGuidanceActions({...decision, actions: [{...actions[0]!, description: seller}]}).size, 0);
  for (const assessments of [[approved, rejected], [rejected, approved]]) {
    assert.equal(assessedGuidanceActions({...decision, assessments}).get(actions[0]!), false);
    assert.deepEqual([...assessedGuidanceCoverage({...decision, assessments}).values()], [[]]);
  }
});

test("gateway formatting and removal of a redundant citation preserve an independently assessed action", () => {
  const redundant: LegalSourceContext = {...source, id: "official:weaker", officialUrl: "https://lex.uz/ru/docs/43",
    spans: [{...source.spans![0]!, id: "weaker-span", text: "Покупатель предоставляет заявление."}]};
  const request = {...input, sources: [source, redundant]};
  const actions = [
    {title: "**Обязанность покупателя**", description: `**${buyer}**`, sourceIds: [source.id, redundant.id]},
    {title: "Обязанность продавца", description: seller, sourceIds: [source.id]},
  ];
  const answer = {...data, actionPlan: actions};
  const assessed = {...run, data: answer, guidanceAssessments: [parseLegalGuidanceAssessment({supportedActions: [0, 1], r1: [0], r2: [1]}, request, actions)]};
  const checked = validateLegalGatewayAnswer({...request, result: answer, run: assessed});
  assert.equal(checked.run.data.responseKind, "answer");
  assert.deepEqual(checked.run.data.actionPlan[0]!.sourceIds, [source.id]);
  assert.equal(checked.run.data.actionPlan[0]!.description, buyer);
  assert.deepEqual(checked.run.data.actionPlan.map(action => action.requirementIds), [["buyer"], ["seller"]]);
});
