import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { deleteAiConversation } from "../lib/ai/branch-store";

test("revocation between deletion admission and its transaction preserves the entire conversation", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer(fixture.input);
    const db = new Proxy(fixture.d1, { get(target, property, receiver) {
      if (property === "batch") return async (statements: D1PreparedStatement[]) => {
        fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
        return target.batch(statements);
      };
      return Reflect.get(target, property, receiver);
    } });
    await assert.rejects(() => deleteAiConversation({ db, conversationId: saved.conversationId, workspaceId: "w", userId: "u" }));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversations").get()?.n, 1);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 2);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_branches").get()?.n, 1);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_versions").get()?.n, 1);
  } finally { fixture.sqlite.close(); }
});

test("a busy run appearing during deletion rolls back previously removed branch metadata", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer(fixture.input);
    fixture.sqlite.exec(`CREATE TRIGGER simulate_new_run AFTER DELETE ON message_branches
      BEGIN UPDATE ai_runs SET status='reserved' WHERE conversation_id=OLD.conversation_id; END`);
    await assert.rejects(() => deleteAiConversation({ db: fixture.d1, conversationId: saved.conversationId,
      workspaceId: "w", userId: "u" }));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 2);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_branches").get()?.n, 1);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_versions").get()?.n, 1);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM ai_runs WHERE id=?").get(fixture.input.runId)?.status, "completed");
  } finally { fixture.sqlite.close(); }
});
