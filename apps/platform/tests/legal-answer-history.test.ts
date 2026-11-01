import assert from "node:assert/strict";
import test from "node:test";
import { reserveAiRun } from "../lib/ai/run-store";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { planAnswerBranch } from "../lib/legal-answer-workflow/branches";
import { readSavedAnswerConversation } from "../lib/legal-answer-workflow/saved-conversation";
import { loadAnswerHistory } from "../lib/legal-answer-workflow/history";

test("history follows the selected ancestry and excludes replaced answers during editing", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const root = await persistSignedInAnswer(fixture.input);
    const request = { ...fixture.input, conversationId: root.conversationId,
      idempotencyKey: "follow", requestHash: "follow" };
    const reservation = await reserveAiRun(request);
    if (reservation.kind !== "reserved") throw new Error("Expected reservation");
    const follow = await persistSignedInAnswer({ ...request, ...reservation, question: "Later question",
      branch: { operation: "follow_up", responseMessageId: root.responseMessageId } });
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", conversationId: root.conversationId,
      question: "Changed question", signal: new AbortController().signal };
    const edit = await planAnswerBranch({ ...input, branch: { operation: "edit", responseMessageId: follow.responseMessageId } });
    const history = await loadAnswerHistory({ ...input, parentBranchId: edit.parentBranchId });
    assert.deepEqual(history, [
      { role: "user", content: fixture.input.question },
      { role: "assistant", content: JSON.stringify(fixture.input.response) },
    ]);
    const afterFollow = await loadAnswerHistory({ ...input, parentBranchId: follow.branchId });
    assert.equal(afterFollow.length, 4);
    assert.equal(afterFollow[2].content, "Later question");
    await assert.rejects(() => loadAnswerHistory({ ...input, userId: "other", parentBranchId: follow.branchId }), /HISTORY_ACCESS_DENIED/);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
    await assert.rejects(() => loadAnswerHistory({ ...input, parentBranchId: follow.branchId }), /HISTORY_ACCESS_DENIED/);
  } finally { fixture.sqlite.close(); }
});

test("long selected conversations retain every turn and reopen without a short history ceiling", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const questions = Array.from({ length: 34 }, (_, index) => `Turn ${index}: ${"Complete supplied facts. ".repeat(130)}`);
    let saved = await persistSignedInAnswer({ ...fixture.input, question: questions[0] });
    const rootBranch = saved.branchId;
    for (let index = 1; index < questions.length; index++) {
      const request = { ...fixture.input, conversationId: saved.conversationId, idempotencyKey: `long-${index}`, requestHash: `long-${index}` };
      const reservation = await reserveAiRun(request);
      if (reservation.kind !== "reserved") throw new Error("Expected reservation");
      saved = await persistSignedInAnswer({ ...request, ...reservation, question: questions[index],
        branch: { operation: "follow_up", responseMessageId: saved.responseMessageId } });
    }
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", conversationId: saved.conversationId, signal: new AbortController().signal };
    const history = await loadAnswerHistory({ ...input, parentBranchId: saved.branchId });
    assert.deepEqual(history.filter(turn => turn.role === "user").map(turn => turn.content), questions);
    assert.ok(history.reduce((size, turn) => size + turn.content.length, 0) > 96000);
    const reopened = await readSavedAnswerConversation({ ...input, branchId: saved.branchId });
    assert.ok(JSON.stringify(reopened).includes(questions[0]));
    assert.ok(JSON.stringify(reopened).includes(questions.at(-1)!));
    assert.throws(() => fixture.sqlite.prepare("UPDATE message_branches SET parent_branch_id=? WHERE id=?").run(saved.branchId, rootBranch), /MESSAGE_BRANCH_IMMUTABLE/);
  } finally { fixture.sqlite.close(); }
});
