import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {createLegalAiGateway} from "../lib/ai/legal-ai-gateway";
import {parseLegalChatResponse} from "../lib/ai/legal-chat-schema";
import {legalAiProvider, type LegalChatRequest, type LegalSourceContext} from "../lib/ai/provider";
import {ProviderRequestAbortError} from "../lib/ai/provider-request-timeout";

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

for (const reasoningMode of ["deep", "fast"] as const) for (const repairOutcome of ["complete", "timeout", "routing_unavailable", "missing_evidence", "unsupported"] as const)
test(`${reasoningMode} finding assessment timeout quarantines the draft before ${repairOutcome} recovery`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  let repairs = 0;
  let findingCalls = 0;
  let initialGuidanceCalls = 0;
  const observations: string[] = [];
  const poison = "UNASSESSED DRAFT: pay 999 dollars immediately.";
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_evidence_routing") {
      assert.equal(JSON.stringify(payload).includes(poison), false);
      if (repairOutcome === "routing_unavailable") throw new ProviderRequestAbortError("first_byte_timeout");
      if (repairOutcome === "missing_evidence") return Response.json({id: "missing-evidence", model: request.model,
        output: [{content: [{type: "output_text", text: JSON.stringify(Object.fromEntries(payload.requirements.map((item: {id: string}) =>
          [item.id, {decision: "missing_evidence", support: [], missingEvidenceQuestion: "Which operative registry provision applies?"}])))}]}],
        usage: {input_tokens: 100, output_tokens: 20}});
      return evidenceRoutingResponse(request)!;
    }
    if (request.text.format.name === "juro_legal_finding_support") {
      findingCalls++;
      if (!repairs || repairOutcome === "timeout") throw new ProviderRequestAbortError("first_byte_timeout");
      assert.equal(JSON.stringify(payload).includes(poison), false);
      if (repairOutcome === "unsupported") return Response.json({id: "rejected-repair", model: request.model,
        output: [{content: [{type: "output_text", text: JSON.stringify({f1: [], f2: [], scopeCoverage: {r1: [], r2: []},
          scopeGoverning: {r1: [], r2: []}, scopeGaps: {r1: [], r2: []},
          mainPoint: {supported: false, findingIndexes: [], scopeCoverage: {r1: false, r2: false}}})}]}],
        usage: {input_tokens: 100, output_tokens: 20}});
      return findingAssessmentResponse(request)!;
    }
    if (request.text.format.name === "juro_legal_guidance_coverage") {
      if (!repairs) initialGuidanceCalls++;
      assert.equal(JSON.stringify(payload).includes(poison), false);
      data = {supportedActions: [0, 1], r1: [0], r2: [1], sourceSupport: {a0: [source.id], a1: [source.id]},
        scopeGaps: {r1: [], r2: []}};
    } else {
      const repairing = Boolean(payload.contentRepair);
      const guidanceOnly = !request.text.format.schema.properties.confirmedFindings;
      if (repairing) {
        repairs++;
        assert.ok(payload.contentRepair.unresolved.every((item: {finding: string}) => item.finding === "assessment_unavailable"));
        assert.deepEqual(payload.contentRepair.retainedFindings, []);
        assert.equal(payload.contentRepair.retainedActions.length, reasoningMode === "fast" ? 2 : 0);
        assert.equal(JSON.stringify(payload.contentRepair).includes(poison), false);
      }
      const trusted = repairing || guidanceOnly;
      data = {responseKind: "answer", summary: trusted ? buyer : poison, summarySourceIds: ["s1"],
        confirmedFindings: [buyer, seller].map((explanation, index) => ({title: index ? "Seller duty" : "Buyer duty",
          explanation: trusted ? explanation : poison, sourceIds: ["s1"], answerRole: "governing_rule"})),
        coverage: {r1: [0], r2: [1]}, guidanceCoverage: {r1: [0], r2: [1]},
        actionPlan: [buyer, seller].map(description => ({title: "Registry duty", description: trusted ? description : poison, sourceIds: ["s1"]})),
        risks: trusted ? [] : [{level: "critical", title: poison, explanation: poison, sourceIds: ["s1"]}],
        deadlines: [], conditionalBranches: trusted ? [] : [{condition: poison, outcome: poison, sourceIds: ["s1"]}],
        clarificationQuestions: trusted ? [] : [poison], urgency: trusted ? "normal" : "critical",
        suggestedDocument: trusted ? null : {templateCode: null, title: poison, reason: poison}, suggestLawyer: !trusted};
    }
    return Response.json({id: "finding-timeout-recovery", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
  });
  const checked = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer({...input, reasoningMode}, {
    fallbackEnabled: false, onProviderAttemptFinished: observation => {observations.push(`${observation.part}:${observation.outcome}`);},
  });
  const routingBlocked = repairOutcome === "routing_unavailable" || repairOutcome === "missing_evidence";
  const repairAssessed = repairOutcome === "complete" || repairOutcome === "unsupported";
  assert.equal(repairs, routingBlocked ? 0 : 1);
  assert.equal(findingCalls, routingBlocked ? 1 : 2);
  assert.equal(initialGuidanceCalls, reasoningMode === "fast" ? 1 : 0);
  assert.equal(JSON.stringify(checked).includes(poison), false);
  assert.equal(checked.run.data.responseKind, repairOutcome === "complete" ? "answer" : "clarification_required");
  assert.equal(checked.run.sourceFallback, undefined);
  assert.equal(checked.coverageDiagnostics.findingAssessmentUnavailable, repairAssessed ? undefined : true);
  if (!repairAssessed) {
    assert.equal(checked.coverageDiagnostics.writerOmissionCount, 0);
    assert.equal(checked.coverageDiagnostics.validatorRejectionCount, 0);
    assert.equal(checked.run.data.failureReason, "answer_verification_unavailable");
    assert.match(checked.answer.answer, /answer verification is temporarily unavailable/u);
    assert.doesNotMatch(checked.answer.answer, /could not be retrieved|requires more facts/u);
    assert.deepEqual(checked.run.data.clarificationQuestions, [], "verification failure does not invent a request for facts");
  } else {
    assert.notEqual(checked.run.data.failureReason, "answer_verification_unavailable", "a completed repair assessment replaces the current failure reason");
  }
  assert.deepEqual(checked.run.initialFindingAssessmentFailure, {code: "PROVIDER_TIMEOUT"});
  assert.deepEqual(checked.run.data.confirmedFindings.map(item => item.explanation), repairOutcome === "complete"
    ? [buyer, seller] : reasoningMode === "deep" && !repairAssessed ? [buyer] : [], "source extracts remain explicitly incomplete and never enter repair retention");
  assert.deepEqual(checked.run.data.actionPlan.map(item => item.description), reasoningMode === "fast" || repairAssessed ? [buyer, seller] : []);
  assert.equal(observations.filter(item => item === "finding_validation:failed").length, repairOutcome === "timeout" ? 2 : 1);
});

