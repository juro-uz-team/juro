import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { prepareSignedAnswerRequest } from "../lib/legal-answer-workflow/request-adapter";
import { planAnswerBranch } from "../lib/legal-answer-workflow/branches";
import { loadAnswerHistory } from "../lib/legal-answer-workflow/history";
import { ensureSavedConversationBranches } from "../lib/legal-answer-workflow/legacy-history";

test("saved linear conversations acquire stable ancestry without changing saved messages", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    fixture.sqlite.prepare(`INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at)
      VALUES('legacy','w','u','Saved','en','active',?,?)`).run("2020-01-01", "2020-01-02");
    for (let i = 0; i < 2; i++) for (const role of ["user", "assistant"]) {
      fixture.sqlite.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at)
        VALUES(?,'legacy',?,?,?)`).run(`${role}${i}`, role, `${role} content ${i}`, `2020-01-0${i + 1}T00:00:00.000Z`);
    }
    const before = fixture.sqlite.prepare("SELECT * FROM conversation_messages ORDER BY id").all();
    const actor = { db: fixture.d1, workspaceId: "w", userId: "u", signal: new AbortController().signal };
    const payload = { locale: "en", answerMode: "detailed", reasoningMode: "fast", idempotencyKey: "legacy-follow",
      conversationId: "legacy", operation: "follow_up", sourceMessageId: "assistant1", question: "Next question" };
    await assert.rejects(() => prepareSignedAnswerRequest({ ...actor, userId: "foreign", payload }));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_branches").get()?.n, 0);
    const [prepared, parallel] = await Promise.all([
      prepareSignedAnswerRequest({ ...actor, payload }), prepareSignedAnswerRequest({ ...actor, payload }),
    ]);
    assert.deepEqual(prepared, parallel);
    const branch = await planAnswerBranch({ ...actor, ...prepared });
    assert.deepEqual(await loadAnswerHistory({ ...actor, conversationId: "legacy", parentBranchId: branch.parentBranchId }), [
      { role: "user", content: "user content 0" }, { role: "assistant", content: "assistant content 0" },
      { role: "user", content: "user content 1" }, { role: "assistant", content: "assistant content 1" },
    ]);
    const regenerated = await prepareSignedAnswerRequest({ ...actor, payload: { ...payload, operation: "regenerate", question: undefined } });
    assert.equal(regenerated.question, "user content 1");
    const edit = await prepareSignedAnswerRequest({ ...actor, payload: { ...payload, operation: "edit", sourceMessageId: "user1" } });
    const editBranch = await planAnswerBranch({ ...actor, ...edit });
    assert.equal((await loadAnswerHistory({ ...actor, conversationId: "legacy", parentBranchId: editBranch.parentBranchId })).length, 2);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_branches").get()?.n, 2);
    assert.deepEqual(fixture.sqlite.prepare("SELECT * FROM conversation_messages ORDER BY id").all(), before);
  } finally { fixture.sqlite.close(); }
});

test("ambiguous saved chronology is rejected without partial backfill", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    fixture.sqlite.prepare(`INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at)
      VALUES('ambiguous','w','u','Saved','en','active','2020-01-01','2020-01-01')`).run();
    for (const [id, role] of [["q1", "user"], ["a1", "assistant"], ["q2", "user"], ["a2", "assistant"]]) {
      fixture.sqlite.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at)
        VALUES(?,'ambiguous',?,'Artificial content','2020-01-01T00:00:00.000Z')`).run(id, role);
    }
    await assert.rejects(() => ensureSavedConversationBranches({ db: fixture.d1, workspaceId: "w", userId: "u",
      conversationId: "ambiguous", selectedMessageId: "a2" }), /SAVED_HISTORY_AMBIGUOUS/);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM message_branches").get()?.n, 0);
  } finally { fixture.sqlite.close(); }
});

test("long saved conversations acquire complete ancestry instead of a fixed turn ceiling", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    fixture.sqlite.prepare("INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at) VALUES('long','w','u','Saved','en','active','2020-01-01','2020-01-02')").run();
    for (let index = 0; index < 34; index++) for (const role of ["user", "assistant"]) {
      fixture.sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at) VALUES(?,'long',?,?,?)")
        .run(`${role}${index}`, role, `${role} complete content ${index}`, new Date(Date.UTC(2020, 0, 1, index)).toISOString());
    }
    const actor = { db: fixture.d1, workspaceId: "w", userId: "u", signal: new AbortController().signal };
    const prepared = await prepareSignedAnswerRequest({ ...actor, payload: { locale: "en", answerMode: "detailed", reasoningMode: "fast", idempotencyKey: "long-follow", conversationId: "long", operation: "follow_up", sourceMessageId: "assistant33", question: "Next question" } });
    const branch = await planAnswerBranch({ ...actor, ...prepared });
    const history = await loadAnswerHistory({ ...actor, conversationId: "long", parentBranchId: branch.parentBranchId });
    assert.equal(history.length, 68);
    assert.equal(history[0].content, "user complete content 0");
    assert.equal(history.at(-1)?.content, "assistant complete content 33");
  } finally { fixture.sqlite.close(); }
});
