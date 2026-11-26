import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CaseLifecycleError,
  caseLifecycleIdempotencyKeySchema,
  caseLifecycleRequestSchema,
  executeCaseLifecycle,
} from "../lib/platform/case-lifecycle";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const NOW = "2026-08-05T17:00:00.000Z";
const USER_ID = "case-lifecycle-user";
const OTHER_USER_ID = "case-lifecycle-other-user";
const WORKSPACE_ID = "case-lifecycle-workspace";
const OTHER_WORKSPACE_ID = "case-lifecycle-other-workspace";
const CASE_ID = "case-lifecycle-case";

function seed() {
  const value = sqliteD1Fixture();
  value.sqlite.prepare(
    "INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(WORKSPACE_ID, "individual", "Case lifecycle", "ru", NOW, NOW);
  value.sqlite.prepare(
    "INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(OTHER_WORKSPACE_ID, "individual", "Other", "ru", NOW, NOW);
  value.sqlite.prepare(
    "INSERT INTO user_profiles(id,email,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run(USER_ID, "case-lifecycle@example.invalid", "ru", "individual", WORKSPACE_ID, NOW, NOW);
  value.sqlite.prepare(
    "INSERT INTO user_profiles(id,email,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run(OTHER_USER_ID, "case-lifecycle-other@example.invalid", "ru", "individual", OTHER_WORKSPACE_ID, NOW, NOW);
  value.sqlite.prepare(
    "INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run("case-member", WORKSPACE_ID, USER_ID, "owner", "active", NOW, NOW, NOW);
  value.sqlite.prepare(
    "INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run("other-case-member", OTHER_WORKSPACE_ID, OTHER_USER_ID, "owner", "active", NOW, NOW, NOW);
  value.sqlite.prepare(
    `INSERT INTO cases
     (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'open',1,?,?)`,
  ).run(CASE_ID, WORKSPACE_ID, USER_ID, "individual", "ru", "Debt case", "debt", NOW, NOW);
  value.sqlite.prepare(
    `INSERT INTO action_plans
     (id,case_id,created_by_user_id,title,status,progress_percent,current_revision,created_at,updated_at)
     VALUES ('case-lifecycle-plan',?,?,?,'in_progress',0,1,?,?)`,
  ).run(CASE_ID, USER_ID, "Plan", NOW, NOW);
  value.sqlite.prepare(
    `INSERT INTO action_plan_steps
     (id,plan_id,ordinal,title,status,deadline_type,revision,created_at,updated_at)
     VALUES ('case-lifecycle-step','case-lifecycle-plan',1,'Step','not_started','calendar_days',1,?,?)`,
  ).run(NOW, NOW);
  value.sqlite.prepare(
    `INSERT INTO tasks
     (id,workspace_id,case_id,owner_user_id,title,deadline_type,status,created_at,updated_at)
     VALUES ('case-lifecycle-task',?,?,?,'Task','calendar_days','planned',?,?)`,
  ).run(WORKSPACE_ID, CASE_ID, USER_ID, NOW, NOW);
  return value;
}

test("case lifecycle request and idempotency contracts are strict", () => {
  assert.equal(caseLifecycleRequestSchema.safeParse({ action: "complete" }).success, true);
  assert.equal(caseLifecycleRequestSchema.safeParse({ action: "delete" }).success, false);
  assert.equal(caseLifecycleRequestSchema.safeParse({ action: "complete", workspaceId: "attacker" }).success, false);
  assert.equal(caseLifecycleIdempotencyKeySchema.safeParse("case-complete-123").success, true);
  assert.equal(caseLifecycleIdempotencyKeySchema.safeParse("short").success, false);
});

test("complete, archive, restore and reopen are projected from an immutable chained ledger", async () => {
  const { sqlite, d1 } = seed();
  const complete = await executeCaseLifecycle({
    db: d1, caseId: CASE_ID, workspaceId: WORKSPACE_ID, actorUserId: USER_ID,
    action: "complete", idempotencyKey: "case-complete-0001", now: NOW,
  });
  assert.equal(complete.status, "completed");
  assert.equal(complete.unresolvedTaskCount, 1);
  assert.equal(complete.unresolvedPlanStepCount, 1);
  assert.equal(complete.lifecycleRevision, 1);
  assert.equal(complete.replay, false);

  const replay = await executeCaseLifecycle({
    db: d1, caseId: CASE_ID, workspaceId: WORKSPACE_ID, actorUserId: USER_ID,
    action: "complete", idempotencyKey: "case-complete-0001", now: "2026-08-05T17:01:00.000Z",
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.lifecycleRevision, 1);

  const archived = await executeCaseLifecycle({
    db: d1, caseId: CASE_ID, workspaceId: WORKSPACE_ID, actorUserId: USER_ID,
    action: "archive", idempotencyKey: "case-archive-0001", now: "2026-08-05T17:02:00.000Z",
  });
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedAt, "2026-08-05T17:02:00.000Z");

  const restored = await executeCaseLifecycle({
    db: d1, caseId: CASE_ID, workspaceId: WORKSPACE_ID, actorUserId: USER_ID,
    action: "restore", idempotencyKey: "case-restore-0001", now: "2026-08-05T17:03:00.000Z",
  });
  assert.equal(restored.status, "completed");
  assert.equal(restored.archivedAt, null);

  const reopened = await executeCaseLifecycle({
    db: d1, caseId: CASE_ID, workspaceId: WORKSPACE_ID, actorUserId: USER_ID,
    action: "reopen", idempotencyKey: "case-reopen-0001", now: "2026-08-05T17:04:00.000Z",
  });
  assert.equal(reopened.status, "open");
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.lifecycleRevision, 4);

  const caseRow = sqlite.prepare(
    "SELECT status,archived_at AS archivedAt,completed_at AS completedAt,lifecycle_revision AS lifecycleRevision,current_revision AS currentRevision FROM cases WHERE id=?",
  ).get(CASE_ID) as Record<string, unknown>;
  assert.deepEqual({ ...caseRow }, { status: "open", archivedAt: null, completedAt: null, lifecycleRevision: 4, currentRevision: 5 });
  const events = sqlite.prepare(
    "SELECT action,lifecycle_revision AS lifecycleRevision,previous_hash AS previousHash,event_hash AS eventHash FROM case_lifecycle_events WHERE case_id=? ORDER BY lifecycle_revision",
  ).all(CASE_ID) as Array<Record<string, unknown>>;
  assert.deepEqual(events.map((event) => event.action), ["complete", "archive", "restore", "reopen"]);
  assert.equal(events[0]?.previousHash, "0".repeat(64));
  for (let index = 1; index < events.length; index += 1) assert.equal(events[index]?.previousHash, events[index - 1]?.eventHash);
  assert.throws(() => sqlite.prepare("UPDATE case_lifecycle_events SET action='archive' WHERE case_id=?").run(CASE_ID), /CASE_LIFECYCLE_EVENT_IMMUTABLE/u);
  assert.throws(() => sqlite.prepare("DELETE FROM case_lifecycle_events WHERE case_id=?").run(CASE_ID), /CASE_LIFECYCLE_EVENT_IMMUTABLE/u);
});

test("tenant isolation returns neutral unavailability and D1 rejects fabricated lifecycle evidence", async () => {
  const { sqlite, d1 } = seed();
  await executeCaseLifecycle({
    db: d1, caseId: CASE_ID, workspaceId: WORKSPACE_ID, actorUserId: USER_ID,
    action: "complete", idempotencyKey: "case-idor-0001", now: NOW,
  });
  await assert.rejects(
    executeCaseLifecycle({
      db: d1, caseId: CASE_ID, workspaceId: OTHER_WORKSPACE_ID, actorUserId: OTHER_USER_ID,
      action: "complete", idempotencyKey: "case-idor-0001", now: NOW,
    }),
    (error: unknown) => error instanceof CaseLifecycleError && error.code === "CASE_UNAVAILABLE",
  );
  assert.throws(() => sqlite.prepare(
    `INSERT INTO case_lifecycle_events
     (id,case_id,workspace_id,actor_user_id,action,from_status,to_status,from_archived_at,to_archived_at,
      unresolved_task_count,unresolved_plan_step_count,idempotency_key,lifecycle_revision,previous_hash,event_hash,created_at)
     VALUES ('fabricated',?,?,?,'archive','completed','archived',NULL,?,0,0,'fabricated-case-event',2,?,?,?)`,
  ).run(CASE_ID, WORKSPACE_ID, USER_ID, NOW, "a".repeat(64), "b".repeat(64), NOW), /CASE_LIFECYCLE_CONFLICT/u);
});

test("case lifecycle API and RU/UZ UI keep auth, CSRF, retry and archive restoration connected", () => {
  const route = readFileSync(new URL("../app/api/platform/cases/[caseId]/route.ts", import.meta.url), "utf8");
  const archiveRoute = readFileSync(new URL("../app/api/platform/archive/route.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../app/_platform/CaseWorkspaceClient.tsx", import.meta.url), "utf8");
  const archive = readFileSync(new URL("../app/_platform/ArchiveClient.tsx", import.meta.url), "utf8");
  assert.match(route, /assertSafeWrite\(request\)/u);
  assert.match(route, /requireApiUser\(\)/u);
  assert.match(route, /workspaceForContentEditor\(user,\s*request\.headers\.get\("x-juro-workspace-id"\)\)/u);
  assert.match(route, /idempotency-key/u);
  assert.match(route, /executeCaseLifecycle/u);
  assert.match(archiveRoute, /action: "restore"/u);
  assert.doesNotMatch(archiveRoute, /UPDATE cases SET archived_at=NULL/u);
  assert.match(workspace, /Завершить дело/u);
  assert.match(workspace, /Ishni yakunlash/u);
  assert.match(workspace, /window\.confirm/u);
  assert.match(workspace, /role="alert"/u);
  assert.match(archive, /idempotency-key/u);
});
