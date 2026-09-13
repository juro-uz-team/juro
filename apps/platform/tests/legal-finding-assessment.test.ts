import assert from "node:assert/strict";
import test from "node:test";
import {parseLegalFindingAssessment, assessedFindingSources, assessLegalFindings} from "../lib/ai/legal-finding-assessment";
import {env} from "cloudflare:workers";
import type {LegalChatRequest, LegalSourceContext, LegalAiRunResult} from "../lib/ai/provider";
import type {LegalChatResponse} from "../lib/ai/legal-chat-schema";
import {parseLegalChatResponse} from "../lib/ai/legal-chat-schema";
import {validateLegalGatewayAnswer} from "../lib/ai/legal-ai-gateway";
const sources: LegalSourceContext[] = ["commission", "court"].map(id => ({id, officialUrl: `https://lex.uz/ru/docs/${id}`,
  actTitle: "Procedure", article: "1", locale: "en", sourceClass: "OFFICIAL_LEGISLATION", contentSha256: "a".repeat(64),
  actIdentifier: id, revisionDate: null, lastCheckedAt: "2026-09-11T00:00:00Z", publishedAt: null,
  sourceType: "lex", status: "verified", verificationState: "direct_validated", verifiedAt: "2026-09-11T00:00:00Z",
  applicabilityStatus: "current", sourceQuality: {passed: true, title: true, sufficientText: true, clean: true, locale: true, canonicalUrl: true, structured: true},
  spans: [{id, article: "1", paragraph: null, text: `Mediation suspends the ${id} filing period.`, textSha256: "b".repeat(64), quality: "high"}],
}));
const input: LegalChatRequest = {question: "How does mediation affect filing?", sources, locale: "en", answerMode: "detailed",
  reasoningMode: "deep", legalDatabaseAsOf: "2026-09-11T00:00:00Z", requestId: "finding-test", safetyIdentifier: "test"};
const finding: LegalChatResponse["confirmedFindings"][number] = {title: "Mediation", explanation: "Mediation suspends commission and court filing periods.",
  sourceIds: ["commission", "court"], requirementIds: ["filing"], answerRole: "governing_rule"};

test("a supported governing finding cannot hide a missing material rule in the same scope", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const request: LegalChatRequest = {...input, coverageRequirements: [{id: "filing", statement: input.question,
    scopeKind: "general", priority: "core", sourceIds: ["commission", "court"]}]};
  const data = parseLegalChatResponse({responseKind: "answer", summary: finding.explanation,
    coverage: {r1: [0]}, guidanceCoverage: {r1: []},
    confirmedFindings: [finding], summarySourceIds: finding.sourceIds, actionPlan: [], clarificationQuestions: [],
    risks: [], deadlines: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false}, request);
  const run: LegalAiRunResult = {data, provider: "openai", model: "gpt-5.6-terra", providerResponseId: null,
    attempts: 1, latencyMs: 1, usage: {inputTokens: 1, outputTokens: 1, cachedInputTokens: 0}, fallbackFromProvider: null};
  context.mock.method(globalThis, "fetch", async () => Response.json({id: "scope-assessment", model: run.model,
    output: [{content: [{type: "output_text", text: JSON.stringify({f1: ["commission", "court"],
      scopeCoverage: {r1: [0]}, scopeGaps: {r1: [{sourceId: "commission", quotation: "nonexistent quotation", reason: "Missing ordinary rule"}]}})}]}],
    usage: {input_tokens: 100, output_tokens: 10}}));
  const assessed = await assessLegalFindings(request, run, {}, Date.now() + 12_000);
  const validated = validateLegalGatewayAnswer({...request, result: assessed.data, run: assessed});
  assert.equal(validated.run.data.confirmedFindings.length, 1, "individually supported content survives an incomplete scope");
  assert.equal(validated.coverageDiagnostics.validatedRequirementCount, 0,
    "a nonempty gap invalidates completeness even when its quotation cannot be routed to repair");
  assert.equal(validated.coverageDiagnostics.unresolvedCoverage[0]?.finding, "omitted");
});

