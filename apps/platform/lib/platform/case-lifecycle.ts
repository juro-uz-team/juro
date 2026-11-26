import { z } from "zod";

const GENESIS_HASH = "0".repeat(64);

export const caseLifecycleActionSchema = z.enum(["complete", "reopen", "archive", "restore"]);
export type CaseLifecycleAction = z.infer<typeof caseLifecycleActionSchema>;

export const caseLifecycleRequestSchema = z.object({ action: caseLifecycleActionSchema }).strict();
export const caseLifecycleIdempotencyKeySchema = z.string().min(8).max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);

type CaseRow = {
  id: string;
  workspaceId: string;
  status: string;
  archivedAt: string | null;
  completedAt: string | null;
  lifecycleRevision: number;
};

type StoredEvent = {
  action: CaseLifecycleAction;
  actorUserId: string;
  fromStatus: string;
  toStatus: string;
  toArchivedAt: string | null;
  unresolvedTaskCount: number;
  unresolvedPlanStepCount: number;
  lifecycleRevision: number;
  eventHash: string;
  createdAt: string;
};

export type CaseLifecycleResult = {
  caseId: string;
  status: string;
  archivedAt: string | null;
  completedAt: string | null;
  unresolvedTaskCount: number;
  unresolvedPlanStepCount: number;
  lifecycleRevision: number;
  replay: boolean;
};

export class CaseLifecycleError extends Error {
  constructor(readonly code: "CASE_UNAVAILABLE" | "CASE_LIFECYCLE_INVALID" | "CASE_LIFECYCLE_CONFLICT") {
    super(code);
    this.name = "CaseLifecycleError";
  }
}

