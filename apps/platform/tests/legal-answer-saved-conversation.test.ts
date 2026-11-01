import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { reserveAiRun } from "../lib/ai/run-store";
import { readSavedAnswerConversation } from "../lib/legal-answer-workflow/saved-conversation";

test("saved answer selection preserves serialized content and excludes sibling turns", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const root = await persistSignedInAnswer(fixture.input);
    const follow = async (key: string, question: string) => {
      const input = { ...fixture.input, conversationId: root.conversationId, idempotencyKey: key, requestHash: key };
      const reserved = await reserveAiRun(input);
      if (reserved.kind !== "reserved") throw new Error("Expected reservation");
      return persistSignedInAnswer({ ...input, ...reserved, question,
        branch: { operation: "follow_up", responseMessageId: root.responseMessageId } });
    };
    const selected = await follow("saved-selected", "Chosen follow-up");
    await follow("saved-sibling", "Unselected sibling");
    const actor = { db: fixture.d1, workspaceId: "w", userId: "u", signal: new AbortController().signal,
      conversationId: root.conversationId, branchId: selected.branchId };
    const result = await readSavedAnswerConversation(actor);
    assert.equal(result.messageId, selected.responseMessageId);
    assert.deepEqual(result.result, fixture.input.response);
    assert.deepEqual(result.turns.map(turn => turn.question), [fixture.input.question, "Chosen follow-up"]);
    assert.equal(result.branches.length, 3);
    await assert.rejects(() => readSavedAnswerConversation({ ...actor, userId: "foreign" }), /SAVED_CONVERSATION_UNAVAILABLE/);
    await assert.rejects(() => readSavedAnswerConversation({ ...actor, branchId: "unknown" }), /SAVED_CONVERSATION_UNAVAILABLE/);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
    await assert.rejects(() => readSavedAnswerConversation(actor), /SAVED_CONVERSATION_UNAVAILABLE/);
  } finally { fixture.sqlite.close(); }
});

test("branchless saved answers retain their historical section layout without changing storage", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    fixture.sqlite.prepare(`INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at)
      VALUES('saved','w','u','Saved','en','active','2020-01-01','2020-01-01')`).run();
    const historical = { ...fixture.input.response, historicalPresentation: { findings: ["Artificial saved finding"] } };
    fixture.sqlite.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at)
      VALUES('q','saved','user','Historical question','2020-01-01T00:00:00.000Z')`).run();
    fixture.sqlite.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES('a','saved','assistant','Saved answer',?,'2020-01-01T00:00:00.000Z')`).run(JSON.stringify(historical));
    const result = await readSavedAnswerConversation({ db: fixture.d1, workspaceId: "w", userId: "u",
      conversationId: "saved", signal: new AbortController().signal });
    assert.deepEqual(result.result, historical);
    assert.equal(result.requestMessageId, "q");
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_branches").get()?.n, 0);
  } finally { fixture.sqlite.close(); }
});
