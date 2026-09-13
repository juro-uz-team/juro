import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {createLegalAiGateway} from "../lib/ai/legal-ai-gateway";
import {legalAiProvider, type LegalChatRequest, type LegalSourceContext} from "../lib/ai/provider";
import {legalChatJsonSchemaForCoverage, parseLegalChatResponse} from "../lib/ai/legal-chat-schema";
import {legalSourcePassages} from "../lib/ai/legal-source-passages";

const rule = "The buyer must apply within 6 days after receiving a copy of the notice. The period is suspended during mediation.";
const source: LegalSourceContext = {id: "official:registry:1", actTitle: "Registry procedure", article: "1",
  actIdentifier: "registry", officialUrl: "https://lex.uz/docs/registry", revisionDate: null,
  lastCheckedAt: "2026-09-13T00:00:00Z", locale: "en", publishedAt: null, sourceType: "lex", status: "verified",
  verificationState: "direct_validated", verifiedAt: "2026-09-13T00:00:00Z", contentSha256: "a".repeat(64),
  applicabilityStatus: "current", sourceClass: "OFFICIAL_LEGISLATION",
  spans: [{id: "full", article: "1", paragraph: null, text: rule, textSha256: "b".repeat(64), quality: "high"}],
  sourceQuality: {passed: true, title: true, sufficientText: true, clean: true, locale: true, canonicalUrl: true, structured: true}};
const input: LegalChatRequest = {question: "What must the buyer do?", sources: [source], locale: "en",
  answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt,
  requestId: "source-linked-guidance", safetyIdentifier: "test", coverageRequirements: [{id: "filing", statement: "Buyer filing procedure",
    scopeKind: "general", priority: "core", sourceIds: [source.id]}]};

