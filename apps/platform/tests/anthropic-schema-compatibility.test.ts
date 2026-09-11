import assert from "node:assert/strict";
import test from "node:test";
import { anthropicCompatibleJsonSchema } from "../lib/ai/anthropic-schema";
import { normalizeAnthropicLegalChatResponse, runAnthropicLegalChat } from "../lib/ai/anthropic-provider";
import {env} from "cloudflare:workers";
import type { LegalChatRequest } from "../lib/ai/provider";

test("Anthropic receives resolved comparison endpoints instead of reconstructing relative dates", async context => {
  const previous = env.ANTHROPIC_API_KEY;
  env.ANTHROPIC_API_KEY = "test-only-key";
  context.after(() => {env.ANTHROPIC_API_KEY = previous;});
  const comparison: NonNullable<LegalChatRequest["temporalComparison"]> = {
    left: {kind: "timestamp", instant: "2024-09-12T00:00:00Z"}, right: {kind: "current"},
  };
  let payload: Record<string, unknown> | undefined;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    payload = JSON.parse(body.messages[0].content);
    return Response.json({id: "comparison", model: "test-model", content: [{type: "tool_use", name: "emit_result", input: {payload_json: JSON.stringify({
      responseKind: "clarification_required", summary: "Нужны официальные редакции.", confirmedFindings: [],
      summarySourceIds: [], clarificationQuestions: [], actionPlan: [], risks: [], deadlines: [],
      urgency: "normal", suggestedDocument: null, suggestLawyer: false,
    })}}], usage: {input_tokens: 10, output_tokens: 10}});
  });
  await runAnthropicLegalChat({question: "Что изменилось за два года?", locale: "ru", answerMode: "detailed",
    reasoningMode: "deep", sources: [], temporalComparison: comparison, legalDatabaseAsOf: "2026-09-12",
    requestId: "comparison", safetyIdentifier: "comparison"});
  assert.deepEqual(payload?.temporalComparison, comparison);
});

test("Anthropic schema adapter removes only provider-incompatible annotations", () => {
  const source = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    required: ["status", "url"],
    properties: {
      status: { type: "string", enum: ["ok", "failed"], minLength: 1, maxLength: 12 },
      url: { type: "string", format: "uri", maxLength: 2_000 },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: { type: "string", pattern: "^[A-Z]+$" },
      },
    },
  };

  const result = anthropicCompatibleJsonSchema(source) as typeof source;

  assert.deepEqual(source.properties.status, { type: "string", enum: ["ok", "failed"], minLength: 1, maxLength: 12 });
  assert.equal(result.$schema, undefined);
  assert.equal(result.additionalProperties, false);
  assert.deepEqual(result.required, ["status", "url"]);
  assert.deepEqual(result.properties.status, { type: "string", enum: ["ok", "failed"] });
  assert.deepEqual(result.properties.url, { type: "string" });
  assert.deepEqual(result.properties.items, { type: "array", items: { type: "string" } });
});

test("Anthropic legal-chat normalization preserves citation-bound conditional branches", () => {
  const input: LegalChatRequest = {
    question: "Что изменится, если работник уже вышел из отпуска?",
    locale: "ru",
    answerMode: "short",
    reasoningMode: "fast",
    sources: [],
    legalDatabaseAsOf: "2026-08-29",
    requestId: "anthropic-conditional-branch",
    safetyIdentifier: "anthropic-conditional-branch",
  };
  const conditionalBranches = [{
    condition: "Если работник уже вышел из отпуска",
    outcome: "Применяется отдельная гарантия.",
    sourceIds: ["source-409"],
  }];
  const normalized = normalizeAnthropicLegalChatResponse({
    responseKind: "answer",
    summary: "Ответ зависит от статуса отпуска.",
    answer: "Проверьте дату выхода.",
    clarificationQuestions: [],
    confirmedFindings: [],
    conditionalBranches,
    assumptions: [],
    risks: [],
    sources: [],
    requiredDocuments: [],
    actionPlan: [],
    deadlines: [],
    successOutlook: null,
    urgency: "normal",
    suggestedDocument: null,
    suggestLawyer: false,
  }, input);

  assert.deepEqual(normalized.conditionalBranches, conditionalBranches);
});
