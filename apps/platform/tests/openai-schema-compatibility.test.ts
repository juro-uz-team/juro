import assert from "node:assert/strict";
import test from "node:test";
import { openAiCompatibleJsonSchema } from "../lib/ai/openai-schema";

test("provider descriptions retain application bounds that structural compatibility removes", () => {
  const original={type:"object",properties:{
    mainPoint:{type:"string",description:"The qualified conclusion.",minLength:1,maxLength:1500},
    actions:{type:"array",minItems:0,maxItems:16,items:{type:"integer",minimum:0,maximum:15}},
  }};
  const result=openAiCompatibleJsonSchema(original);
  const properties=result.properties as Record<string,Record<string,unknown>>;
  assert.equal(properties.mainPoint!.maxLength,undefined);
  assert.match(String(properties.mainPoint!.description),/The qualified conclusion/);
  assert.match(String(properties.mainPoint!.description),/maxLength=1500/);
  assert.match(String(properties.actions!.description),/maxItems=16/);
  assert.match(String((properties.actions!.items as Record<string,unknown>).description),/maximum=15/);
  assert.equal(original.properties.mainPoint.maxLength,1500);
  assert.deepEqual(openAiCompatibleJsonSchema(result),result);
  const wrapped=openAiCompatibleJsonSchema({type:"string",description:"Conclusion.",allOf:[{maxLength:1500}]});
  assert.equal(wrapped.allOf,undefined);
  assert.match(String(wrapped.description),/Conclusion/);
  assert.match(String(wrapped.description),/maxLength=1500/);
});

test("OpenAI schema adapter keeps structure while removing incompatible annotations", () => {
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
      optionalChoice: {
        oneOf: [{ type: "string" }, { type: "null" }],
      },
      timestamp: {
        type: "string",
        allOf: [{ pattern: "Z$" }],
      },
    },
  };

  const result = openAiCompatibleJsonSchema(source) as typeof source;

  assert.deepEqual(source.properties.status, { type: "string", enum: ["ok", "failed"], minLength: 1, maxLength: 12 });
  assert.equal(result.$schema, undefined);
  assert.equal(result.additionalProperties, false);
  assert.deepEqual(result.required, ["status", "url"]);
  assert.deepEqual(result.properties.status, { type: "string", enum: ["ok", "failed"],
    description: "Application validation bounds: minLength=1, maxLength=12." });
  assert.deepEqual(result.properties.url, { type: "string", description: "Application validation bounds: maxLength=2000." });
  assert.deepEqual(result.properties.items, { type: "array", items: { type: "string" },
    description: "Application validation bounds: minItems=1, maxItems=4." });
  assert.deepEqual(result.properties.optionalChoice, {
    anyOf: [{ type: "string" }, { type: "null" }],
  });
  assert.deepEqual(result.properties.timestamp, { type: "string" });
});
