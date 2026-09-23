import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {callAnthropicStructured} from "../lib/document-builder/ai/anthropic";
import type {AiProviderAttemptObservation} from "../lib/document-builder/ai/openai";

test("Anthropic retains rejected output usage separately from its successful retry", async context => {
  const previous = env.ANTHROPIC_API_KEY;
  env.ANTHROPIC_API_KEY = "test-only-key";
  context.after(() => {env.ANTHROPIC_API_KEY = previous;});
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => Response.json({model: "test-model", id: `response-${++calls}`,
    content: [{type: "text", text: JSON.stringify({valid: calls === 2})}],
    usage: {input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50}}));
  const attempts: AiProviderAttemptObservation[] = [];
  const result = await callAnthropicStructured({model: "test-model", instructions: "Validate the supplied value.",
    input: {privateText: "must not enter observations"}, schema: {type: "object", properties: {valid: {type: "boolean"}},
      required: ["valid"], additionalProperties: false},
    parse: value => {if (!(value as {valid: boolean}).valid) throw new Error("invalid"); return value;},
    onAttemptFinished: attempt => {attempts.push(attempt);},
  });
  assert.deepEqual(attempts.map(({outcome, errorCode, usage}) => ({outcome, errorCode, usage})), [
    {outcome: "failed", errorCode: "INVALID_AI_OUTPUT", usage: {inputTokens: 150, outputTokens: 20, cachedInputTokens: 50}},
    {outcome: "completed", errorCode: null, usage: {inputTokens: 150, outputTokens: 20, cachedInputTokens: 50}},
  ]);
  assert.equal(result.usage.inputTokens, 300, "total input includes separately reported cache-read tokens");
  assert.equal(JSON.stringify(attempts).includes("privateText"), false);
});

test("Anthropic network failure retains unknown usage and telemetry cannot trigger another call", async context => {
  const previous = env.ANTHROPIC_API_KEY;
  env.ANTHROPIC_API_KEY = "test-only-key";
  context.after(() => {env.ANTHROPIC_API_KEY = previous;});
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {calls++; throw new Error("network unavailable");});
  const attempts: AiProviderAttemptObservation[] = [];
  await assert.rejects(callAnthropicStructured({model: "test-model", instructions: "Return a value.", input: {},
    schema: {type: "object", properties: {}, additionalProperties: false}, parse: value => value, maxAttempts: 1,
    onAttemptFinished: attempt => {attempts.push(attempt); throw new Error("telemetry unavailable");},
  }), {code: "PROVIDER_UNAVAILABLE"});
  assert.equal(calls, 1);
  assert.equal(attempts[0]?.usage, null);
  assert.equal(attempts[0]?.outcome, "failed");
  assert.equal(attempts[0]?.errorCode, "PROVIDER_UNAVAILABLE");
});
