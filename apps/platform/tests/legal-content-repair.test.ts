import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {createLegalAiGateway} from "../lib/ai/legal-ai-gateway";
import {parseLegalChatResponse} from "../lib/ai/legal-chat-schema";
import {legalAiProvider, type LegalChatRequest, type LegalSourceContext} from "../lib/ai/provider";

const buyer = "The buyer must submit a signed application and proof of identity to the registry.";
const seller = "The seller must notify the registry after transferring ownership and attach the transfer certificate.";
const source: LegalSourceContext = {id: "official:registry:1", actTitle: "Registration duties", article: "1",
  actIdentifier: "registry", officialUrl: "https://lex.uz/docs/registry", revisionDate: null,
  lastCheckedAt: "2026-09-12T00:00:00Z", locale: "en", publishedAt: null, sourceType: "lex", status: "verified",
  verificationState: "direct_validated", verifiedAt: "2026-09-12T00:00:00Z", contentSha256: "a".repeat(64),
  applicabilityStatus: "current", sourceClass: "OFFICIAL_LEGISLATION",
  sourceQuality: {passed: true, title: true, sufficientText: true, clean: true, locale: true, canonicalUrl: true, structured: true},
  spans: [{id: "full", article: "1", paragraph: null, text: `${buyer} ${seller}`, textSha256: "b".repeat(64), quality: "high"}]};
const input: LegalChatRequest = {question: "What must the buyer and seller do when ownership transfers?", sources: [source],
  locale: "en", answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt,
  requestId: "content-repair", safetyIdentifier: "test", coverageRequirements: [buyer, seller].map((statement, index) => ({
    id: index ? "seller" : "buyer", statement, priority: "core", scopeKind: "general", sourceIds: [source.id],
  }))};

