import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AiActionPlanSaveError,
  saveAiActionPlanInputSchema,
  saveAiActionPlanToCase,
} from "../lib/ai/action-plan-save";
import { confirmedActionPlanPatchSchema } from "../lib/platform/action-plan";
import { batchBarrier, sqliteD1Fixture } from "./helpers/sqlite-d1";

const USER_ID = "user_ai_plan";
const WORKSPACE_ID = "ws_ai_plan";
const CONVERSATION_ID = "conversation_ai_plan";
const ASSISTANT_MESSAGE_ID = "21f0218d-30a1-49f7-8602-5f1b04ccd63b";
const NOW = "2026-08-03T08:00:00.000Z";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

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
  suggestedDocument: null, suggestLawyer: false, legalDatabaseAsOf: NOW,
};

function seed() {
  const fixture = sqliteD1Fixture();
  fixture.sqlite.prepare(
    "INSERT INTO workspaces (id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(WORKSPACE_ID, "individual", "AI Plan", null, null, "ru", NOW, NOW);
  fixture.sqlite.prepare(
    "INSERT INTO user_profiles (id,email,full_name,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(USER_ID, "ai-plan@example.invalid", "AI Plan User", "ru", "individual", WORKSPACE_ID, NOW, NOW);
  fixture.sqlite.prepare(
    "INSERT INTO workspace_members (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run("member_ai_plan", WORKSPACE_ID, USER_ID, "owner", "active", NOW, NOW, NOW);
  fixture.sqlite.prepare(
    "INSERT INTO conversations (id,workspace_id,owner_user_id,case_id,title,locale,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?, ?,?)",
  ).run(CONVERSATION_ID, WORKSPACE_ID, USER_ID, null, "Долг", "ru", "active", NOW, NOW);
  fixture.sqlite.prepare(
    "INSERT INTO conversation_messages (id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,?,?,?,?)",
  ).run(ASSISTANT_MESSAGE_ID, CONVERSATION_ID, "assistant", structuredAnswer.answer, JSON.stringify(structuredAnswer), NOW);
  return fixture;
}

test("explicit AI-plan confirmation persists a tenant-scoped case, immutable plan and tasks exactly once", async () => {
  const { sqlite, d1 } = seed();
  try {
    const first = await saveAiActionPlanToCase({
      db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID, now: NOW,
    });
    assert.equal(first.replay, false);
    assert.equal(first.taskCount, 2);
    assert.match(first.caseId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM action_plan_steps WHERE plan_id=?").get(first.planId) as { count: number }).count,
      2,
    );
    const stepIds = sqlite.prepare("SELECT id FROM action_plan_steps WHERE plan_id=? ORDER BY ordinal").all(first.planId) as Array<{ id: string }>;
    assert.ok(stepIds.every((step) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(step.id)));
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM tasks WHERE case_id=? AND workspace_id=?").get(first.caseId, WORKSPACE_ID) as { count: number }).count,
      2,
    );
    assert.equal(
      (sqlite.prepare("SELECT reason FROM action_plan_versions WHERE plan_id=?").get(first.planId) as { reason: string }).reason,
      "ai_plan_confirmed",
    );
    const replay = await saveAiActionPlanToCase({
      db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID, now: "2026-08-03T08:01:00.000Z",
    });
    assert.deepEqual(replay, { ...first, replay: true });
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM cases WHERE workspace_id=?").get(WORKSPACE_ID) as { count: number }).count,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("explicit confirmation appends a persisted AI plan to one tenant-owned case as an immutable revision", async () => {
  const { sqlite, d1 } = seed();
  const caseId = "6b56f9b7-b726-4ed3-8d4a-4bf42ec8da14";
  const planId = "89ff827b-37de-4c3c-89af-e5d4fc1a192c";
  const originalStepId = "85b6dbe9-cb62-4706-b4fb-1a57a95aa00c";
  try {
    sqlite.prepare(
      "INSERT INTO cases (id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,current_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(caseId, WORKSPACE_ID, USER_ID, "individual", "ru", "Существующее дело", null, "contracts", "open", 1, NOW, NOW);
    sqlite.prepare(
      "INSERT INTO action_plans (id,case_id,created_by_user_id,title,status,progress_percent,current_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(planId, caseId, USER_ID, "Основной план", "completed", 100, 1, NOW, NOW);
    sqlite.prepare(
      "INSERT INTO action_plan_steps (id,plan_id,ordinal,title,description,status,deadline_type,action_type,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(originalStepId, planId, 1, "Исходный шаг", "Не менять", "completed", "calendar_days", "manual", 1, NOW, NOW);
    sqlite.prepare(
      "INSERT INTO action_plan_versions (id,plan_id,version,created_by_user_id,reason,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(crypto.randomUUID(), planId, 1, USER_ID, "initial", JSON.stringify({ version: 1 }), NOW);

    const first = await saveAiActionPlanToCase({
      db: d1,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      targetCaseId: caseId,
      now: "2026-08-03T08:05:00.000Z",
    });
    assert.deepEqual(first, { caseId, planId, taskCount: 2, replay: false });
    assert.equal(
      (sqlite.prepare("SELECT current_revision AS revision FROM action_plans WHERE id=?").get(planId) as { revision: number }).revision,
      2,
    );
    assert.equal(
      (sqlite.prepare("SELECT progress_percent AS progress,status FROM action_plans WHERE id=?").get(planId) as { progress: number; status: string }).progress,
      33,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM action_plan_steps WHERE plan_id=?").get(planId) as { count: number }).count,
      3,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM tasks WHERE case_id=? AND workspace_id=?").get(caseId, WORKSPACE_ID) as { count: number }).count,
      2,
    );
    const version = sqlite.prepare(
      "SELECT reason,snapshot_json AS snapshotJson FROM action_plan_versions WHERE plan_id=? AND version=2",
    ).get(planId) as { reason: string; snapshotJson: string };
    assert.equal(version.reason, "ai_plan_appended");
    const snapshot = JSON.parse(version.snapshotJson) as { version: number; assistantMessageId: string; steps: Array<{ title: string }> };
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.assistantMessageId, ASSISTANT_MESSAGE_ID);
    assert.deepEqual(snapshot.steps.map((step) => step.title), ["Исходный шаг", "Собрать документы", "Подготовить требование"]);

    const replay = await saveAiActionPlanToCase({
      db: d1,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      targetCaseId: caseId,
      now: "2026-08-03T08:06:00.000Z",
    });
    assert.deepEqual(replay, { ...first, replay: true });
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM action_plan_versions WHERE plan_id=?").get(planId) as { count: number }).count,
      2,
    );

    const secondCaseId = "f953aeaf-a212-4ea2-a7d4-ac612e840bbb";
    sqlite.prepare(
      "INSERT INTO cases (id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,current_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(secondCaseId, WORKSPACE_ID, USER_ID, "individual", "ru", "Дело без плана", null, "contracts", "open", 1, NOW, NOW);
    const secondDestination = await saveAiActionPlanToCase({
      db: d1,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      targetCaseId: secondCaseId,
      now: "2026-08-03T08:07:00.000Z",
    });
    assert.equal(secondDestination.caseId, secondCaseId);
    assert.equal(secondDestination.taskCount, 2);
    assert.equal(secondDestination.replay, false);
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM action_plan_steps WHERE plan_id=?").get(secondDestination.planId) as { count: number }).count,
      2,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM action_plan_versions WHERE plan_id=? AND version=1").get(secondDestination.planId) as { count: number }).count,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("AI-plan append input is UUID-bounded and a foreign case remains undiscoverable", async () => {
  assert.equal(saveAiActionPlanInputSchema.safeParse({ assistantMessageId: ASSISTANT_MESSAGE_ID, targetCaseId: "not-a-case", locale: "ru" }).success, false);
  const { sqlite, d1 } = seed();
  const foreignWorkspaceId = "ws_ai_plan_foreign";
  const foreignCaseId = "2e3c46e3-9d0a-4425-a4e4-9fa6a1c1bb98";
  try {
    sqlite.prepare(
      "INSERT INTO workspaces (id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(foreignWorkspaceId, "individual", "Foreign", null, null, "ru", NOW, NOW);
    sqlite.prepare(
      "INSERT INTO cases (id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,current_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(foreignCaseId, foreignWorkspaceId, USER_ID, "individual", "ru", "Чужое дело", null, "contracts", "open", 1, NOW, NOW);
    await assert.rejects(
      () => saveAiActionPlanToCase({
        db: d1,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        targetCaseId: foreignCaseId,
        now: NOW,
      }),
      (error: unknown) => error instanceof AiActionPlanSaveError && error.code === "AI_ACTION_PLAN_CASE_NOT_FOUND",
    );
  } finally {
    sqlite.close();
  }
});

test("confirmed plan changes accept only UUID steps or the bounded legacy AI-step identity", () => {
  const base = { status: "not_started", revision: 1, dueAt: null } as const;
  assert.equal(confirmedActionPlanPatchSchema.safeParse({
    revision: 1,
    changes: [{ ...base, id: `plan_ai_${ASSISTANT_MESSAGE_ID.replaceAll("-", "")}:step:2` }],
  }).success, true);
  assert.equal(confirmedActionPlanPatchSchema.safeParse({
    revision: 1,
    changes: [{ ...base, id: "plan_ai_escape:step:2 OR 1=1" }],
  }).success, false);
});

test("legacy non-UUID plan cases retain replay safety after the builder-compatible ID migration", async () => {
  const { sqlite, d1 } = seed();
  try {
    const legacyCaseId = `case_ai_plan_${ASSISTANT_MESSAGE_ID.replaceAll("-", "")}`;
    const legacyPlanId = `plan_ai_${ASSISTANT_MESSAGE_ID.replaceAll("-", "")}`;
    sqlite.prepare(
      "INSERT INTO cases (id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,current_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(legacyCaseId, WORKSPACE_ID, USER_ID, "individual", "ru", "Legacy", null, "ai_proposed", "open", 1, NOW, NOW);
    sqlite.prepare(
      "INSERT INTO action_plans (id,case_id,created_by_user_id,title,status,progress_percent,current_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(legacyPlanId, legacyCaseId, USER_ID, "Legacy", "in_progress", 0, 1, NOW, NOW);
    const replay = await saveAiActionPlanToCase({
      db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, now: NOW,
    });
    assert.deepEqual(replay, { caseId: legacyCaseId, planId: legacyPlanId, taskCount: 0, replay: true });
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM cases WHERE workspace_id=?").get(WORKSPACE_ID) as { count: number }).count,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("AI-plan save denies a foreign workspace and incomplete response without exposing plan content", async () => {
  const { sqlite, d1 } = seed();
  try {
    await assert.rejects(
      () => saveAiActionPlanToCase({
        db: d1, workspaceId: "ws_foreign", userId: USER_ID,
        assistantMessageId: ASSISTANT_MESSAGE_ID, now: NOW,
      }),
      (error: unknown) => error instanceof AiActionPlanSaveError && error.code === "AI_ACTION_PLAN_NOT_FOUND",
    );
    sqlite.prepare("UPDATE conversation_messages SET structured_json=? WHERE id=?")
      .run(JSON.stringify({ ...structuredAnswer, responseKind: "clarification_required", actionPlan: [] }), ASSISTANT_MESSAGE_ID);
    await assert.rejects(
      () => saveAiActionPlanToCase({
        db: d1, workspaceId: WORKSPACE_ID, userId: USER_ID,
        assistantMessageId: ASSISTANT_MESSAGE_ID, now: NOW,
      }),
      (error: unknown) => error instanceof AiActionPlanSaveError && error.code === "AI_ACTION_PLAN_EMPTY",
    );
  } finally {
    sqlite.close();
  }
});

test("AI-plan route and chat require server-side ownership and explicit confirmation", () => {
  const route = source("app/api/platform/ai/action-plan/route.ts");
  const service = source("lib/ai/action-plan-save.ts");
  const client = source("app/_platform/AiLawyerClient.tsx");
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /legalChatOwner\(request\)/);
  assert.match(service, /member\.status='active' AND member\.role IN/);
  assert.match(route, /saveAiActionPlanToCase/);
  assert.match(service, /conversation\.workspace_id=\? AND conversation\.owner_user_id=\?/);
  assert.match(service, /c\.id=\? AND c\.workspace_id=\? AND c\.archived_at IS NULL/);
  assert.match(service, /structuredJson/);
  assert.match(service, /ai_action_plan_confirmed/);
  assert.match(service, /ai_action_plan_appended/);
  assert.match(client, /ai-plan-confirmation/);
  assert.match(client, /planConfirmationRef/);
  assert.match(client, /\/api\/platform\/ai\/action-plan/);
  assert.match(client, /assistantMessageId:\s*answer\.messageId/);
  assert.match(client, /targetCaseId:\s*targetCaseId\s*\|\|\s*undefined/);
});


test("concurrent identical confirmations commit one plan and return the same receipt", async () => {
  const {sqlite,d1}=seed();
  try {
    const db=batchBarrier(d1);
    const input={db,workspaceId:WORKSPACE_ID,userId:USER_ID,assistantMessageId:ASSISTANT_MESSAGE_ID,now:NOW};
    const saved=await Promise.all([saveAiActionPlanToCase(input),saveAiActionPlanToCase(input)]);
    assert.equal(saved[0].caseId,saved[1].caseId);
    assert.equal(saved.filter(item=>item.replay).length,1);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM action_plan_versions").get()?.n,1);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM tasks").get()?.n,2);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM tasks WHERE id=plan_step_id").get()?.n,2);
  } finally {sqlite.close();}
});

test("a failure after writing steps rolls the complete confirmation back", async () => {
  const {sqlite,d1}=seed();
  try {
    sqlite.exec("CREATE TRIGGER reject_plan_version BEFORE INSERT ON action_plan_versions BEGIN SELECT RAISE(ABORT,'injected persistence failure'); END;");
    await assert.rejects(saveAiActionPlanToCase({db:d1,workspaceId:WORKSPACE_ID,userId:USER_ID,assistantMessageId:ASSISTANT_MESSAGE_ID,now:NOW}),
      (error:unknown)=>error instanceof AiActionPlanSaveError && error.code==="AI_ACTION_PLAN_PERSISTENCE_FAILED");
    for(const table of ["cases","action_plans","action_plan_steps","tasks","case_events","action_plan_versions"]){
      assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0,table);
    }
  } finally {sqlite.close();}
});

test("read-only membership and removal before commit cannot save a plan", async () => {
  const {sqlite,d1}=seed();
  try {
    const input={db:d1,workspaceId:WORKSPACE_ID,userId:USER_ID,assistantMessageId:ASSISTANT_MESSAGE_ID,now:NOW};
    sqlite.prepare("UPDATE workspace_members SET role='viewer' WHERE user_id=?").run(USER_ID);
    await assert.rejects(saveAiActionPlanToCase(input),(error:unknown)=>error instanceof AiActionPlanSaveError && error.code==="AI_ACTION_PLAN_NOT_FOUND");
    sqlite.prepare("UPDATE workspace_members SET role='owner' WHERE user_id=?").run(USER_ID);
    const originalBatch=d1.batch.bind(d1);
    d1.batch=async (statements:D1PreparedStatement[])=>{
      sqlite.prepare("UPDATE workspace_members SET status='removed' WHERE user_id=?").run(USER_ID);
      return originalBatch(statements);
    };
    await assert.rejects(saveAiActionPlanToCase(input),(error:unknown)=>error instanceof AiActionPlanSaveError && error.code==="AI_ACTION_PLAN_PERSISTENCE_FAILED");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM cases").get()?.n,0);
  } finally {sqlite.close();}
});


test("appending preserves retained progress semantics and selected-workspace case classification", async () => {
  const {sqlite,d1}=seed();
  try {
    sqlite.prepare("UPDATE workspaces SET type='business',full_name='Business workspace',short_name='Business' WHERE id=?").run(WORKSPACE_ID);
    const input={db:d1,workspaceId:WORKSPACE_ID,userId:USER_ID,assistantMessageId:ASSISTANT_MESSAGE_ID,now:NOW};
    const first=await saveAiActionPlanToCase(input);
    assert.equal(sqlite.prepare("SELECT account_type AS type FROM cases WHERE id=?").get(first.caseId)?.type,"business");
    const steps=sqlite.prepare("SELECT id FROM action_plan_steps WHERE plan_id=? ORDER BY ordinal").all(first.planId);
    sqlite.prepare("UPDATE action_plan_steps SET status='completed' WHERE id=?").run(steps[0].id);
    sqlite.prepare("UPDATE action_plan_steps SET status='cancelled' WHERE id=?").run(steps[1].id);
    const nextMessage=crypto.randomUUID();
    sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,'assistant',?,?,?)")
      .run(nextMessage,CONVERSATION_ID,"Next saved answer",JSON.stringify({...structuredAnswer,actionPlan:Array.from({length:4},(_,i)=>({...structuredAnswer.actionPlan[0],title:`Next step ${i+1}`}))}),NOW);
    await saveAiActionPlanToCase({...input,assistantMessageId:nextMessage,targetCaseId:first.caseId});
    assert.equal(sqlite.prepare("SELECT progress_percent AS progress FROM action_plans WHERE id=?").get(first.planId)?.progress,17);
    assert.equal(sqlite.prepare("SELECT current_revision AS revision FROM cases WHERE id=?").get(first.caseId)?.revision,2);
    const version=sqlite.prepare("SELECT snapshot_json AS snapshot FROM action_plan_versions WHERE plan_id=? AND version=2").get(first.planId);
    assert.equal(JSON.parse(String(version?.snapshot)).progressPercent,17);
  } finally {sqlite.close();}
});


test("saved confirmation events remain replayable across changes to generated identifiers", async()=>{
  const {sqlite,d1}=seed();
  try{
    const input={db:d1,workspaceId:WORKSPACE_ID,userId:USER_ID,assistantMessageId:ASSISTANT_MESSAGE_ID,now:NOW};
    const first=await saveAiActionPlanToCase(input);
    sqlite.prepare("UPDATE case_events SET id=? WHERE case_id=?").run(crypto.randomUUID(),first.caseId);
    assert.deepEqual(await saveAiActionPlanToCase(input),{...first,replay:true});
    assert.deepEqual(await saveAiActionPlanToCase({...input,targetCaseId:first.caseId}),{...first,replay:true});
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM action_plan_steps").get()?.n,2);
  }finally{sqlite.close();}
});