function targetState(action: CaseLifecycleAction, current: CaseRow, now: string) {
  if (action === "complete" && current.status !== "completed" && current.status !== "archived" && !current.archivedAt) {
    return { status: "completed", archivedAt: null };
  }
  if (action === "reopen" && current.status === "completed" && !current.archivedAt) {
    return { status: "open", archivedAt: null };
  }
  if (action === "archive" && current.status === "completed" && !current.archivedAt) {
    return { status: "archived", archivedAt: now };
  }
  if (action === "restore" && current.status === "archived" && current.archivedAt) {
    return { status: "completed", archivedAt: null };
  }
  throw new CaseLifecycleError("CASE_LIFECYCLE_INVALID");
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalEvent(value: {
  id: string; caseId: string; workspaceId: string; actorUserId: string;
  action: CaseLifecycleAction; fromStatus: string; toStatus: string;
  fromArchivedAt: string | null; toArchivedAt: string | null;
  unresolvedTaskCount: number; unresolvedPlanStepCount: number;
  idempotencyKey: string; lifecycleRevision: number; previousHash: string; createdAt: string;
}) {
  return JSON.stringify(value);
}

async function currentCase(db: D1Database, caseId: string, workspaceId: string, actorUserId: string): Promise<CaseRow | null> {
  return db.prepare(
    `SELECT id,workspace_id AS workspaceId,status,archived_at AS archivedAt,
      completed_at AS completedAt,lifecycle_revision AS lifecycleRevision
     FROM cases WHERE id=? AND workspace_id=? AND case_visible_to(id,?) LIMIT 1`,
  ).bind(caseId, workspaceId, actorUserId).first<CaseRow>();
}

async function existingEvent(db: D1Database, caseId: string, idempotencyKey: string): Promise<StoredEvent | null> {
  return db.prepare(
    `SELECT action,actor_user_id AS actorUserId,from_status AS fromStatus,to_status AS toStatus,
      to_archived_at AS toArchivedAt,unresolved_task_count AS unresolvedTaskCount,
      unresolved_plan_step_count AS unresolvedPlanStepCount,lifecycle_revision AS lifecycleRevision,
      event_hash AS eventHash,created_at AS createdAt
     FROM case_lifecycle_events WHERE case_id=? AND idempotency_key=? LIMIT 1`,
  ).bind(caseId, idempotencyKey).first<StoredEvent>();
}

function replayResult(caseId: string, event: StoredEvent, current: CaseRow): CaseLifecycleResult {
  return {
    caseId,
    status: current.status,
    archivedAt: current.archivedAt,
    completedAt: current.completedAt,
    unresolvedTaskCount: event.unresolvedTaskCount,
    unresolvedPlanStepCount: event.unresolvedPlanStepCount,
    lifecycleRevision: current.lifecycleRevision,
    replay: true,
  };
}

export async function executeCaseLifecycle(input: {
  db: D1Database;
  caseId: string;
  workspaceId: string;
  actorUserId: string;
  action: CaseLifecycleAction;
  idempotencyKey: string;
  now?: string;
}): Promise<CaseLifecycleResult> {
  const current = await currentCase(input.db, input.caseId, input.workspaceId, input.actorUserId);
  if (!current) throw new CaseLifecycleError("CASE_UNAVAILABLE");

  const replay = await existingEvent(input.db, input.caseId, input.idempotencyKey);
  if (replay) {
    if (replay.action !== input.action || replay.actorUserId !== input.actorUserId) {
      throw new CaseLifecycleError("CASE_LIFECYCLE_CONFLICT");
    }
    return replayResult(input.caseId, replay, current);
  }
  const now = input.now ?? new Date().toISOString();
  const target = targetState(input.action, current, now);
  const counts = await input.db.prepare(
    `SELECT
      (SELECT count(*) FROM tasks WHERE case_id=? AND status NOT IN ('completed','cancelled')) AS unresolvedTaskCount,
      (SELECT count(*) FROM action_plan_steps step JOIN action_plans plan ON plan.id=step.plan_id
       WHERE plan.case_id=? AND step.status NOT IN ('completed','cancelled')) AS unresolvedPlanStepCount`,
  ).bind(input.caseId, input.caseId).first<{ unresolvedTaskCount: number; unresolvedPlanStepCount: number }>();
  if (!counts) throw new CaseLifecycleError("CASE_LIFECYCLE_CONFLICT");
  const parent = await input.db.prepare(
    "SELECT event_hash AS eventHash FROM case_lifecycle_events WHERE case_id=? ORDER BY lifecycle_revision DESC LIMIT 1",
  ).bind(input.caseId).first<{ eventHash: string }>();
  const event = {
    id: crypto.randomUUID(),
    caseId: input.caseId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.action,
    fromStatus: current.status,
    toStatus: target.status,
    fromArchivedAt: current.archivedAt,
    toArchivedAt: target.archivedAt,
    unresolvedTaskCount: Number(counts.unresolvedTaskCount),
    unresolvedPlanStepCount: Number(counts.unresolvedPlanStepCount),
    idempotencyKey: input.idempotencyKey,
    lifecycleRevision: Number(current.lifecycleRevision) + 1,
    previousHash: parent?.eventHash ?? GENESIS_HASH,
    createdAt: now,
  };
  const eventHash = await sha256(canonicalEvent(event));
  try {
    await input.db.prepare(
      `INSERT INTO case_lifecycle_events
       (id,case_id,workspace_id,actor_user_id,action,from_status,to_status,from_archived_at,to_archived_at,
        unresolved_task_count,unresolved_plan_step_count,idempotency_key,lifecycle_revision,previous_hash,event_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      event.id, event.caseId, event.workspaceId, event.actorUserId, event.action,
      event.fromStatus, event.toStatus, event.fromArchivedAt, event.toArchivedAt,
      event.unresolvedTaskCount, event.unresolvedPlanStepCount, event.idempotencyKey,
      event.lifecycleRevision, event.previousHash, eventHash, event.createdAt,
    ).run();
  } catch {
    const concurrentReplay = await existingEvent(input.db, input.caseId, input.idempotencyKey);
    if (concurrentReplay && concurrentReplay.action === input.action && concurrentReplay.actorUserId === input.actorUserId) {
      const latest = await currentCase(input.db, input.caseId, input.workspaceId, input.actorUserId);
      if (!latest) throw new CaseLifecycleError("CASE_UNAVAILABLE");
      return replayResult(input.caseId, concurrentReplay, latest);
    }
    throw new CaseLifecycleError("CASE_LIFECYCLE_CONFLICT");
  }
  const updated = await currentCase(input.db, input.caseId, input.workspaceId, input.actorUserId);
  if (!updated || updated.lifecycleRevision !== event.lifecycleRevision) {
    throw new CaseLifecycleError("CASE_LIFECYCLE_CONFLICT");
  }
  return {
    caseId: input.caseId,
    status: updated.status,
    archivedAt: updated.archivedAt,
    completedAt: updated.completedAt,
    unresolvedTaskCount: event.unresolvedTaskCount,
    unresolvedPlanStepCount: event.unresolvedPlanStepCount,
    lifecycleRevision: updated.lifecycleRevision,
    replay: false,
  };
}
