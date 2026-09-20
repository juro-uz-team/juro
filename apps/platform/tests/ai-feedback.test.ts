import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AiFeedbackError, listAiFeedback, saveAiFeedback } from "../lib/ai/feedback";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const USER_ID = "user_ai_feedback";
const WORKSPACE_ID = "ws_ai_feedback";
const CONVERSATION_ID = "conversation_ai_feedback";
const QUESTION_ID = "61cf318d-30a1-49f7-8602-5f1b04ccd63b";
const ANSWER_ID = "71cf318d-30a1-49f7-8602-5f1b04ccd63b";
const RUN_ID = "run_ai_feedback";
const NOW = "2026-08-03T10:00:00.000Z";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function seed() {
  const fixture = sqliteD1Fixture();
  fixture.sqlite.prepare("INSERT INTO workspaces (id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(WORKSPACE_ID, "individual", "AI feedback", null, null, "ru", NOW, NOW);
  fixture.sqlite.prepare("INSERT INTO user_profiles (id,email,full_name,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(USER_ID, "ai-feedback@example.invalid", "AI Feedback User", "ru", "individual", WORKSPACE_ID, NOW, NOW);
  fixture.sqlite.prepare("INSERT INTO conversations (id,workspace_id,owner_user_id,case_id,title,locale,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(CONVERSATION_ID, WORKSPACE_ID, USER_ID, null, "Вопрос", "ru", "active", NOW, NOW);
  fixture.sqlite.prepare("INSERT INTO conversation_messages (id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(QUESTION_ID, CONVERSATION_ID, "user", "Вопрос", null, NOW);
  fixture.sqlite.prepare("INSERT INTO conversation_messages (id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(ANSWER_ID, CONVERSATION_ID, "assistant", "Сохранённый ответ", "{}", NOW);
  fixture.sqlite.prepare(`
    INSERT INTO ai_runs (id,workspace_id,user_id,conversation_id,request_message_id,response_message_id,idempotency_key,correlation_id,provider,model,answer_mode,reasoning_mode,status,legal_database_as_of,instruction_hash,source_version_hash,started_at,completed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(RUN_ID, WORKSPACE_ID, USER_ID, CONVERSATION_ID, QUESTION_ID, ANSWER_ID, "feedback-key", "feedback-correlation", "anthropic", "claude-sonnet-4-6", "detailed", "deep", "completed", NOW, "instruction", "sources", NOW, NOW, NOW, NOW);
  return fixture;
}

test("AI feedback is tenant-scoped, updates idempotently and references the completed AI run", async () => {
  const { sqlite, d1 } = seed();
  try {
    const first = await saveAiFeedback({ db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID, assistantMessageId: ANSWER_ID, feedbackType: "wrong_norm", comment: "Проверьте ссылку на норму.", now: NOW });
    assert.equal(first.replay, false);
    const replay = await saveAiFeedback({ db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID, assistantMessageId: ANSWER_ID, feedbackType: "wrong_norm", comment: "Уточнённый комментарий.", now: "2026-08-03T10:01:00.000Z" });
    assert.equal(replay.replay, true);
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM ai_feedback").get() as { count: number }).count, 1);
    const feedback = await listAiFeedback({ db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID, assistantMessageId: ANSWER_ID });
    assert.deepEqual(feedback.map(({ feedbackType, comment, updatedAt }) => ({ feedbackType, comment, updatedAt })), [{ feedbackType: "wrong_norm", comment: "Уточнённый комментарий.", updatedAt: "2026-08-03T10:01:00.000Z" }]);
    const linkage = sqlite.prepare("SELECT ai_run_id AS aiRunId,conversation_id AS conversationId FROM ai_feedback").get() as { aiRunId: string; conversationId: string };
    assert.deepEqual({ aiRunId: linkage.aiRunId, conversationId: linkage.conversationId }, { aiRunId: RUN_ID, conversationId: CONVERSATION_ID });
    const audit = JSON.parse((sqlite.prepare("SELECT metadata_json AS metadataJson FROM workspace_audit_events WHERE action='ai_feedback_saved' LIMIT 1").get() as { metadataJson: string }).metadataJson) as { feedbackType: string; aiRunId: string };
    assert.deepEqual({ feedbackType: audit.feedbackType, aiRunId: audit.aiRunId }, { feedbackType: "wrong_norm", aiRunId: RUN_ID });
  } finally { sqlite.close(); }
});

test("AI feedback does not reveal another workspace answer or accept invalid feedback types", async () => {
  const { sqlite, d1 } = seed();
  try {
    await assert.rejects(
      () => saveAiFeedback({ db: d1, workspaceId: "ws_foreign", userId: USER_ID, assistantMessageId: ANSWER_ID, feedbackType: "unsafe", comment: null, now: NOW }),
      (error: unknown) => error instanceof AiFeedbackError && error.code === "AI_FEEDBACK_NOT_FOUND",
    );
    assert.throws(() => sqlite.prepare("INSERT INTO ai_feedback (id,workspace_id,user_id,conversation_id,assistant_message_id,ai_run_id,feedback_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("invalid-feedback", WORKSPACE_ID, USER_ID, CONVERSATION_ID, ANSWER_ID, RUN_ID, "invented", NOW, NOW), /ai_feedback_type_check/);
  } finally { sqlite.close(); }
});

test("AI feedback route requires a safe write, authenticated tenant scope and never sends content to analytics", () => {
  const route = source("app/api/platform/ai/feedback/route.ts");
  const service = source("lib/ai/feedback.ts");
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /legalChatOwner\(request\)/);
  const owner=source("lib/legal-chat/http-owner.ts");
  assert.match(owner,/requireApiUser\(request\)/);
  assert.match(owner,/workspaceForUserById\(user.id,selected\)/);
  assert.match(service, /run\.workspace_id=\?\s+AND run\.user_id=\?/);
  assert.match(service, /conversation\.workspace_id=\?\s+AND conversation\.owner_user_id=\?/);
  assert.match(service, /ai_feedback_saved/);
  assert.doesNotMatch(service, /track[A-Z]|analytics/);
});

test("AI feedback remains connected to its saved answer in the browser",()=>{
  const client=source("app/_platform/AiLawyerClient.tsx");
  assert.match(client, /\/api\/platform\/ai\/feedback/);
  assert.match(client, /assistantMessageId: answer\.messageId/);
});