test("a single cited provision cannot bypass independent rejection of a missing exception", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const rule = "The seller must transfer the records unless the registry already holds them.";
  const request: LegalChatRequest = {...input, question: "Must the seller transfer records?", sources: [{...sources[0]!,
    spans: [{...sources[0]!.spans![0]!, text: rule}]}]};
  const candidate = parseLegalChatResponse({responseKind: "answer", summary: rule, summarySourceIds: ["commission"],
    confirmedFindings: ["The seller must transfer the records.", rule].map(explanation => ({title: "Transfer of records",
      explanation, sourceIds: ["commission"], answerRole: "governing_rule"})),
    actionPlan: [], clarificationQuestions: [], risks: [], deadlines: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false}, request);
  const run: LegalAiRunResult = {data: candidate, provider: "openai", model: "gpt-5.6-terra", providerResponseId: null,
    attempts: 1, latencyMs: 1, usage: {inputTokens: 1, outputTokens: 1, cachedInputTokens: 0}, fallbackFromProvider: null};
  let called = false;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    called = true;
    const body = JSON.parse(String(init.body));
    const payload = JSON.parse(body.input);
    assert.equal(payload.sources[0].spans[0].text, rule);
    assert.equal(payload.findings.length, 2);
    return Response.json({id: "single-source-assessment", model: run.model,
      output: [{content: [{type: "output_text", text: JSON.stringify({f1: [], f2: ["commission"]})}]}],
      usage: {input_tokens: 100, output_tokens: 10}});
  });
  const assessed = await assessLegalFindings(request, run, {}, Date.now() + 12_000);
  const validated = validateLegalGatewayAnswer({...request, result: assessed.data, run: assessed});
  assert.equal(called, true);
  assert.deepEqual(validated.run.data.confirmedFindings.map(item => item.explanation), [rule]);
});
test("finding support binds the original claim, scopes and exact evidence", () => {
  const assessment = parseLegalFindingAssessment({f1: ["commission", "court"]}, input, [finding]);
  const check = (context = input, value = finding) => assessedFindingSources(context, [value], [assessment]).get(value);
  assert.deepEqual(check(), ["commission", "court"]);
  assert.equal(check({...input, question: "Another question"}), undefined);
  assert.equal(check({...input, applicableAt: "2020-01-01"}), undefined);
  assert.equal(check({...input, sources: sources.map(s => ({...s, revisionDate: "2020-01-01"}))}), undefined);
  assert.equal(check(input, {...finding, explanation: "Mediation never suspends filing."}), undefined);
  assert.equal(check(input, {...finding, sourceIds: ["commission"]}), undefined);
  assert.throws(() => parseLegalFindingAssessment({f1: [2]}, input, [finding]));
  assert.throws(() => parseLegalFindingAssessment({f1: ["another-cited-source"]}, input, [finding]));
});

