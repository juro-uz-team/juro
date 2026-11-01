import assert from "node:assert/strict";
import test from "node:test";
import { deleteAiConversation } from "../lib/ai/branch-store";
import { reserveAiRun } from "../lib/ai/run-store";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";

test("conversation deletion enforces tenant ownership and membership, waits for active runs, and removes saved turns", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer(fixture.input);
    const access = { db: fixture.d1, conversationId: saved.conversationId, workspaceId: "w", userId: "u" };
    assert.equal(await deleteAiConversation({ ...access, workspaceId: "foreign" }), "unavailable");
    assert.equal(await deleteAiConversation({ ...access, userId: "foreign" }), "unavailable");
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
    await assert.rejects(() => deleteAiConversation(access));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 2);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='active' WHERE id='member'").run();
    const pending = await reserveAiRun({ ...fixture.input, conversationId: saved.conversationId,
      idempotencyKey: "pending-follow-up", requestHash: "pending-follow-up" });
    assert.equal(pending.kind, "reserved");
    assert.equal(await deleteAiConversation(access), "busy");
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 2);
    fixture.sqlite.prepare("UPDATE ai_runs SET status='failed' WHERE id=?").run(pending.runId);
    assert.equal(await deleteAiConversation(access), "deleted");
    for (const table of ["conversations", "conversation_messages", "message_branches", "message_versions"]) {
      assert.equal(fixture.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
    }
  } finally { fixture.sqlite.close(); }
});
