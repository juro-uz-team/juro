import assert from "node:assert/strict";
import test from "node:test";
import { env } from "cloudflare:workers";
import { callOpenAiStructured, type AiProviderAttemptObservation } from "../lib/document-builder/ai/openai";
import {understandLegalRetrievalQuery, type LegalRetrievalUnderstandingTelemetry} from "../lib/legal/legal-retrieval-understanding";

test("primary interpretation retains cached usage and observes rejected plans", async (context) => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previousKey;});
  let valid = true;
  context.mock.method(globalThis, "fetch", async () => Response.json({model: "gpt-5.6-terra", id: "planner-response",
    output: [{content: [{type: "output_text", text: JSON.stringify({answerLanguage: "en", standaloneQuestion: "Which rules apply?",
      relationship: "independent", questionAccounting: {q0:{disposition:"active",requirementIndexes:[0],
        currentQuestionQuotation:null,contextQuotation:null,explanation:null}},
      requirements: [{statement: "Applicable rules", scopeKind: "general", priority: "core",
        origin: {kind: "explicit_question", questionIndex: 0, quotation: valid ? "rules" : "invented quotation"}}],
      temporalEndpoint: null, comparison: null, missingFacts: []})}]}],
    usage: {input_tokens: 100, output_tokens: 20, input_tokens_details: {cached_tokens: 50}}}));
  const telemetry: LegalRetrievalUnderstandingTelemetry[] = [];
  const attempts: AiProviderAttemptObservation[] = [];
  const input = {query: "Which rules apply?", locale: "en" as const, requestId: "planner-cost", safetyIdentifier: "test",
    onTelemetry: (event: LegalRetrievalUnderstandingTelemetry) => {telemetry.push(event);},
    onAttemptFinished: (event: AiProviderAttemptObservation) => {attempts.push(event);}};
  await understandLegalRetrievalQuery(input);
  assert.equal(telemetry[0]?.cachedInputTokens, 50);
  valid = false;
  await assert.rejects(understandLegalRetrievalQuery(input), {code: "INVALID_AI_OUTPUT"});
  assert.equal(telemetry.length, 1);
  assert.deepEqual(attempts.map(({outcome, usage}) => ({outcome, usage})), [
    {outcome: "completed", usage: {inputTokens: 100, outputTokens: 20, cachedInputTokens: 50}},
    {outcome: "failed", usage: {inputTokens: 100, outputTokens: 20, cachedInputTokens: 50}},
  ]);
});

test("rejected structured output retains its usage separately from a successful retry", async (context) => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return Response.json({model: "test-model", id: `response-${calls}`,
      output: [{content: [{type: "output_text", text: JSON.stringify({valid: calls === 2})}]}],
      usage: {input_tokens: 100, output_tokens: 20, input_tokens_details: {cached_tokens: 50}}});
  });
  const observations: AiProviderAttemptObservation[] = [];
  const result = await callOpenAiStructured({model: "test-model", schemaName: "attempt_observation",
    schema: {type: "object", properties: {valid: {type: "boolean"}}, required: ["valid"], additionalProperties: false},
    instructions: "Validate the supplied value.", input: {privateText: "must not enter observations"},
    parse: value => { if (!(value as {valid: boolean}).valid) throw new Error("invalid"); return value; },
    onAttemptFinished: observation => { observations.push(observation); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(observations.map(({outcome, errorCode, usage}) => ({outcome, errorCode, usage})), [
    {outcome: "failed", errorCode: "INVALID_AI_OUTPUT", usage: {inputTokens: 100, outputTokens: 20, cachedInputTokens: 50}},
    {outcome: "completed", errorCode: null, usage: {inputTokens: 100, outputTokens: 20, cachedInputTokens: 50}},
  ]);
  assert.deepEqual(result.usage, {inputTokens: 200, outputTokens: 40, cachedInputTokens: 100});
  assert.doesNotMatch(JSON.stringify(observations), /privateText|test-only-key|must not enter/u);
});

test("unavailable provider usage stays unknown and observer failure cannot change the outcome", async (context) => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  context.mock.method(globalThis, "fetch", async () => Response.json({error: {code: "rate_limit"}}, {status: 429}));
  const observations: AiProviderAttemptObservation[] = [];
  await assert.rejects(callOpenAiStructured({model: "test-model", schemaName: "attempt_observation",
    schema: {type: "object", properties: {}, additionalProperties: false}, instructions: "Validate.", input: {},
    parse: value => value, maxAttempts: 1, onAttemptFinished: observation => {
      observations.push(observation); throw new Error("observer unavailable");
    },
  }), {code: "PROVIDER_UNAVAILABLE"});
  assert.equal(observations.length, 1);
  assert.equal(observations[0]!.usage, null);
  assert.equal(observations[0]!.outcome, "failed");
  assert.equal(observations[0]!.httpStatus, 429);
});

for (const invalidText of ["", "not JSON"]) {
  test(`missing or malformed structured text is observed as invalid output (${JSON.stringify(invalidText)})`, async (context) => {
    const previousKey = env.OPENAI_API_KEY;
    env.OPENAI_API_KEY = "test-only-key";
    context.after(() => { env.OPENAI_API_KEY = previousKey; });
    let calls = 0;
    context.mock.method(globalThis, "fetch", async () => Response.json({
      output: [{content: [{type: "output_text", text: ++calls === 1 ? invalidText : "{}"}]}],
    }));
    const observations: AiProviderAttemptObservation[] = [];
    await callOpenAiStructured({model: "test-model", schemaName: "attempt_observation",
      schema: {type: "object", properties: {}, additionalProperties: false}, instructions: "Validate.", input: {},
      parse: value => value, onAttemptFinished: observation => { observations.push(observation); },
    });
    assert.deepEqual(observations.map(({outcome, errorCode}) => ({outcome, errorCode})), [
      {outcome: "failed", errorCode: "INVALID_AI_OUTPUT"}, {outcome: "completed", errorCode: null},
    ]);
  });
}
