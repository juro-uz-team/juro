import assert from "node:assert/strict";
import test from "node:test";
import { conversationOperation, contextTurns } from "../lib/legal-chat/conversation-context";
import type { AiConversationTurn } from "../lib/ai/conversation-branch-reader";

test("conversation operations preserve new and existing request semantics", () => {
  assert.equal(conversationOperation(undefined, false), "new");
  assert.equal(conversationOperation(undefined, true), "follow_up");
  assert.throws(() => conversationOperation("new", true));
  assert.throws(() => conversationOperation("edit", false));
  assert.throws(() => conversationOperation("unknown", true));
});

test("replacement context excludes superseded user facts and assistant claims", () => {
  const turn = (id: string, question: string): AiConversationTurn => ({
    branchId: id, parentBranchId: null, requestMessageId: `request-${id}`, responseMessageId: `response-${id}`,
    question, answer: `Unverified answer ${id}`, structuredJson: null, createdAt: "2026-09-14",
  });
  const turns = [turn("original", "I am 17."), turn("edited", "I am 27."), turn("followup", "My employer dismissed me.")];
  const operations = new Map([["original", "new"], ["edited", "edit"], ["followup", "follow_up"]] as const);
  assert.deepEqual(contextTurns(turns, operations).map(value => value.question), ["I am 27.", "My employer dismissed me."]);
  assert.deepEqual(contextTurns(turns.slice(0,2), operations, "edit").map(value => value.question), []);
});
