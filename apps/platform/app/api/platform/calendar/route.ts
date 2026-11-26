import {
  requireApiUser,
  withApiErrors,
} from "../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { calendarRangeFromSearch } from "../../../../lib/platform/calendar";
import { workspaceForUser } from "../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  let range;
  try {
    range = calendarRangeFromSearch(new URL(request.url).searchParams);
  } catch {
    return response(
      {
        error: "Некорректный диапазон календаря.",
        code: "INVALID_CALENDAR_RANGE",
      },
      400,
    );
  }
  const db = requireD1();
  const [rows, consultations] = await Promise.all([
    db
      .prepare(
        `SELECT
      s.id AS planStepId,
      t.id AS taskId,
      COALESCE(t.title,s.title) AS title,
      COALESCE(t.status,s.status) AS status,
      s.due_at AS dueAt,
      t.safe_due_at AS safeDueAt,
      c.id AS caseId,
      c.title AS caseTitle,
      c.legal_area AS legalArea,
      CASE WHEN t.id IS NULL THEN 'plan_step' ELSE 'task' END AS source
    FROM action_plan_steps s
    JOIN action_plans p ON p.id=s.plan_id
    JOIN cases c ON c.id=p.case_id
    LEFT JOIN tasks t ON t.plan_step_id=s.id AND t.case_id=c.id AND t.workspace_id=c.workspace_id
    WHERE c.workspace_id=? AND case_visible_to(c.id,?)
      AND c.archived_at IS NULL
      AND s.due_at IS NOT NULL
      AND s.due_at>=? AND s.due_at<?
      AND s.status NOT IN ('completed','cancelled')
      AND (t.id IS NULL OR t.status NOT IN ('completed','cancelled'))
    ORDER BY s.due_at ASC,c.title ASC,s.ordinal ASC`,
      )
      .bind(workspace.id, user.id, range.from, range.to)
      .all(),
    db
      .prepare(
        `SELECT
      'consultation:' || lc.id AS planStepId,
      NULL AS taskId,
      CASE WHEN lc.format='phone' THEN 'Телефонная консультация'
        WHEN lc.format='office' THEN 'Очная консультация' ELSE 'Видеоконсультация' END AS title,
      lc.status,
      date(lc.starts_at,'+5 hours') AS dueAt,
      lc.starts_at AS safeDueAt,
      cs.id AS caseId,
      cs.title AS caseTitle,
      cs.legal_area AS legalArea,
      'consultation' AS source,
      lc.starts_at AS startsAt,
      lc.ends_at AS endsAt,
      lc.format
     FROM lawyer_consultations lc
     JOIN cases cs ON cs.id=lc.case_id
     WHERE lc.client_user_id=? AND lc.status IN ('proposed','confirmed','in_progress')
       AND date(lc.starts_at,'+5 hours')>=? AND date(lc.starts_at,'+5 hours')<?
     ORDER BY lc.starts_at ASC`,
      )
      .bind(user.id, range.from, range.to)
      .all(),
  ]);
  const items = [...rows.results, ...consultations.results].sort(
    (left, right) => {
      const a =
        (left as { dueAt?: string; safeDueAt?: string }).safeDueAt ||
        (left as { dueAt?: string }).dueAt ||
        "";
      const b =
        (right as { dueAt?: string; safeDueAt?: string }).safeDueAt ||
        (right as { dueAt?: string }).dueAt ||
        "";
      return a.localeCompare(b);
    },
  );
  return response({
    from: range.from,
    to: range.to,
    serverToday: range.today,
    items,
  });
});
