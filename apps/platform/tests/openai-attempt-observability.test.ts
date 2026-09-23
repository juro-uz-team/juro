import assert from "node:assert/strict";
import test from "node:test";
import { env } from "./helpers/runtime-env";
import { callOpenAiStructured, type AiProviderAttemptObservation } from "../lib/document-builder/ai/openai";
import {createQuestionInterpreter} from "../lib/legal-chat/question-model";

test("an exhausted shared deadline cannot announce or account for a new provider attempt", async context => {
  const previousKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  let requests=0,starts=0,finishes=0;
  const progress:string[]=[];
  context.mock.method(globalThis,"fetch",async()=>{requests++;throw Error("No request is permitted after the deadline");});
  await assert.rejects(callOpenAiStructured({model:"gpt-5.6-luna",schemaName:"expired_request",
    schema:{type:"object",properties:{},additionalProperties:false},instructions:"Validate.",input:{},parse:value=>value,
    maxAttempts:1,deadlineAt:Date.now()-1,
    onAttempt:()=>{starts++;},onAttemptFinished:()=>{finishes++;},onProgress:event=>{progress.push(event.stage);},
  }),{code:"PROVIDER_TIMEOUT"});
  assert.equal(requests,0);
  assert.equal(starts,0);
  assert.equal(finishes,0);
  assert.deepEqual(progress,[]);
});

test("question interpretation retains cached usage and observes invalid provider output", async (context) => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previousKey;});
  let valid = true;
  context.mock.method(globalThis, "fetch", async () => Response.json({model: "gpt-5.6-terra", id: "question-response",
    output: [{content: [{type: "output_text", text: JSON.stringify({
      topics: valid ? ["Applicable rules"] : [], facts: [], selectedMemoryIds: [],
      temporal: {kind: "current"}, questions: [],
    })}]}], usage: {input_tokens: 100, output_tokens: 20, input_tokens_details: {cached_tokens: 50}}}));
  const attempts: AiProviderAttemptObservation[] = [];
  const interpret = createQuestionInterpreter({mode: "deep", requestId: "question-cost", safetyIdentifier: "test",
    onAttemptFinished: event => {attempts.push(event);}});
  const input = {question: "Which rules apply?", locale: "en" as const, priorTurns: []};
  await interpret(input);
  valid = false;
  await assert.rejects(interpret(input), {code: "INVALID_AI_OUTPUT"});
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