test("complete finding coverage survives display formatting but not loss of a selected finding", () => {
  const request: LegalChatRequest = {...input, coverageRequirements: [{id: "filing", statement: input.question,
    scopeKind: "general", priority: "core", sourceIds: ["commission", "court"]}]};
  const findings = sources.map(source => ({title: `**${source.id} mediation**`, explanation: source.spans![0]!.text,
    sourceIds: [source.id], answerRole: "governing_rule" as const}));
  const data = parseLegalChatResponse({responseKind: "answer", summary: findings[0]!.explanation,
    confirmedFindings: findings, coverage: {r1: [0, 1]}, guidanceCoverage: {r1: []}, summarySourceIds: ["commission"],
    actionPlan: [], clarificationQuestions: [], risks: [], deadlines: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false}, request);
  const assessment = parseLegalFindingAssessment({f1: ["commission"], f2: ["court"],
    scopeCoverage: {r1: [0, 1]}, scopeGaps: {r1: []}}, request, data.confirmedFindings);
  const run: LegalAiRunResult = {data, provider: "openai", model: "gpt-5.6-terra", providerResponseId: null,
    attempts: 1, latencyMs: 1, usage: {inputTokens: 1, outputTokens: 1, cachedInputTokens: 0}, fallbackFromProvider: null,
    findingAssessments: [assessment]};
  const complete = validateLegalGatewayAnswer({...request, result: data, run});
  assert.equal(complete.coverageDiagnostics.validatedRequirementCount, 1);
  const missing = {...data, confirmedFindings: data.confirmedFindings.slice(0, 1)};
  const incomplete = validateLegalGatewayAnswer({...request, result: missing, run: {...run, data: missing}});
  assert.equal(incomplete.run.data.confirmedFindings.length, 1);
  assert.equal(incomplete.coverageDiagnostics.validatedRequirementCount, 0);
  const unsupported = parseLegalFindingAssessment({f1: ["commission"], f2: [],
    scopeCoverage: {r1: [0, 1]}, scopeGaps: {r1: []}}, request, data.confirmedFindings);
  const rejected = validateLegalGatewayAnswer({...request, result: data, run: {...run, findingAssessments: [unsupported]}});
  assert.equal(rejected.run.data.confirmedFindings.length, 1);
  assert.equal(rejected.coverageDiagnostics.validatedRequirementCount, 0,
    "scope indexes cannot override an individual support rejection");
  const stale = validateLegalGatewayAnswer({...request, question: "Which other filing rule applies?", result: data, run});
  assert.equal(stale.coverageDiagnostics.validatedRequirementCount, 0, "another question cannot reuse the scope proof");
  const invalidCitation = {...request, sources: sources.map(source => source.id === "court"
    ? {...source, spans: source.spans!.map(span => ({...span, textSha256: "invalid"}))} : source)};
  const freshAssessment = parseLegalFindingAssessment({f1: ["commission"], f2: ["court"],
    scopeCoverage: {r1: [0, 1]}, scopeGaps: {r1: []}}, invalidCitation, data.confirmedFindings);
  const lostCitation = validateLegalGatewayAnswer({...invalidCitation, result: data,
    run: {...run, findingAssessments: [freshAssessment]}});
  assert.equal(lostCitation.run.data.confirmedFindings.length, 1);
  assert.equal(lostCitation.coverageDiagnostics.validatedRequirementCount, 0,
    "a fresh semantic approval cannot survive a selected citation's validation failure");
});
test("an explicit rejection stays distinct from absent assessment and can remove a redundant citation", () => {
  const rejected = parseLegalFindingAssessment({f1: []}, input, [finding]);
  assert.deepEqual(assessedFindingSources(input, [finding], [rejected]).get(finding), []);
  const narrowed = parseLegalFindingAssessment({f1: ["court"]}, input, [finding]);
  assert.deepEqual(assessedFindingSources(input, [finding], [narrowed]).get(finding), ["court"]);
});

test("merging scope mappings cannot erase an independent finding rejection", () => {
  const other = {...finding, requirementIds: ["other-scope"]};
  const merged = {...finding, requirementIds: ["filing", "other-scope"]};
  const rejected = parseLegalFindingAssessment({f1: []}, input, [finding]);
  const accepted = parseLegalFindingAssessment({f1: ["commission", "court"]}, input, [other]);
  for (const assessments of [[rejected, accepted], [accepted, rejected]]) {
    assert.deepEqual(assessedFindingSources(input, [merged], assessments).get(merged), []);
  }
});

test("the finding assessor receives complete semantic evidence without private receipts", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const privateSources = structuredClone(sources);
  Object.defineProperty(privateSources[0], "citationEvidenceReceipt", {value: {privateObject: "must-not-leave-server"}, enumerable: true});
  const data = parseLegalChatResponse({responseKind: "answer", summary: finding.explanation,
    confirmedFindings: [finding], summarySourceIds: finding.sourceIds, actionPlan: [], clarificationQuestions: [],
    risks: [], deadlines: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false}, input);
  const run: LegalAiRunResult = {data, provider: "openai", model: "gpt-5.6-terra", providerResponseId: null,
    attempts: 1, latencyMs: 1, usage: {inputTokens: 1, outputTokens: 1, cachedInputTokens: 0}, fallbackFromProvider: null};
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    assert.equal("citationEvidenceReceipt" in payload.sources[0], false);
    assert.equal(payload.sources[0].spans[0].text, sources[0]!.spans![0]!.text);
    assert.deepEqual(request.text.format.schema.properties.f1.items.enum, finding.sourceIds,
      "each finding has a closed source identity enum, without ambiguous local/global indexes");
    return Response.json({id: "finding-assessment", model: run.model,
      output: [{content: [{type: "output_text", text: JSON.stringify({f1: ["commission", "court"]})}]}],
      usage: {input_tokens: 100, output_tokens: 10}});
  });
  await assessLegalFindings({...input, sources: privateSources}, run, {}, Date.now() + 12_000);
});