test("repair carries exact retained rule context into a practical step before independent validation", () => {
  const retained = {summary: buyer, summarySourceIds: [source.id], confirmedFindings: [
    {title: "Buyer duty", explanation: buyer, sourceIds: [source.id], requirementIds: ["buyer"], answerRole: "governing_rule" as const},
  ]};
  const candidate = {responseKind: "answer", summary: "", summarySourceIds: [], confirmedFindings: [],
    coverage: {r1: []}, guidanceCoverage: {r1: [0]},
    actionPlan: [{title: "Prepare the submission", description: "Submit the application to the registry.",
      sourceIds: [], retainedFindingIndexes: [0]}], risks: [], deadlines: [], conditionalBranches: [],
    clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
  const context = {...input, coverageRequirements: input.coverageRequirements!.slice(0, 1), contentRepair: {retained}};
  const parsed = parseLegalChatResponse(candidate, context);
  assert.equal(parsed.summary, buyer);
  assert.equal(parseLegalChatResponse({...candidate, summary: seller, summarySourceIds: ["s1"]}, context).summary, seller);
  assert.equal(parsed.actionPlan[0]!.description, `Submit the application to the registry.\n\n${buyer}`);
  assert.deepEqual(parsed.actionPlan[0]!.sourceIds, [source.id]);
  assert.equal("retainedFindingIndexes" in parsed.actionPlan[0]!, false);
  const aliasCollision = parseLegalChatResponse({...candidate, actionPlan: [{...candidate.actionPlan[0], sourceIds: ["s1"]}]},
    {...context, sources: [{id: "s2"}, {id: "official:other"}], contentRepair: {retained: {...retained, summarySourceIds: ["s2"],
      confirmedFindings: [{...retained.confirmedFindings[0]!, sourceIds: ["s2"]}]}}});
  assert.deepEqual(aliasCollision.actionPlan[0]!.sourceIds, ["s2"]);
  assert.deepEqual(aliasCollision.summarySourceIds, ["s2"]);
  assert.throws(() => parseLegalChatResponse({...candidate, actionPlan: [{...candidate.actionPlan[0], retainedFindingIndexes: [1]}]}, context));
  assert.throws(() => parseLegalChatResponse(candidate, {...context, coverageRequirements: [{id: "seller"}]}));
  assert.throws(() => parseLegalChatResponse(candidate, {...context, contentRepair: {retained: {...retained,
    confirmedFindings: [{...retained.confirmedFindings[0]!, explanation: "x".repeat(2_001)}]}}}));
});

for (const initialFailure of ["omitted", "rejected"] as const) test(`sufficient evidence repairs ${initialFailure} guidance while preserving the validated independent findings`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  let repairRequested = false;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_guidance_coverage") {
      if (repairRequested) {
        assert.equal(payload.actions[1].description, `Notify the registry.\n\n${seller}`);
        assert.deepEqual(payload.actions[1].sourceIds, [source.id]);
      }
      data = {scopeGaps: {r1: {quotation: "", sourceId: "", reason: ""}, r2: repairRequested
        ? {quotation: "", sourceId: "", reason: ""}
        : {quotation: seller, sourceId: source.id, reason: "Seller notification and its accompanying certificate are missing."}},
        supportedActions: repairRequested ? payload.actions.map((_: unknown, index: number) => index) : [0],
        sourceSupport: Object.fromEntries(payload.actions.map((action: {sourceIds: string[]}, index: number) =>
          [`a${index}`, repairRequested || index === 0 ? action.sourceIds : []])),
        r1: [0], r2: repairRequested ? [1] : []};
    } else {
      assert.equal(request.model, "gpt-5.6-terra");
      repairRequested = Boolean(payload.contentRepair);
      if (repairRequested) {
        assert.deepEqual(payload.contentRepair.unresolved.map((item: {requirementId: string}) => item.requirementId), ["r2"]);
        assert.deepEqual(payload.contentRepair.materialGaps, [{requirementId: "r2", sourceId: "s1", sourceSpanId: "s1-1", quotation: seller}]);
        assert.equal(payload.contentRepair.materialGaps[0].sourceSpanId, payload.verifiedSources[0].sourceSpans[0].sourceSpanId);
        assert.equal(payload.verifiedSources[0].sourceSpans[0].text, source.spans![0]!.text);
        assert.equal(payload.contentRepair.retainedFindings.length, 2);
        assert.equal(payload.contentRepair.retainedActions.length, 1);
      }
      data = {responseKind: "answer", summary: repairRequested ? "" : "Buyer and seller have separate registry duties.", summarySourceIds: ["s1"],
        confirmedFindings: repairRequested ? [] : [buyer, seller].map((explanation, index) => ({
          title: index ? "Seller duty" : "Buyer duty", explanation, sourceIds: ["s1"], answerRole: "governing_rule"})),
        coverage: {r1: repairRequested ? [] : [0], r2: repairRequested ? [] : [1]},
        actionPlan: [{title: repairRequested ? "Notify the registry" : "Submit the application",
          description: repairRequested ? "Notify the registry." : buyer, sourceIds: repairRequested ? [] : ["s1"],
          ...(repairRequested ? {retainedFindingIndexes: [1]} : {})},
          ...(!repairRequested && initialFailure === "rejected" ? [{title: "Wait before notifying",
            description: "The seller must wait 365 days before notifying the registry.", sourceIds: ["s1"]}] : [])],
        guidanceCoverage: {r1: repairRequested ? [] : [0], r2: repairRequested ? [0] : initialFailure === "rejected" ? [1] : []},
        risks: [], deadlines: [], conditionalBranches: [], clarificationQuestions: [], urgency: "normal",
        suggestedDocument: null, suggestLawyer: false};
    }
    return Response.json({id: "content-result", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}],
      usage: {input_tokens: 100, output_tokens: 100}});
  });
  const checked = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer(input, {fallbackEnabled: false});
  assert.equal(checked.run.data.responseKind, "answer");
  assert.deepEqual(checked.run.data.confirmedFindings.map(item => item.explanation), [buyer, seller]);
  assert.deepEqual(checked.run.data.actionPlan.map(item => item.description), [buyer, `Notify the registry. ${seller}`]);
  assert.equal(checked.coverageDiagnostics.missingGuidanceRequirementCount, 0);
  assert.deepEqual(checked.run.data.coverageGaps, []);
  assert.equal(repairRequested, true);
});

test("unavailable content repair retains the validated partial answer and reports incomplete recovery", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    if (payload.contentRepair) throw new TypeError("Provider unavailable during repair");
    const data = request.text.format.name === "juro_legal_guidance_coverage"
      ? {supportedActions: [0], r1: [0], r2: [], sourceSupport: {a0: [source.id]},
        scopeGaps: {r1: {quotation: "", sourceId: "", reason: ""}, r2: {quotation: "", sourceId: "", reason: ""}}}
      : {responseKind: "answer", summary: "Both parties have registry duties.", summarySourceIds: ["s1"],
        confirmedFindings: [buyer, seller].map((explanation, index) => ({title: index ? "Seller duty" : "Buyer duty",
          explanation, sourceIds: ["s1"], answerRole: "governing_rule"})), coverage: {r1: [0], r2: [1]},
        actionPlan: [{title: "Submit the application", description: buyer, sourceIds: ["s1"]}],
        guidanceCoverage: {r1: [0], r2: []}, risks: [], deadlines: [], conditionalBranches: [],
        clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
    return Response.json({id: "partial-result", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 100}});
  });
  const checked = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer(input, {fallbackEnabled: false});
  assert.equal(checked.run.data.responseKind, "clarification_required");
  assert.deepEqual(checked.run.data.confirmedFindings.map(item => item.explanation), [buyer, seller]);
  assert.deepEqual(checked.run.data.actionPlan.map(item => item.description), [buyer]);
  assert.equal(checked.contentRepair?.outcome, "unavailable");
});