function evidenceRoutingResponse(request: {text: {format: {name: string}}; input: string; model: string}) {
  if (request.text.format.name !== "juro_legal_evidence_routing") return null;
  const payload = JSON.parse(request.input);
  const witnesses: Record<string, string[]> = {buyer: [buyer], seller: [seller], registry: [buyer, seller]};
  assert.deepEqual(payload.sources[0].spans.map(({sentences, ...span}: {
    sentences?: Array<{text: string}>; [key: string]: unknown;
  }) => sentences ? {...span, text: sentences.map(part => part.text).join("")} : span), source.spans);
  const data = Object.fromEntries(payload.requirements.map((scope: {id: string}) => {
    assert.ok(witnesses[scope.id], "the controlled registry fixture must name a known scope");
    return [scope.id, {decision: "sufficient", support: witnesses[scope.id]!.map(quotation => ({sourceId: source.id, quotation})),
      missingEvidenceQuestion: ""}];
  }));
  return Response.json({id: "registry-evidence-routing", model: request.model,
    output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
}

function findingAssessmentResponse(request: {text: {format: {name: string}}; input: string; model: string}) {
  if (request.text.format.name !== "juro_legal_finding_support") return null;
  const payload: {findings: Array<{sourceIds: string[]; explanation: string}>; sources: Array<{id: string}>} = JSON.parse(request.input);
  const sourceIds = new Set(payload.sources.map(item => item.id));
  const support = Object.fromEntries(payload.findings.map((finding, index) =>
    [`f${index + 1}`, finding.sourceIds.filter(id => sourceIds.has(id))]));
  const coverage = [buyer, seller].map(rule => payload.findings.flatMap((finding, index) => finding.explanation === rule ? [index] : []));
  Object.assign(support, {scopeCoverage: {r1: coverage[0], r2: coverage[1]}, scopeGoverning: {r1: coverage[0], r2: coverage[1]}, scopeGaps: {r1: [], r2: []},
    mainPoint: {supported: false, findingIndexes: [], scopeCoverage: {r1: false, r2: false}}});
  return Response.json({id: "finding-support", model: request.model,
    output: [{content: [{type: "output_text", text: JSON.stringify(support)}]}], usage: {input_tokens: 100, output_tokens: 20}});
}

test("finding gaps reach one bounded repair even when practical guidance already covers the scope", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const requestInput: LegalChatRequest = {...input, coverageRequirements: [{id: "registry", statement: input.question,
    priority: "core", scopeKind: "general", sourceIds: [source.id]}]};
  let repaired = false;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const routingResponse = evidenceRoutingResponse(request);
    if (routingResponse) return routingResponse;
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_finding_support") {
      data = {f1: [source.id], ...(repaired ? {f2: [source.id]} : {}), mainPoint: {supported: false, findingIndexes: [], scopeCoverage: {r1: false}},
        scopeCoverage: {r1: repaired ? [0, 1] : []}, scopeGoverning: {r1: repaired ? [0, 1] : []}, scopeGaps: {r1: repaired ? [] : [
          {sourceId: source.id, quotation: seller, reason: "Seller duty is absent from findings"}]}};
    } else if (request.text.format.name === "juro_legal_guidance_coverage") {
      data = {supportedActions: [0, 1], r1: [0, 1], sourceSupport: {a0: [source.id], a1: [source.id]}, scopeGaps: {r1: []}};
    } else {
      repaired = Boolean(payload.contentRepair);
      if (repaired) {
        assert.deepEqual(payload.contentRepair.unresolved, [{requirementId: "r1", finding: "incomplete", guidanceMissing: false}]);
        assert.deepEqual(payload.contentRepair.findingGaps, [{requirementId: "r1", sourceId: "s1", sourceSpanId: "s1-1", quotation: seller}]);
        assert.deepEqual(payload.contentRepair.materialGaps, []);
      }
      data = {responseKind: "answer", summary: buyer, summarySourceIds: ["s1"],
        confirmedFindings: [{title: repaired ? "Seller duty" : "Buyer duty", explanation: repaired ? seller : buyer,
          sourceIds: ["s1"], answerRole: "governing_rule"}], coverage: {r1: [0]},
        actionPlan: repaired ? [] : [buyer, seller].map((description, index) => ({title: index ? "Notify the registry" : "Submit the application",
          description, sourceIds: ["s1"]})), guidanceCoverage: {r1: repaired ? [] : [0, 1]},
        risks: [], deadlines: [], conditionalBranches: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
    }
    return Response.json({id: "finding-repair", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
  });
  const checked = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer(requestInput, {fallbackEnabled: false});
  assert.equal(repaired, true);
  assert.equal(checked.run.data.responseKind, "answer");
  assert.deepEqual(checked.run.data.confirmedFindings.map(item => item.explanation), [buyer, seller]);
  assert.deepEqual(checked.run.data.actionPlan.map(item => item.description), [buyer, seller]);
});

for (const priorGuidanceComplete of [true, false]) for (const supportedReplacement of [true, false]) test(`repair guidance timeout retains ${supportedReplacement ? "supported" : "no rejected"} repaired findings and ${priorGuidanceComplete ? "complete" : "partial"} previous guidance`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const requestInput: LegalChatRequest = {...input, coverageRequirements: [{id: "registry", statement: input.question,
    priority: "core", scopeKind: "general", sourceIds: [source.id]}]};
  let repaired = false;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const routingResponse = evidenceRoutingResponse(request);
    if (routingResponse) return routingResponse;
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_finding_support") {
      data = {f1: [source.id], ...(repaired ? {f2: supportedReplacement ? [source.id] : []} : {}), mainPoint: {supported: false, findingIndexes: [], scopeCoverage: {r1: false}},
        scopeCoverage: {r1: repaired && supportedReplacement ? [0, 1] : []}, scopeGoverning: {r1: repaired && supportedReplacement ? [0, 1] : []}, scopeGaps: {r1: repaired ? [] : [
          {sourceId: source.id, quotation: seller, reason: "Seller duty is absent from findings"}]}};
    } else if (request.text.format.name === "juro_legal_guidance_coverage") {
      if (repaired) throw new ProviderRequestAbortError("first_byte_timeout");
      data = {supportedActions: priorGuidanceComplete ? [0, 1] : [0], r1: priorGuidanceComplete ? [0, 1] : [],
        sourceSupport: priorGuidanceComplete ? {a0: [source.id], a1: [source.id]} : {a0: [source.id]},
        scopeGaps: {r1: priorGuidanceComplete ? [] : [{sourceId: source.id, quotation: seller, reason: "Seller action omitted"}]}};
    } else {
      repaired = Boolean(payload.contentRepair);
      if (repaired) {
        assert.deepEqual(payload.contentRepair.unresolved, [{requirementId: "r1", finding: "incomplete", guidanceMissing: !priorGuidanceComplete}]);
        assert.deepEqual(payload.contentRepair.findingGaps, [{requirementId: "r1", sourceId: "s1", sourceSpanId: "s1-1", quotation: seller}]);
        assert.equal(payload.contentRepair.retainedActions.length, priorGuidanceComplete ? 2 : 1);
      }
      data = {responseKind: "answer", summary: buyer, summarySourceIds: ["s1"],
        confirmedFindings: [{title: repaired ? "Seller duty" : "Buyer duty", explanation: repaired ? seller : buyer,
          sourceIds: ["s1"], answerRole: "governing_rule"}], coverage: {r1: [0]},
        actionPlan: repaired ? [{title: "Unassessed instruction", description: "Wait 365 days before filing.", sourceIds: ["s1"]}] : (priorGuidanceComplete ? [buyer, seller] : [buyer]).map((description, index) => ({title: index ? "Notify the registry" : "Submit the application",
          description: `**${description}**`, sourceIds: ["s1"]})), guidanceCoverage: {r1: repaired || !priorGuidanceComplete ? [0] : [0, 1]},
        risks: [], deadlines: [], conditionalBranches: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
    }
    return Response.json({id: "finding-repair", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
  });
  const checked = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer(requestInput, {fallbackEnabled: false});
  assert.equal(repaired, true);
  assert.equal(checked.run.data.responseKind, priorGuidanceComplete && supportedReplacement ? "answer" : "clarification_required");
  assert.deepEqual(checked.run.data.confirmedFindings.map(item => item.explanation), supportedReplacement ? [buyer, seller] : [buyer]);
  assert.deepEqual(checked.run.data.actionPlan.map(item => item.description), priorGuidanceComplete ? [buyer, seller] : [buyer]);
});

