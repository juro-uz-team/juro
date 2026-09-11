import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {parseLegalGuidanceAssessment} from "../lib/ai/legal-guidance-assessment";
import {parseLegalFindingAssessment} from "../lib/ai/legal-finding-assessment";
import {parseLegalChatResponse} from "../lib/ai/legal-chat-schema";
import {validateLegalGatewayAnswer} from "../lib/ai/legal-ai-gateway";
import type {LegalChatRequest, LegalAiRunResult, LegalSourceContext} from "../lib/ai/provider";

const sources: LegalSourceContext[] = [
  "Статья 554. Срок обращения в комиссию по трудовым спорам Работник может обратиться в комиссию по трудовым спорам в шестимесячный срок со дня, когда он узнал или должен был узнать о нарушении своего права. В случае пропуска по уважительным причинам срока, установленного в части первой настоящей статьи, комиссия по трудовым спорам может его восстановить и рассмотреть спор по существу. Течение срока обращения по рассмотрению индивидуальных трудовых споров приостанавливается на период рассмотрения индивидуального трудового спора в порядке медиации.",
  "Статья 560. Сроки обращения в суд за рассмотрением индивидуального трудового спора Для обращения в суд за рассмотрением индивидуального трудового спора устанавливаются следующие сроки: по спорам о восстановлении на работе — три месяца со дня вручения работнику копии приказа работодателя о прекращении с ним трудового договора; по спорам о возмещении работником материального ущерба, причиненного работодателю, — один год со дня обнаружения работодателем причиненного ущерба; по другим трудовым спорам — шесть месяцев с того дня, как работник узнал или должен был узнать о нарушении своего права. По спорам о возмещении вреда, причиненного жизни и здоровью работника, а также по спорам о компенсации причиненного работнику морального вреда срок обращения в суд не устанавливается. Течение срока обращения в суд по рассмотрению индивидуальных трудовых споров приостанавливается на период рассмотрения индивидуального трудового спора в порядке медиации.",
].map((text, index) => ({
  id: `official:forum:${index}`, actTitle: "Трудовой кодекс", actIdentifier: "6257291",
  officialUrl: "https://lex.uz/ru/docs/6257291", revisionDate: null, lastCheckedAt: "2026-09-11T07:42:10Z",
  locale: "ru", publishedAt: null, sourceType: "lex", status: "verified", verificationState: "direct_validated",
  verifiedAt: "2026-09-11T07:42:10Z", contentSha256: "a".repeat(64), article: index ? "560" : "554",
  applicabilityStatus: "current", sourceClass: "OFFICIAL_LEGISLATION",
  spans: [{id: `span:${index}`, article: index ? "560" : "554", paragraph: null, text,
    textSha256: String(index).repeat(64), quality: "high"}],
  sourceQuality: {passed: true, title: true, sufficientText: true, clean: true, locale: true, canonicalUrl: true, structured: true},
}));
const input: LegalChatRequest = {question: "Как учитывать медиацию при обращении в комиссию и суд?", sources,
  locale: "ru", answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: sources[0]!.verifiedAt,
  requestId: "guidance-citations", safetyIdentifier: "test",
  coverageRequirements: [{id: "mediation", statement: "Приостановление срока обращения в оба органа",
    priority: "core", scopeKind: "forum", sourceIds: sources.map(source => source.id)}]};
const action = {title: "Учтите медиацию отдельно",
  description: "Зафиксируйте период рассмотрения спора в порядке медиации: на этот период течение срока обращения и в комиссию, и в суд приостанавливается.",
  sourceIds: sources.map(source => source.id), requirementIds: ["mediation"]};
const data = parseLegalChatResponse({responseKind: "answer", summary: "Учитывайте приостановление срока.",
  summarySourceIds: action.sourceIds, confirmedFindings: [], actionPlan: [action], clarificationQuestions: [],
  risks: [], deadlines: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false},
  {...input, coverageRequirements: []});
const run: LegalAiRunResult = {data, provider: "openai", model: "gpt-5.6-terra", providerResponseId: null,
  attempts: 1, latencyMs: 1, usage: {inputTokens: 1, outputTokens: 1, cachedInputTokens: 0}, fallbackFromProvider: null,
  guidanceAssessments: [parseLegalGuidanceAssessment({supportedActions: [0], r1: [0]}, input, data.actionPlan)]};

test("independently assessed practical guidance retains complementary forum citations", () => {
  const checked = validateLegalGatewayAnswer({...input, run, result: data}).run.data;
  assert.deepEqual(checked.actionPlan[0]?.sourceIds, action.sourceIds);
  assert.deepEqual(checked.actionPlan[0]?.requirementIds, ["mediation"]);
});

test("prior semantic approval cannot authorize changed or unassessed evidence", () => {
  for (const overrides of [
    {run: {...run, guidanceAssessments: []}}, {question: "Другой вопрос"},
    {sources: sources.map(source => ({...source, revisionDate: "2020-01-01"}))},
    {result: {...data, actionPlan: [{...action, description: action.description + " Уплатите 987654 сумов."}]}},
    {result: {...data, actionPlan: [{...action, sourceIds: [...action.sourceIds, "unknown"]}]}},
  ]) {
    const checked = validateLegalGatewayAnswer({...input, run, result: data, ...overrides}).run.data;
    assert.equal(checked.actionPlan.some(item => item.title === action.title), false);
  }
});

