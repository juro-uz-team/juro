import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { isoNow, parseJson } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { taskStatusForPlanStep, taskStatusIsTerminal } from "../../../../../../lib/platform/task-status";
import { workspaceForContentEditor, requireSelectedWorkspace } from "../../../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

function defaultReminderAt(dueAt: string, now: string): string {
  const due = new Date(`${dueAt.slice(0, 10)}T09:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() - 3);
  return due.getTime() < Date.parse(now) ? now : due.toISOString();
}

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const user = await requireApiUser();
  const { caseId } = await params;
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  const [rows, comments] = await Promise.all([
    db.prepare(
      "SELECT t.id,t.plan_step_id AS planStepId,t.title,t.description,t.status,t.source_date AS sourceDate,t.due_at AS dueAt,t.safe_due_at AS safeDueAt,t.calculation_method AS calculationMethod,t.deadline_type AS deadlineType,t.legal_basis AS legalBasis,t.deadline_confidence AS deadlineConfidence,t.deadline_evidence_json AS deadlineEvidenceJson,t.completed_at AS completedAt FROM tasks t WHERE t.case_id=? AND t.workspace_id=? AND case_visible_to(t.case_id,?) ORDER BY t.due_at IS NULL,t.due_at,t.created_at",
    ).bind(caseId, workspace.id, user.id).all(),
    db.prepare(
      `SELECT c.id,c.task_id AS taskId,c.body,c.created_at AS createdAt,u.full_name AS authorName
       FROM lawyer_task_comments c
       JOIN tasks t ON t.id=c.task_id AND t.case_id=? AND t.workspace_id=? AND case_visible_to(t.case_id,?)
       JOIN user_profiles u ON u.id=c.author_user_id
       ORDER BY c.created_at ASC`,
    ).bind(caseId, workspace.id, user.id).all(),
  ]);
  const commentsByTask = new Map<string, Array<Record<string, unknown>>>();
  for (const comment of comments.results as Array<Record<string, unknown>>) {
    const taskId = String(comment.taskId);
    commentsByTask.set(taskId, [...(commentsByTask.get(taskId) ?? []), comment]);
  }
  return response({
    tasks: (rows.results as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      comments: commentsByTask.get(String(row.id)) ?? [],
      deadlineEvidence: row.deadlineEvidenceJson
        ? parseJson(String(row.deadlineEvidenceJson), null)
        : null,
      deadlineEvidenceJson: undefined,
    })),
  });
});

export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const { caseId } = await params;
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  const owned = await db.prepare("SELECT id FROM cases WHERE id=? AND workspace_id=? AND case_visible_to(id,?) AND archived_at IS NULL LIMIT 1").bind(caseId, workspace.id, user.id).first();
  if (!owned) return response({ error: "Дело недоступно.", code: "CASE_UNAVAILABLE" }, 404);
  const steps = await db.prepare("SELECT s.id,s.title,s.description,s.status,s.deadline_source_date AS sourceDate,s.due_at AS dueAt,s.safe_due_at AS safeDueAt,s.calculation_method AS calculationMethod,s.deadline_type AS deadlineType,s.deadline_legal_basis AS legalBasis,s.deadline_days_count AS deadlineDaysCount,s.deadline_include_source_date AS deadlineIncludeSourceDate,s.deadline_roll_rule AS deadlineRollRule,s.holiday_calendar_version AS holidayCalendarVersion,s.deadline_evidence_json AS deadlineEvidenceJson,s.deadline_confidence AS deadlineConfidence,p.id AS planId,p.current_revision AS planRevision FROM action_plan_steps s JOIN action_plans p ON p.id=s.plan_id WHERE p.case_id=? ORDER BY s.ordinal").bind(caseId).all<{
    id: string;
    title: string;
    description: string | null;
    status: Parameters<typeof taskStatusForPlanStep>[0];
    sourceDate: string | null;
    dueAt: string | null;
    safeDueAt: string | null;
    calculationMethod: string | null;
    deadlineType: string;
    legalBasis: string | null;
    deadlineDaysCount: number | null;
    deadlineIncludeSourceDate: number;
    deadlineRollRule: string;
    holidayCalendarVersion: string | null;
    deadlineEvidenceJson: string | null;
    deadlineConfidence: string;
    planId: string;
    planRevision: number;
  }>();
  const now = isoNow();
  const statements = steps.results.flatMap((step) => {
    const taskId = step.id;
    const taskStatus = taskStatusForPlanStep(step.status);
    const reminderAt = step.dueAt && !taskStatusIsTerminal(taskStatus) ? defaultReminderAt(step.dueAt, now) : null;
    return [
      db.prepare("INSERT OR IGNORE INTO tasks (id,workspace_id,case_id,plan_step_id,owner_user_id,title,description,source_date,due_at,safe_due_at,calculation_method,deadline_type,legal_basis,deadline_days_count,deadline_include_source_date,deadline_roll_rule,holiday_calendar_version,deadline_evidence_json,deadline_confidence,status,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
        taskId,
        workspace.id,
        caseId,
        step.id,
        user.id,
        step.title,
        step.description,
        step.sourceDate,
        step.dueAt,
        step.safeDueAt,
        step.calculationMethod,
        step.deadlineType,
        step.legalBasis,
        step.deadlineDaysCount,
        step.deadlineIncludeSourceDate,
        step.deadlineRollRule,
        step.holidayCalendarVersion,
        step.deadlineEvidenceJson,
        step.deadlineConfidence,
        taskStatus,
        now,
        now,
        taskStatus === "completed" ? now : null,
      ),
      ...(reminderAt ? [
        db.prepare("INSERT OR IGNORE INTO task_reminders (id,task_id,channel,reminder_at,status,idempotency_key,created_at,updated_at) VALUES (?,?,'in_app',?,'pending',?,?,?)").bind(`${taskId}:in_app:initial`, taskId, reminderAt, `${taskId}:in_app:initial`, now, now),
        db.prepare("INSERT OR IGNORE INTO task_reminders (id,task_id,channel,reminder_at,status,idempotency_key,created_at,updated_at) VALUES (?,?,'email',?,'pending',?,?,?)").bind(`${taskId}:email:initial`, taskId, reminderAt, `${taskId}:email:initial`, now, now),
      ] : []),
    ];
  });
  const plan = steps.results[0];
  const confirmationStatements = plan
    ? [db.prepare("INSERT OR IGNORE INTO case_events (id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES (?,?,?,'tasks_created',?,?)").bind(
      `action-plan-tasks:${caseId}:${plan.planId}:${plan.planRevision}`,
      caseId,
      user.id,
      JSON.stringify({ source: "action_plan", planId: plan.planId, planRevision: plan.planRevision, stepCount: steps.results.length }),
      now,
    )]
    : [];
  await db.batch([...statements, ...confirmationStatements]);
  const count = await db.prepare("SELECT count(*) AS count FROM tasks WHERE case_id=? AND workspace_id=?").bind(caseId, workspace.id, user.id).first<{ count: number }>();
  return response({ ok: true, taskCount: count?.count ?? 0 }, 201);
});