for (const reasoningMode of ["deep", "fast"] as const) for (const cancelled of [false, true]) test(`${reasoningMode} initial guidance timeout ${cancelled ? "propagates cancellation without recovery" : "preserves candidate findings through validation and withholds unassessed actions"}`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  let repairRequested = false;
  const controller = new AbortController();
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const routingResponse = evidenceRoutingResponse(request);
    if (routingResponse) return routingResponse;
    const findingResponse = findingAssessmentResponse(request);
    if (findingResponse) return findingResponse;
    const payload = JSON.parse(request.input);
    if (request.text.format.name === "juro_legal_guidance_coverage") throw new ProviderRequestAbortError("first_byte_timeout");
    if (payload.contentRepair) {
      repairRequested = true;
      assert.equal(payload.contentRepair.retainedFindings.length, 2);
      assert.deepEqual(payload.contentRepair.retainedActions, []);
      throw new TypeError("Repair temporarily unavailable");
    }
    const data = {responseKind: "answer", summary: "Both parties have registry duties.", summarySourceIds: ["s1"],
      confirmedFindings: [...[buyer, seller].map((explanation, index) => ({title: index ? "Seller duty" : "Buyer duty",
        explanation, sourceIds: ["s1"], answerRole: "governing_rule"})),
        {title: "Unverified fine", explanation: "The buyer must pay a fine of 1000.", sourceIds: ["missing"], answerRole: "consequence"}],
      coverage: {r1: [0], r2: [1]}, guidanceCoverage: {r1: [0], r2: []},
      actionPlan: [{title: "Wait before filing", description: "Wait 365 days before submitting the application.", sourceIds: ["s1"]}],
      risks: [], deadlines: [], conditionalBranches: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
    return Response.json({id: "writer-before-timeout", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
  });
  const pending = createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer({...input, reasoningMode}, {
    fallbackEnabled: false, signal: controller.signal, onProviderAttemptFinished: observation => {
      if (cancelled && observation.part === "guidance_validation") controller.abort();
    },
  });
  if (cancelled) {
    await assert.rejects(pending);
    assert.equal(repairRequested, false);
    return;
  }
  const checked = await pending;
  assert.deepEqual(checked.run.data.confirmedFindings.map(finding => finding.explanation), [buyer, seller]);
  assert.deepEqual(checked.run.data.actionPlan, []);
  assert.equal(checked.run.data.responseKind, "clarification_required");
  assert.equal(checked.contentRepair?.outcome, "unavailable");
  assert.equal(checked.run.sourceFallback, undefined);
  assert.equal(checked.run.usage.inputTokens, reasoningMode === "fast" ? 400 : 300);
  assert.deepEqual(checked.run.initialGuidanceAssessmentFailure, {code: "PROVIDER_TIMEOUT"});
  assert.equal(repairRequested, true);
});