test("independent finding support retains complementary citations and consumes its private decision", () => {
  const finding = {title: "Медиация приостанавливает течение срока",
    explanation: "Течение срока обращения как в комиссию по трудовым спорам, так и в суд приостанавливается на период рассмотрения индивидуального трудового спора в порядке медиации.",
    sourceIds: action.sourceIds, requirementIds: ["mediation"], answerRole: "governing_rule" as const};
  const result = {...data, confirmedFindings: [finding]};
  const checked = (decision: number[]) => validateLegalGatewayAnswer({...input, result,
    run: {...run, data: result, findingAssessments: [parseLegalFindingAssessment({f1: decision.map(index => action.sourceIds[index])}, input, [finding])]}});
  assert.deepEqual(checked([0, 1]).run.data.confirmedFindings[0]?.sourceIds, action.sourceIds);
  assert.equal(checked([0, 1]).run.findingAssessments, undefined);
  assert.equal(checked([]).run.data.confirmedFindings.length, 0);
  assert.equal(checked([]).run.data.responseKind, "clarification_required");
  assert.equal(checked([]).removedClaimCount, 1);
  assert.equal(checked([0, 1]).removedClaimCount, 0);
});

test("attempt accounting includes both writers and their independent assessments", () => {
  const checked = validateLegalGatewayAnswer({...input, result: data, run: {...run, attempts: 6}});
  assert.equal(checked.answer.providerMetadata.attempts, 6);
});

test("an incomplete scope keeps an independently supported action with complementary citations", () => {
  const assessed = parseLegalGuidanceAssessment({supportedActions: [0], r1: []}, input, data.actionPlan);
  const checked = validateLegalGatewayAnswer({...input, result: data, run: {...run, guidanceAssessments: [assessed]}});
  assert.deepEqual(checked.run.data.actionPlan[0]?.sourceIds, action.sourceIds);
  assert.equal(checked.coverageDiagnostics.missingGuidanceRequirementCount, 1);
  assert.equal(checked.run.data.responseKind, "clarification_required");
});

test("explicitly unsupported actions are removed even if they share the right words and citations", () => {
  const result = {...data, actionPlan: [{...action, sourceIds: [sources[0]!.id]}]};
  const assessed = parseLegalGuidanceAssessment({supportedActions: [], r1: [0]}, input, result.actionPlan);
  const checked = validateLegalGatewayAnswer({...input, result, run: {...run, data: result, guidanceAssessments: [assessed]}});
  assert.equal(checked.run.data.actionPlan.length, 0);
  assert.equal(checked.coverageDiagnostics.missingGuidanceRequirementCount, 1);
  assert.equal(checked.removedClaimCount, 1);
});

test("an independently assessed protected-status provision survives complementary lexical coverage", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/complementary-protected-status-evidence.json", import.meta.url), "utf8"));
  const evidence: LegalSourceContext[] = fixture.sources.map((source: LegalSourceContext) => ({...sources[0]!, ...source}));
  const request = {...input, sources: evidence, coverageRequirements: []};
  const result = {...data, confirmedFindings: [fixture.finding], actionPlan: []};
  const assessment = parseLegalFindingAssessment({f1: fixture.finding.sourceIds}, request, result.confirmedFindings);
  const checked = (context = request, findings = result.confirmedFindings) => validateLegalGatewayAnswer({...context,
    result: {...result, confirmedFindings: findings}, run: {...run, data: result, findingAssessments: [assessment], guidanceAssessments: []}});
  assert.deepEqual(checked().run.data.confirmedFindings[0]?.sourceIds, fixture.finding.sourceIds);
  assert.equal(checked({...request, question: "Another question"}).run.data.confirmedFindings.length, 0);
  assert.equal(checked(request, [{...fixture.finding, explanation: fixture.finding.explanation + " 987654."}])
    .run.data.confirmedFindings.some(item => item.title === fixture.finding.title || item.explanation.includes("987654")), false);
  const invalidSpans = evidence.map(source => ({...source, spans: source.spans!.map(span => ({...span, textSha256: "invalid"}))}));
  assert.equal(checked({...request, sources: invalidSpans}).run.data.confirmedFindings.length, 0);
  const rebind = (context: LegalChatRequest, proposed = result) => validateLegalGatewayAnswer({...context, result: proposed,
    run: {...run, data: proposed, guidanceAssessments: [], findingAssessments: [
      parseLegalFindingAssessment({f1: fixture.finding.sourceIds}, context, proposed.confirmedFindings),
    ]}});
  assert.equal(rebind({...request, sources: invalidSpans}).run.data.confirmedFindings.length, 0,
    "even a positive semantic decision cannot authorize malformed span evidence");
  const multiSpan = evidence.map(source => ({...source, spans: [...source.spans!, {...source.spans![0]!, id: "another-span"}]}));
  assert.equal(rebind({...request, sources: multiSpan}).run.data.confirmedFindings.length, 0,
    "source-level approval cannot pick an arbitrary span in a multi-span source");
  const invented = {...result, confirmedFindings: [{...fixture.finding, explanation: fixture.finding.explanation + " 987654."}]};
  assert.equal(rebind(request, invented).run.data.confirmedFindings.some(item =>
    item.title === fixture.finding.title || item.explanation.includes("987654")), false,
    "even fresh semantic approval cannot override collective numeric support");
});
