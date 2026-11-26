import { requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { documentVisibilityScope } from "../../../../lib/document-builder/permissions/document-visibility";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { workspaceForUser, workspaceForUserById } from "../../../../lib/platform/workspace";
import { isWorkspaceId } from "../../../../lib/platform/routing";
import { readWebsiteNotificationPreferences, websiteNotificationFilter } from "../../../../lib/platform/website-notifications";

function response(body: unknown) {
  return Response.json(body, { headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser(request);
  const db = requireD1();
  const requestedWorkspaceId = request.headers.get("x-juro-workspace-id");
  const workspace = requestedWorkspaceId
    ? (isWorkspaceId(requestedWorkspaceId)
      ? await workspaceForUserById(user.id, requestedWorkspaceId)
      : null)
    : await workspaceForUser(user);
  if (!workspace) {
    return Response.json(
      { code: "WORKSPACE_UNAVAILABLE" },
      { status: 404, headers: { "cache-control": "private, no-store", pragma: "no-cache" } },
    );
  }
  const documentVisibility = documentVisibilityScope(user.id, workspace.id);
  const notificationFilter = websiteNotificationFilter(await readWebsiteNotificationPreferences(db, user.id, workspace.id));
  const [counts, cases, documents, deadlines, consultations, notifications, analyses, comparisons] = await db.batch([
    db.prepare(
      `SELECT
        (SELECT count(*) FROM cases WHERE workspace_id = ? AND case_visible_to(id,?) AND archived_at IS NULL) AS activeCases,
        (SELECT count(*) FROM documents d WHERE ${documentVisibility.sql} AND d.archived_at IS NULL) AS documents,
        (SELECT count(*) FROM consultation_bookings WHERE workspace_id = ? AND status NOT IN ('completed','cancelled')) AS consultations,
        (SELECT count(*) FROM notifications WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL AND ${notificationFilter.sql}) AS unreadNotifications`,
    ).bind(workspace.id, user.id, ...documentVisibility.bindings, workspace.id, user.id, workspace.id, ...notificationFilter.bindings),
    db.prepare(
      `SELECT c.id,c.title,c.status,c.updated_at AS updatedAt,p.progress_percent AS progressPercent
       FROM cases c LEFT JOIN action_plans p ON p.case_id=c.id
       WHERE c.workspace_id=? AND case_visible_to(c.id,?) AND c.archived_at IS NULL ORDER BY c.updated_at DESC LIMIT 4`,
    ).bind(workspace.id, user.id),
    db.prepare(
      `SELECT d.id,d.title,d.status,d.category,d.updated_at AS updatedAt
       FROM documents d
       WHERE ${documentVisibility.sql} AND d.archived_at IS NULL
       ORDER BY d.updated_at DESC LIMIT 4`,
    ).bind(...documentVisibility.bindings),
    db.prepare(
      `SELECT s.id,s.title,s.due_at AS dueAt,c.id AS caseId,c.title AS caseTitle
       FROM action_plan_steps s
       JOIN action_plans p ON p.id=s.plan_id JOIN cases c ON c.id=p.case_id
       WHERE c.workspace_id=? AND case_visible_to(c.id,?) AND c.archived_at IS NULL AND s.due_at IS NOT NULL
         AND s.status NOT IN ('completed','cancelled')
       ORDER BY s.due_at LIMIT 5`,
    ).bind(workspace.id, user.id),
    db.prepare(
      `SELECT b.id,b.status,s.starts_at AS startsAt,s.specialist_type AS specialistType
       FROM consultation_bookings b JOIN consultation_slots s ON s.id=b.slot_id
       WHERE b.workspace_id=? ORDER BY s.starts_at DESC LIMIT 3`,
    ).bind(workspace.id),
    db.prepare(
      `SELECT id,title,body,created_at AS createdAt FROM notifications
       WHERE user_id=? AND workspace_id=? AND ${notificationFilter.sql} ORDER BY created_at DESC LIMIT 4`,
    ).bind(user.id, workspace.id, ...notificationFilter.bindings),
    db.prepare(
      `SELECT a.id,a.status,a.error_code AS errorCode,a.updated_at AS updatedAt,f.file_name AS fileName
       FROM document_analyses a JOIN document_files f ON f.id=a.uploaded_file_id
       WHERE a.workspace_id=? AND a.owner_user_id=? AND a.status!='completed'
       ORDER BY a.updated_at DESC LIMIT 4`,
    ).bind(workspace.id, user.id),
    db.prepare(
      `SELECT c.id,c.status,c.stage,c.error_code AS errorCode,c.updated_at AS updatedAt,
        one.file_name AS versionOneName,two.file_name AS versionTwoName
       FROM document_comparisons c
       JOIN document_files one ON one.id=c.version_one_file_id
       JOIN document_files two ON two.id=c.version_two_file_id
       WHERE c.workspace_id=? AND c.owner_user_id=? AND c.deleted_at IS NULL
         AND c.status NOT IN ('completed','completed_partial')
       ORDER BY c.updated_at DESC LIMIT 4`,
    ).bind(workspace.id, user.id),
  ]);
  return response({
    serverNow: new Date().toISOString(),
    counts: counts.results[0] ?? { activeCases: 0, documents: 0, consultations: 0, unreadNotifications: 0 },
    cases: cases.results,
    documents: documents.results,
    deadlines: deadlines.results,
    consultations: consultations.results,
    notifications: notifications.results,
    analyses: analyses.results,
    comparisons: comparisons.results,
  });
});