test("bounded repair completes timed-out guidance while retaining the original failure history", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  let repairRequested = false;
  const outcomes: string[] = [];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const routingResponse = evidenceRoutingResponse(request);
    if (routingResponse) return routingResponse;
    const findingResponse = findingAssessmentResponse(request);
    if (findingResponse) return findingResponse;
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_guidance_coverage") {
      if (!repairRequested) throw new ProviderRequestAbortError("first_byte_timeout");
      data = {scopeGaps: {r1: [], r2: []}, r1: [0], r2: [1], supportedActions: [0, 1],
        sourceSupport: {a0: [source.id], a1: [source.id]}};
    } else {
      repairRequested = Boolean(payload.contentRepair);
      if (repairRequested) {
        assert.equal(payload.contentRepair.retainedFindings.length, 2);
        assert.deepEqual(payload.contentRepair.retainedActions, []);
        assert.deepEqual(payload.contentRepair.materialGaps, []);
      }
      data = {responseKind: "answer", summary: repairRequested ? "" : "Both parties have registry duties.", summarySourceIds: [],
        confirmedFindings: repairRequested ? [] : [buyer, seller].map((explanation, index) => ({
          title: index ? "Seller duty" : "Buyer duty", explanation, sourceIds: ["s1"], answerRole: "governing_rule"})),
        coverage: {r1: repairRequested ? [] : [0], r2: repairRequested ? [] : [1]},
        guidanceCoverage: {r1: [0], r2: [1]}, actionPlan: [buyer, seller].map((description, index) => ({
          title: index ? "Notify the registry" : "Submit the application", description, sourceIds: ["s1"]})),
        risks: [], deadlines: [], conditionalBranches: [], clarificationQuestions: [], urgency: "normal", suggestedDocument: null, suggestLawyer: false};
    }
    return Response.json({id: "repair-after-timeout", model: request.model,
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 100, output_tokens: 20}});
  });
  const checked = await createLegalAiGateway(legalAiProvider()!).generateGroundedAnswer(input, {fallbackEnabled: false,
    onProviderAttemptFinished: observation => {outcomes.push(observation.outcome);}});
  assert.equal(checked.run.data.responseKind, "answer");
  assert.equal(checked.contentRepair?.outcome, "repaired");
  assert.deepEqual(checked.run.data.confirmedFindings.map(finding => finding.explanation), [buyer, seller]);
  assert.deepEqual(checked.run.data.actionPlan.map(action => action.description), [buyer, seller]);
  assert.deepEqual(outcomes, ["completed", "completed", "failed", "completed", "completed", "completed", "completed"]);
  assert.equal(checked.run.usage.inputTokens, 600);
  assert.deepEqual(checked.run.initialGuidanceAssessmentFailure, {code: "PROVIDER_TIMEOUT"});
});

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
    const routingResponse = evidenceRoutingResponse(request);
    if (routingResponse) return routingResponse;
    const findingResponse = findingAssessmentResponse(request);
    if (findingResponse) return findingResponse;
    const payload = JSON.parse(request.input);
    let data: unknown;
    if (request.text.format.name === "juro_legal_guidance_coverage") {
      if (repairRequested) {
        assert.equal(payload.actions[1].description, `Notify the registry.\n\n${seller}`);
        assert.deepEqual(payload.actions[1].sourceIds, [source.id]);
      }
      data = {scopeGaps: {r1: [], r2: repairRequested
        ? []
        : [{quotation: seller, sourceId: source.id, reason: "Seller notification and its accompanying certificate are missing."}]},
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
    const routingResponse = evidenceRoutingResponse(request);
    if (routingResponse) return routingResponse;
    const findingResponse = findingAssessmentResponse(request);
    if (findingResponse) return findingResponse;
    const payload = JSON.parse(request.input);
    if (payload.contentRepair) throw new TypeError("Provider unavailable during repair");
    const data = request.text.format.name === "juro_legal_guidance_coverage"
      ? {supportedActions: [0], r1: [0], r2: [], sourceSupport: {a0: [source.id]},
        scopeGaps: {r1: [], r2: []}}
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
