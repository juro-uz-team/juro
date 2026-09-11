import assert from "node:assert/strict";
import test from "node:test";
import { env } from "cloudflare:workers";
import { legalAiProvider } from "../lib/ai/provider";
import { resolveAiRuntimeSettings } from "../lib/ai/runtime-settings";

for (const reasoningMode of ["fast", "deep"] as const) test(`${reasoningMode} writer requests use the selected model and retain independent scopes`, async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const requests: Array<{model: string; input: string; text: {format: {schema: {properties: Record<string, unknown>}}}}> = [];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    requests.push(request);
    const findings = "confirmedFindings" in request.text.format.schema.properties;
    const data = {responseKind: "answer", summary: "Supported content", clarificationQuestions: [],
      urgency: "normal", suggestedDocument: null, suggestLawyer: false,
      ...(findings ? {confirmedFindings: [], summarySourceIds: [], coverage: {r1: [], r2: []}} : {}),
      ...(!findings || reasoningMode === "deep" ? {actionPlan: [], risks: [], guidanceCoverage: {r1: [], r2: []}} : {}),
      ...(reasoningMode === "deep" ? {conditionalBranches: [], deadlines: []} : {})};
    return Response.json({model: request.model, id: "test-response",
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}],
      usage: {input_tokens: 100, output_tokens: 20}});
  });
  const questions = ["Now the purchaser will resell.", "What are the buyer reporting and seller reporting duties?"];
  const requirements = [4, 7].map((index, occurrence) => ({id: `reporting-${occurrence}`,
    statement: "reporting", priority: "core" as const, scopeKind: "general" as const,
    sourceIds: [], origin: {kind: "explicit_question" as const, questionIndex: 1,
      quotation: "reporting", tokenRange: {startToken: index, endToken: index}},
    questionContext: {questions, sourceQuestionIndex: 1}, unresolvedDimensions: ["forum" as const]}));
  await legalAiProvider()!.runLegalChat({question: questions[0]!, locale: "en", answerMode: "detailed",
    reasoningMode, sources: [], coverageRequirements: requirements, legalDatabaseAsOf: "2026-09-11",
    requestId: "guidance-context", safetyIdentifier: "test", runtimeSettings: {
      ...await resolveAiRuntimeSettings({env}), openaiChatModel: "gpt-5.6-sol", openaiDeepModel: "gpt-5.6-sol",
    }});
  assert.equal(requests.length, reasoningMode === "fast" ? 2 : 1);
  for (const request of requests) {
    assert.equal(request.model, reasoningMode === "fast" ? "gpt-5.6-luna" : "gpt-5.6-terra");
    const input = typeof request.input === "string" ? JSON.parse(request.input) : request.input;
    assert.equal(input.coverageRequirements.length, 2);
    assert.deepEqual(input.coverageRequirements.map((item: {questionContext: unknown}) => item.questionContext),
      requirements.map(item => item.questionContext));
    assert.deepEqual(input.coverageRequirements.map((item: {questionSelection: {selected: string}}) => item.questionSelection.selected),
      ["reporting", "reporting"]);
    assert.notEqual(input.coverageRequirements[0].questionSelection.before, input.coverageRequirements[1].questionSelection.before);
  }
});
