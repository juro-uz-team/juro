import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {createLegalAiGateway} from "../lib/ai/legal-ai-gateway";
import {legalAiProvider, type LegalChatRequest, type LegalSourceContext} from "../lib/ai/provider";
import {legalChatJsonSchemaForCoverage, parseLegalChatResponse} from "../lib/ai/legal-chat-schema";
import {legalSourcePassageView, legalSourcePassages, legalSourceSpanTextView} from "../lib/ai/legal-source-passages";

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
  assert.equal(legalSourcePassages([oversized], "en")[0]!.text.length, 16_001);
  assert.equal("text" in legalSourcePassageView([oversized], legalSourcePassages([oversized], "en"))[0]!, false);
  const unavailable = {...source, spans: [{...source.spans![0]!, text: "x".repeat(32_001)}]};
  assert.deepEqual(legalSourcePassages([unavailable], "en"), []);
  assert.equal(oversized.spans[0]!.text.length, 16_001, "complete original evidence remains intact");
});

test("an oversized source-composed action does not discard valid neighboring actions or shift their scopes", () => {
  const longSource = {...source, id: "official:registry:2", spans: [{...source.spans![0]!,
    text: "The permit requires " + "verified documentation and ".repeat(80) + "a signature."}]};
  const request = {...input, synthesisPart: "guidance" as const, sources: [source, longSource],
    coverageRequirements: ["filing", "permit", "mediation"].map(id => ({id, statement: id,
      scopeKind: "general" as const, priority: "core" as const, sourceIds: [source.id, longSource.id]}))};
  const data = parseLegalChatResponse({responseKind: "answer", summary: rule, guidanceCoverage: {r1: [0], r2: [1], r3: [2]},
    actionPlan: [
      {title: "Apply", description: "Apply to the registry.", sourceIds: [], sourcePassageIds: ["s1-1:p0"]},
      {title: "Permit", description: "Check the permit conditions.", sourceIds: [], sourcePassageIds: ["s2-1:p0"]},
      {title: "Mediation", description: "Account for mediation.", sourceIds: [], sourcePassageIds: ["s1-1:p1"]},
    ], risks: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false}, request);
  assert.deepEqual(data.actionPlan.map(action => action.requirementIds), [["filing"], ["mediation"]]);
  assert.deepEqual(data.actionPlan.map(action => action.description), [
    "Apply to the registry.\n\nThe buyer must apply within 6 days after receiving a copy of the notice. ",
    "Account for mediation.\n\nThe period is suspended during mediation.",
  ]);
  assert.equal(data.actionPlan.some(action => action.requirementIds?.includes("permit")), false,
    "the missing permit scope remains available to independent assessment and repair");
  assert.throws(() => parseLegalChatResponse({responseKind: "answer", summary: rule,
    guidanceCoverage: {r1: [0], r2: [], r3: []},
    actionPlan: [...Array.from({length: 16}, () => ({title: "Apply", description: "Apply to the registry.",
      sourceIds: [source.id], sourcePassageIds: []})),
      {title: "Permit", description: "Check the permit conditions.", sourceIds: [], sourcePassageIds: ["s2-1:p0"]}],
    risks: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false}, request),
  "discarding a composed overflow must not hide an oversized raw action array");
});