test("repair offers a single composition contract and rejects mixed references", () => {
  const schema = legalChatJsonSchemaForCoverage([], undefined, true, ["s1-1:p0"]);
  const serialized = JSON.stringify(schema);
  assert.match(serialized, /sourcePassageIds/u);
  assert.doesNotMatch(serialized, /retainedFindingIndexes/u);
  assert.match(JSON.stringify(legalChatJsonSchemaForCoverage([], undefined, true)), /retainedFindingIndexes/u);
  const candidate = {responseKind: "answer", summary: rule, actionPlan: [{title: "Apply", description: "Apply to the registry.",
    sourceIds: [], sourcePassageIds: ["s1-1:p0"], retainedFindingIndexes: [0]}], guidanceCoverage: {r1: [0]}, risks: [],
    clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
  assert.throws(() => parseLegalChatResponse(candidate, {...input, synthesisPart: "guidance"}), /LEGAL_GUIDANCE_COMPOSITION_CONFLICT/u);
});

test("the optional passage view respects the complete evidence context bound", () => {
  const within = {...source, spans: [{...source.spans![0]!, text: "x".repeat(16_000)}]};
  assert.equal(legalSourcePassages([within], "en")[0]!.text.length, 16_000);
  const oversized = {...source, spans: [{...source.spans![0]!, text: "x".repeat(16_001)}]};
  assert.deepEqual(legalSourcePassages([oversized], "en"), []);
  assert.equal(oversized.spans[0]!.text.length, 16_001, "complete original evidence remains intact");
});

test("source passage references cannot inject a different response language", () => {
  const candidate = {responseKind: "answer", summary: rule, actionPlan: [{title: "Apply", description: "Apply to the registry.",
    sourceIds: [], sourcePassageIds: ["s1-1:p0"]}], guidanceCoverage: {r1: [0]}, risks: [],
    clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
  assert.throws(() => parseLegalChatResponse(candidate, {...input, synthesisPart: "guidance", sources: [{...source, locale: "ru"}]}));
});

test("passage composition rejects unavailable evidence, missing instructions and overflowing advice without truncation", () => {
  const action = {title: "Apply", description: "Apply to the registry.", sourceIds: [], sourcePassageIds: ["s1-1:p0"]};
  const candidate = {responseKind: "answer", summary: rule, actionPlan: [action], guidanceCoverage: {r1: [0]}, risks: [],
    clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
  const context = {...input, synthesisPart: "guidance" as const};
  for (const invalid of ["s2-1:p0", "s1-2:p0", "s1-1:p999"])
    assert.throws(() => parseLegalChatResponse({...candidate, actionPlan: [{...action, sourcePassageIds: [invalid]}]}, context));
  for (const invalid of [{...source, sourceClass: "SECONDARY_REFERENCE" as const}, {...source, status: "unverified" as const},
    {...source, spans: source.spans!.map(span => ({...span, quality: "low" as const}))}])
    assert.throws(() => parseLegalChatResponse(candidate, {...context, sources: [invalid]}));
  for (const description of ["", "   ", "Apply. ".repeat(400)])
    assert.throws(() => parseLegalChatResponse({...candidate, actionPlan: [{...action, description}]}, context));
  assert.throws(() => parseLegalChatResponse(candidate, {...context, locale: "uz",
    sources: [{...source, locale: "uz-Cyrl", spans: [{...source.spans![0]!, text: "Қоида қўлланади."}]}]}));
});

for (const reasoningMode of ["deep", "fast"] as const) test(`${reasoningMode} practical instructions retain exact selected source conditions through independent assessment and grounding`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  let independentlyAssessed = false;
  let repairRequested = false;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_finding_support") {
      data = {f1: [source.id], scopeCoverage: {r1: [0]}, scopeGaps: {r1: []}};
    } else if (request.text.format.name === "juro_legal_guidance_coverage") {
      independentlyAssessed = true;
      assert.equal(payload.actions[0].description, "File the application with the registry.\n\n" +
        "The buyer must apply within 6 days after receiving a copy of the notice. \n\nThe period is suspended during mediation.");
      assert.deepEqual(payload.actions[0].sourceIds, [source.id]);
      data = {supportedActions: [0], r1: [0], sourceSupport: {a0: [source.id]}, scopeGaps: {r1: []}};
    } else {
      assert.equal(Boolean(payload.contentRepair), repairRequested);
      if (request.text.format.schema.properties.actionPlan) {
        assert.equal(payload.verifiedPassages.map((passage: {text: string}) => passage.text).join(""), rule);
        assert.deepEqual(request.text.format.schema.properties.actionPlan.items.properties.sourcePassageIds.items.enum,
          ["s1-1:p0", "s1-1:p1"]);
        assert.equal(request.text.format.schema.properties.actionPlan.items.properties.retainedFindingIndexes, undefined);
      } else assert.equal(payload.verifiedPassages, undefined, "finding-only generation keeps its existing evidence contract");
      data = {responseKind: "answer", summary: rule, summarySourceIds: ["s1"],
        confirmedFindings: [{title: "Buyer filing procedure", explanation: rule, sourceIds: ["s1"], answerRole: "governing_rule"}],
        coverage: {r1: [0]}, guidanceCoverage: {r1: [0]},
        actionPlan: [{title: "Apply to the registry", description: "File the application with the registry.", sourceIds: [],
          sourcePassageIds: ["s1-1:p0", "s1-1:p1"]}],
        risks: [], deadlines: [], conditionalBranches: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
    }
    return Response.json({id: "source-linked", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
  });
  const result = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer({...input, reasoningMode}, {fallbackEnabled: false});
  assert.equal(independentlyAssessed, true);
  assert.equal(result.run.data.responseKind, "answer");
  assert.match(result.run.data.actionPlan[0]!.description, /receiving a copy of the notice/u);
  assert.match(result.run.data.actionPlan[0]!.description, /suspended during mediation/u);
  assert.equal("sourcePassageIds" in result.run.data.actionPlan[0]!, false, "selection metadata is consumed before persistence");
  repairRequested = true;
  independentlyAssessed = false;
  const repaired = await legalAiProvider()!.runLegalChat({...input, reasoningMode, contentRepair: {
    unresolved: [{requirementId: "filing", finding: null, guidanceMissing: true}], retained: {...result.run.data, actionPlan: []},
  }});
  assert.equal(independentlyAssessed, true);
  assert.equal(repaired.data.actionPlan[0]!.description.replace(/\s+/gu, " "), result.run.data.actionPlan[0]!.description.replace(/\s+/gu, " "),
    "repair composes the same source conditions once, without also appending retained findings");
});
