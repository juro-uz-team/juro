import assert from "node:assert/strict";
import test from "node:test";
import { legalChatRequestSchema } from "../lib/legal-chat/request-schema";
import { guestLegalChatRequestSchema } from "../lib/legal-chat/guest-delivery";

const request = { locale: "en", idempotencyKey: "text-request-boundary" };

test("signed-in text accepts its input boundary and rejects oversized questions", () => {
  assert.equal(legalChatRequestSchema.parse({ ...request, question: "a".repeat(8_000) }).question.length, 8_000);
  assert.equal(legalChatRequestSchema.safeParse({ ...request, question: "a".repeat(8_001) }).success, false);
});

test("guest text accepts its input boundary and rejects oversized questions", () => {
  assert.equal(guestLegalChatRequestSchema.parse({ ...request, question: "a".repeat(4_000) }).question.length, 4_000);
  assert.equal(guestLegalChatRequestSchema.safeParse({ ...request, question: "a".repeat(4_001) }).success, false);
});

test("both text entry points trim input and reject blank new questions", () => {
  for (const schema of [legalChatRequestSchema, guestLegalChatRequestSchema]) {
    assert.equal(schema.parse({ ...request, question: "  My question\n" }).question, "My question");
    assert.equal(schema.safeParse({ ...request, question: " \n\t" }).success, false);
  }
});

test("only signed-in regeneration permits omission of the question", () => {
  assert.equal(legalChatRequestSchema.parse({ ...request, operation: "regenerate" }).question, "");
  assert.equal(legalChatRequestSchema.safeParse(request).success, false);
  assert.equal(guestLegalChatRequestSchema.safeParse({ ...request, operation: "regenerate" }).success, false);
});
