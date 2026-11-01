import assert from "node:assert/strict";
import test from "node:test";
import { prepareSignedAnswerRequest } from "../lib/legal-answer-workflow/request-adapter";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";

test("retained UI edit and regenerate requests select owned immutable turns", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const root = await persistSignedInAnswer(fixture.input);
    const actor = { db: fixture.d1, workspaceId: "w", userId: "u", signal: new AbortController().signal };
    const minimal = await prepareSignedAnswerRequest({ ...actor,
      payload: { question: "Artificial question", locale: "en", idempotencyKey: "minimal-request" } });
    assert.equal(minimal.format, "detailed");
    assert.equal(minimal.mode, "fast");
    const payload = { locale: "en", answerMode: "detailed", reasoningMode: "deep", idempotencyKey: "ui-request",
      conversationId: root.conversationId, legalContextDate: "2020-07-01" };
    const edited = await prepareSignedAnswerRequest({ ...actor, payload: { ...payload,
      operation: "edit", sourceMessageId: root.requestMessageId, question: "Changed artificial question" } });
    assert.deepEqual(edited.branch, { operation: "edit", responseMessageId: root.responseMessageId });
    assert.equal(edited.question, "Changed artificial question");
    assert.equal(edited.legalContextDate, "2020-07-01");
    const regenerated = await prepareSignedAnswerRequest({ ...actor, payload: { ...payload,
      operation: "regenerate", sourceMessageId: root.responseMessageId } });
    assert.equal(regenerated.question, fixture.input.question);
    await assert.rejects(() => prepareSignedAnswerRequest({ ...actor, payload: { ...payload,
      operation: "regenerate", sourceMessageId: root.responseMessageId, question: "Replacement question" } }), /REGENERATION_QUESTION_CHANGED/);
    await assert.rejects(() => prepareSignedAnswerRequest({ ...actor, userId: "another-user", payload: { ...payload,
      operation: "regenerate", sourceMessageId: root.responseMessageId } }), /BRANCH_SELECTION_INVALID/);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
    await assert.rejects(() => prepareSignedAnswerRequest({ ...actor, payload: { ...payload,
      operation: "edit", sourceMessageId: root.requestMessageId, question: "Changed" } }), /BRANCH_SELECTION_INVALID/);
  } finally { fixture.sqlite.close(); }
});

test("new UI request cannot smuggle actor identity or attach a branch", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const actor = { db: fixture.d1, workspaceId: "w", userId: "u", signal: new AbortController().signal };
    const payload = { question: "Artificial question", locale: "uz", answerMode: "short", reasoningMode: "fast",
      idempotencyKey: "new", operation: "new" };
    const request = await prepareSignedAnswerRequest({ ...actor, payload });
    assert.equal(request.language, "uz");
    assert.equal(request.conversationId, null);
    assert.deepEqual(request.documentIds, []);
    await assert.rejects(() => prepareSignedAnswerRequest({ ...actor, payload: { ...payload, userId: "other" } }));
    await assert.rejects(() => prepareSignedAnswerRequest({ ...actor, payload: { ...payload, conversationId: "existing" } }), /BRANCH_SELECTION_INVALID/);
  } finally { fixture.sqlite.close(); }
});