test("source passage references cannot inject a different response language", () => {
  const candidate = {responseKind: "answer", summary: rule, actionPlan: [{title: "Apply", description: "Apply to the registry.",
    sourceIds: [], sourcePassageIds: ["s1-1:p0"]}], guidanceCoverage: {r1: [0]}, risks: [],
    clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
  assert.throws(() => parseLegalChatResponse(candidate, {...input, synthesisPart: "guidance", sources: [{...source, locale: "ru"}]}));
});

test("source span serialization rejects missing, duplicated, reordered and mismatched sentence navigation", () => {
  const text = `First rule requires ${"📄".repeat(8_000)}.\r\nAnother rule applies.\nAn exception remains.`;
  const evidence = {...source, spans: [{...source.spans![0]!, text}]};
  const references = legalSourcePassageView([evidence], legalSourcePassages([evidence], "en"));
  assert.equal(references.length, 3);
  const view = legalSourceSpanTextView(text, "s1-1", references);
  assert.ok(view.sentences);
  assert.equal(view.sentences.map(sentence => sentence.text).join(""), text);
  for (const invalid of [
    [references[0]!, references[2]!],
    references.slice(0, -1),
    [references[0]!, references[1]!, references[1]!, references[2]!],
    [references[1]!, references[0]!, references[2]!],
    references.map((reference, index) => index ? reference : {...reference, id: "s2-1:p0"}),
    references.map((reference, index) => index ? reference : {...reference, sourceSpanId: "s2-1"}),
    references.map((reference, index) => index ? reference : {...reference, end: reference.end + 1}),
  ]) assert.throws(() => legalSourceSpanTextView(text, "s1-1", invalid), /LEGAL_PASSAGE_CONTEXT_UNAVAILABLE/u);

  view.sentences[1]!.text = "A changed writer-facing quotation is not canonical evidence.";
  const parsed = parseLegalChatResponse({responseKind: "answer", summary: "Read the applicable rule.",
    actionPlan: [{title: "Read the rule", description: "Read the second rule.", sourceIds: [], sourcePassageIds: ["s1-1:p1"]}],
    guidanceCoverage: {r1: [0]}, risks: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null,
    suggestLawyer: false}, {...input, synthesisPart: "guidance", sources: [evidence]});
  assert.equal(parsed.actionPlan[0]?.description, "Read the second rule.\n\nAnother rule applies.\n");
});

for (const repairAvailable of [true, false]) test(`oversized composition preserves valid actions and requires supported scope repair: ${repairAvailable}`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const permitRule = "The permit requires verified documentation and a signature.";
  const permit = {...source, id: "official:registry:2", article: "2", spans: [{...source.spans![0]!, article: "2",
    text: "The permit requires " + "verified documentation and ".repeat(80) + "a signature."}]};
  const requestInput: LegalChatRequest = {...input, sources: [source, permit], coverageRequirements: [
    input.coverageRequirements![0]!, {id: "permit", statement: "Permit documentation and signature", scopeKind: "general",
      priority: "core", sourceIds: [permit.id]},
  ]};
  let writerCalls = 0;
  let assessmentCalls = 0;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_evidence_routing") {
      assert.deepEqual(payload.requirements.map((scope: {id: string}) => scope.id), ["permit"]);
      data = {permit: {decision: "sufficient", support: [{sourceId: permit.id, quotation: permit.spans[0]!.text}], missingEvidenceQuestion: ""}};
    } else if (request.text.format.name === "juro_legal_finding_support") {
      data = {f1: [source.id], f2: [permit.id], scopeCoverage: {r1: [0], r2: [1]}, scopeGoverning: {r1: [0], r2: [1]},
        scopeGaps: {r1: [], r2: []}, mainPoint: {supported: false, findingIndexes: [], scopeCoverage: {r1: false, r2: false}}};
    } else if (request.text.format.name === "juro_legal_guidance_coverage") {
      assessmentCalls++;
      const repaired = payload.actions.length === 2;
      assert.equal(payload.actions[0].description, rule, "the valid original action survives without rewriting");
      if (repaired) assert.equal(payload.actions[1].description, permitRule);
      data = {supportedActions: repaired ? [0, 1] : [0], r1: [0], r2: repaired ? [1] : [],
        sourceSupport: repaired ? {a0: [source.id], a1: [permit.id]} : {a0: [source.id]},
        scopeGaps: {r1: [], r2: repaired ? [] : [{sourceId: permit.id, quotation: "a signature.", reason: "No permit guidance remains."}]}};
    } else {
      writerCalls++;
      const repair = Boolean(payload.contentRepair);
      assert.equal(repair, writerCalls === 2, "composition overflow reaches scoped repair, not a whole-response retry");
      if (repair) {
        assert.equal(payload.contentRepair.unresolved.length, 1);
        assert.equal(payload.contentRepair.unresolved[0].requirementId, "r2");
        if (!repairAvailable) return Response.json({error: {message: "Repair unavailable", type: "invalid_request_error"}}, {status: 400});
      }
      data = {responseKind: "answer", summary: rule, summarySourceIds: ["s1"],
        confirmedFindings: repair ? [] : [
          {title: "Buyer filing procedure", explanation: rule, sourceIds: ["s1"], answerRole: "governing_rule"},
          {title: "Permit documentation", explanation: permitRule, sourceIds: ["s2"], answerRole: "governing_rule"},
        ], coverage: repair ? {r1: [], r2: []} : {r1: [0], r2: [1]},
        guidanceCoverage: repair ? {r1: [], r2: [0]} : {r1: [0], r2: [1]},
        actionPlan: repair ? [{title: "Permit documentation", description: permitRule, sourceIds: ["s2"], sourcePassageIds: []}]
          : [{title: "Buyer filing procedure", description: rule, sourceIds: ["s1"], sourcePassageIds: []},
            {title: "Permit documentation", description: "Check the permit conditions.", sourceIds: [], sourcePassageIds: ["s2-1:p0"]}],
        risks: [], deadlines: [], conditionalBranches: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
    }
    return Response.json({id: "source-composition-repair", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
  });
  const result = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer(requestInput, {fallbackEnabled: false});
  assert.equal(writerCalls, 2);
  assert.equal(assessmentCalls, repairAvailable ? 2 : 1);
  assert.equal(result.run.data.responseKind, repairAvailable ? "answer" : "clarification_required");
  assert.deepEqual(result.run.data.actionPlan.map(action => action.description), repairAvailable ? [rule, permitRule] : [rule]);
  assert.equal(result.coverageDiagnostics.validatedRequirementCount, 2, "both legal finding scopes stay supported");
  assert.equal(result.coverageDiagnostics.unresolvedCoverage.some(scope => scope.requirementIndex === 1 && scope.guidanceMissing), !repairAvailable);
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

for (const largePacket of [false, true]) for (const reasoningMode of ["deep", "fast"] as const) test(`${reasoningMode} ${largePacket ? "sentence-labelled" : "full-text"} practical instructions retain exact selected source conditions through independent assessment and grounding`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const fullText = rule + (largePacket ? " " + Array.from({length: 12}, (_, index) => `Other procedure ${index} requires 📄 ${"additional documentation ".repeat(65)}and review.`).join("\r\n") : "");
  const otherSpan = "A separate permit requires a different application. ";
  const otherLanguage = "Бошқа рухсатнома учун алоҳида ариза талаб қилинади.";
  const requestInput = {...input, reasoningMode, sources: [{...source, spans: [{...source.spans![0]!, text: fullText},
    ...(largePacket ? [{...source.spans![0]!, id: "other-span", text: otherSpan}] : [])]},
    ...(largePacket ? [{...source, id: "official:other-language", locale: "uz-Cyrl", spans: [{...source.spans![0]!, text: otherLanguage}]}] : [])]};
  const originalSources = structuredClone(requestInput.sources);
  let independentlyAssessed = false;
  let repairRequested = false;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_finding_support") {
      assert.equal(payload.sources[0].spans[0].text, fullText);
      assert.deepEqual(payload.sources[0].spans, originalSources[0]!.spans);
      data = {f1: [source.id], scopeCoverage: {r1: [0]}, scopeGoverning: {r1: [0]}, scopeGaps: {r1: []},
        mainPoint: {supported: true, findingIndexes: [0], scopeCoverage: {r1: true}}};
    } else if (request.text.format.name === "juro_legal_guidance_coverage") {
      independentlyAssessed = true;
      assert.equal(payload.sources[0].spans[0].text, fullText);
      assert.deepEqual(payload.sources[0].spans, originalSources[0]!.spans);
      assert.equal(payload.actions[0].description, "File the application with the registry.\n\n" +
        "The buyer must apply within 6 days after receiving a copy of the notice. \n\nThe period is suspended during mediation." + (largePacket ? " " : ""));
      assert.deepEqual(payload.actions[0].sourceIds, [source.id]);
      data = {supportedActions: [0], r1: [0], sourceSupport: {a0: [source.id]}, scopeGaps: {r1: []}};
    } else {
      assert.equal(Boolean(payload.contentRepair), repairRequested);
      if (request.text.format.schema.properties.actionPlan) {
        assert.ok(payload.verifiedPassages.length >= 2);
        if (largePacket) {
          const span = payload.verifiedSources[0].sourceSpans[0];
          assert.equal(span.text, undefined);
          assert.equal(span.sentences.map((sentence: {text: string}) => sentence.text).join(""), fullText);
          assert.deepEqual(span.sentences.slice(0, 2), [
            {sourcePassageId: "s1-1:p0", text: "The buyer must apply within 6 days after receiving a copy of the notice. "},
            {sourcePassageId: "s1-1:p1", text: "The period is suspended during mediation. "},
          ]);
          assert.deepEqual(payload.verifiedSources[0].sourceSpans[1].sentences,
            [{sourcePassageId: "s1-2:p0", text: otherSpan}]);
          assert.equal(payload.verifiedSources[1].sourceSpans[0].text, otherLanguage);
          assert.equal(payload.verifiedSources[1].sourceSpans[0].sentences, undefined);
          assert.ok(payload.verifiedPassages.every((passage: object) => !("text" in passage)));
          assert.deepEqual(payload.verifiedPassages.slice(0, 2).map((passage: {sentenceNumber: number}) => passage.sentenceNumber), [1, 2]);
        } else {
          assert.equal(payload.verifiedSources[0].sourceSpans[0].text, fullText);
          assert.equal(payload.verifiedPassages.map((passage: {text: string}) => passage.text).join(""), rule);
        }
        assert.deepEqual(request.text.format.schema.properties.actionPlan.items.properties.sourcePassageIds.items.enum.slice(0, 2),
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
  const result = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer(requestInput, {fallbackEnabled: false});
  assert.deepEqual(requestInput.sources, originalSources);
  assert.equal(independentlyAssessed, true);
  assert.equal(result.run.data.responseKind, "answer");
  assert.match(result.run.data.actionPlan[0]!.description, /receiving a copy of the notice/u);
  assert.match(result.run.data.actionPlan[0]!.description, /suspended during mediation/u);
  assert.equal("sourcePassageIds" in result.run.data.actionPlan[0]!, false, "selection metadata is consumed before persistence");
  repairRequested = true;
  independentlyAssessed = false;
  const repaired = await legalAiProvider()!.runLegalChat({...requestInput, contentRepair: {
    unresolved: [{requirementId: "filing", finding: null, guidanceMissing: true}], retained: {...result.run.data, actionPlan: []},
  }});
  assert.deepEqual(requestInput.sources, originalSources);
  assert.equal(independentlyAssessed, true);
  assert.equal(repaired.data.actionPlan[0]!.description.replace(/\s+/gu, " ").trim(), result.run.data.actionPlan[0]!.description.replace(/\s+/gu, " ").trim(),
    "repair composes the same source conditions once, without also appending retained findings");
});
