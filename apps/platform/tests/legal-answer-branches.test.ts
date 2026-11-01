import assert from "node:assert/strict";
import test from "node:test";
import { reserveAiRun } from "../lib/ai/run-store";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";

test("follow-ups preserve their selected parent and edits and regenerations preserve version ancestry", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const root = await persistSignedInAnswer(fixture.input);
    const publish = async (operation: "follow_up" | "edit" | "regenerate", target: string, question: string) => {
      const request = { ...fixture.input, conversationId: root.conversationId,
        idempotencyKey: operation, requestHash: operation };
      const reservation = await reserveAiRun(request);
      if (reservation.kind !== "reserved") throw new Error("Expected reservation");
      return persistSignedInAnswer({ ...request, ...reservation, question,
        branch: { operation, responseMessageId: target } });
    };
    const follow = await publish("follow_up", root.responseMessageId, "Follow-up question");
    const edited = await publish("edit", follow.responseMessageId, "Edited question");
    const regenerated = await publish("regenerate", edited.responseMessageId, "Edited question");
    const row = (id: string) => fixture.sqlite.prepare(`SELECT b.parent_branch_id AS parent,
      b.forked_from_message_id AS fork,v.source_message_id AS source,v.version_number AS version,
      b.operation AS operation FROM message_branches b JOIN message_versions v ON v.branch_id=b.id WHERE b.id=?`).get(id);
    assert.deepEqual({ ...row(follow.branchId) }, { parent: root.branchId,
      fork: root.responseMessageId, source: null, version: 1, operation: "follow_up" });
    assert.deepEqual({ ...row(edited.branchId) }, { parent: root.branchId,
      fork: follow.requestMessageId, source: follow.requestMessageId, version: 2, operation: "edit" });
    assert.deepEqual({ ...row(regenerated.branchId) }, { parent: root.branchId,
      fork: edited.requestMessageId, source: follow.requestMessageId, version: 3, operation: "regenerate" });
    assert.equal(fixture.sqlite.prepare("SELECT content FROM conversation_messages WHERE id=?")
      .get(follow.requestMessageId)?.content, "Follow-up question");
  } finally { fixture.sqlite.close(); }
});

test("foreign branch selection fails without consuming the reservation or publishing messages", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    await assert.rejects(() => persistSignedInAnswer({ ...fixture.input,
      branch: { operation: "edit", responseMessageId: "unowned-message" } }), /BRANCH_SELECTION_INVALID/);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM conversation_messages").get()?.count, 0);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM ai_runs WHERE id=?").get(fixture.input.runId)?.status, "reserved");
  } finally { fixture.sqlite.close(); }
});

test("revoked workspace membership fences publication atomically", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
    await assert.rejects(() => persistSignedInAnswer(fixture.input));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM conversations").get()?.count, 0);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM ai_runs WHERE id=?").get(fixture.input.runId)?.status, "reserved");
  } finally { fixture.sqlite.close(); }
});
