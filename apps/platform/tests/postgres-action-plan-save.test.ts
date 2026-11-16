import assert from "node:assert/strict";
import test from "node:test";
import { saveAiActionPlanToCase } from "../lib/ai/action-plan-save";
import { withPostgresRollback } from "./helpers/postgres-rollback";
const structuredAnswer = {
  responseKind: "answer" as const,
  summary: "Взыскание задолженности по договору",
  answer: "Сохранённый структурированный ответ JURO.",
  language: "ru" as const,
  jurisdiction: "UZ" as const,
  answerMode: "detailed" as const,
  reasoningMode: "deep" as const,
  clarificationQuestions: [],
  confirmedFindings: [], assumptions: [], risks: [], sources: [], requiredDocuments: [],
  actionPlan: [
    { title: "Собрать документы", description: "Соберите договор и подтверждения оплаты.", sourceIds: [] },
    { title: "Подготовить требование", description: "Подготовьте письменное требование контрагенту.", sourceIds: [] },
  ],
  deadlines: [], successOutlook: null, urgency: "normal" as const,
  suggestedDocument: null, suggestLawyer: false, legalDatabaseAsOf: "2026-11-16T00:00:00.000Z",
};

test("PostgreSQL saves, replays and appends confirmed practical steps and tasks", async () => {
 await withPostgresRollback(async db => {
 const USER_ID=crypto.randomUUID(),WORKSPACE_ID=crypto.randomUUID(),CONVERSATION_ID=crypto.randomUUID(),ASSISTANT_MESSAGE_ID=crypto.randomUUID();
 const NOW="2026-11-16T00:00:00.000Z";
  await db.prepare(
    "INSERT INTO workspaces (id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(WORKSPACE_ID, "individual", "AI Plan", null, null, "ru", NOW, NOW).run();
  await db.prepare(
    "INSERT INTO user_profiles (id,email,full_name,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(USER_ID, `${USER_ID}@example.invalid`, "AI Plan User", "ru", "individual", WORKSPACE_ID, NOW, NOW).run();
  await db.prepare(
    "INSERT INTO workspace_members (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(crypto.randomUUID(), WORKSPACE_ID, USER_ID, "owner", "active", NOW, NOW, NOW).run();
  await db.prepare(
    "INSERT INTO conversations (id,workspace_id,owner_user_id,case_id,title,locale,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?, ?,?)",
  ).bind(CONVERSATION_ID, WORKSPACE_ID, USER_ID, null, "Долг", "ru", "active", NOW, NOW).run();
  await db.prepare(
    "INSERT INTO conversation_messages (id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,?,?,?,?)",
  ).bind(ASSISTANT_MESSAGE_ID, CONVERSATION_ID, "assistant", structuredAnswer.answer, JSON.stringify(structuredAnswer), NOW).run();

 const input={db:db as unknown as D1Database,workspaceId:WORKSPACE_ID,userId:USER_ID,assistantMessageId:ASSISTANT_MESSAGE_ID,caseTitle:"Confirmed matter name",now:NOW};
 const first=await saveAiActionPlanToCase(input);
 assert.equal(first.taskCount,2);
 assert.equal(await db.prepare("SELECT title FROM cases WHERE id=?").bind(first.caseId).first("title"),"Confirmed matter name");
 assert.deepEqual(await saveAiActionPlanToCase(input),{...first,replay:true});
 const message=crypto.randomUUID();
 await db.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,'assistant',?,?,?)").bind(message,CONVERSATION_ID,structuredAnswer.answer,JSON.stringify(structuredAnswer),NOW).run();
 const appended=await saveAiActionPlanToCase({...input,assistantMessageId:message,targetCaseId:first.caseId});
 assert.equal(appended.caseId,first.caseId);
 assert.deepEqual(await saveAiActionPlanToCase({...input,assistantMessageId:message,targetCaseId:first.caseId}),{...appended,replay:true});
 assert.equal(await db.prepare("SELECT count(*) AS n FROM tasks WHERE case_id=?").bind(first.caseId).first("n"),4);
 const snapshot=await db.prepare("SELECT snapshot_json AS snapshot FROM action_plan_versions WHERE plan_id=? AND version=2").bind(first.planId).first<{snapshot:string}>();
 assert.equal(JSON.parse(snapshot!.snapshot).steps.length,4);
 });
});
