import { requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

export const GET = withApiErrors(async function GET() {
  const user = await requireApiUser();
  const db = requireD1();
  const account = await db.prepare(
    "SELECT account_type AS accountType FROM user_profiles WHERE id=? LIMIT 1",
  ).bind(user.id).first<{ accountType: string }>();
  if (account?.accountType !== "lawyer") {
    return response({ code: "LAWYER_ACCOUNT_REQUIRED" }, 403);
  }
  const profile = await db.prepare(
    `SELECT id,display_name AS displayName,status,marketplace_status AS marketplaceStatus,
      availability_status AS availabilityStatus,next_available_at AS nextAvailableAt,
      profile_revision AS profileRevision
     FROM lawyer_profiles WHERE user_id=? LIMIT 1`,
  ).bind(user.id).first<{
    id: string;
    displayName: string;
    status: string;
    marketplaceStatus: string;
    availabilityStatus: string;
    nextAvailableAt: string | null;
    profileRevision: number;
  }>();
  if (!profile) return response({ profile: null, operational: false, unreadMessageCount: 0, requests: [], matters: [], messages: [], documents: [], ownDocuments: [], tasks: [], taskComments: [], consultations: [], caseEvents: [] });

  const operational = profile.status === "public_approved" && profile.marketplaceStatus === "public_approved";
  if (!operational) return response({ profile, operational, unreadMessageCount: 0, requests: [], matters: [], messages: [], documents: [], ownDocuments: [], tasks: [], taskComments: [], consultations: [], caseEvents: [] });
  const now = new Date().toISOString();
  const [requests, matters, messages, unreadMessages, documents, tasks, taskComments, ownDocuments, consultations, caseEvents] = await Promise.all([
    db.prepare(
      `SELECT r.id,r.status,r.anonymized_summary AS anonymizedSummary,r.created_at AS createdAt,r.updated_at AS updatedAt,
        CASE WHEN g.id IS NOT NULL THEN cs.id END AS caseId,
        CASE WHEN g.id IS NOT NULL THEN cs.title END AS caseTitle,
        CASE WHEN g.id IS NOT NULL THEN cs.legal_area END AS legalArea,
        CASE WHEN g.id IS NOT NULL THEN u.full_name END AS clientName,
        CASE WHEN g.id IS NOT NULL THEN 1 ELSE 0 END AS hasAccess
       FROM lawyer_requests r
       LEFT JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.lawyer_user_id=?
         AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       LEFT JOIN cases cs ON cs.id=g.case_id
       LEFT JOIN user_profiles u ON u.id=r.requester_user_id
       WHERE r.lawyer_profile_id=? ORDER BY r.updated_at DESC LIMIT 100`,
    ).bind(user.id, now, profile.id).all(),
    db.prepare(
      `SELECT DISTINCT cs.id,cs.title,cs.description,cs.status,cs.legal_area AS legalArea,
        cs.next_deadline_at AS nextDeadlineAt,cs.updated_at AS updatedAt,
        u.full_name AS clientName,r.id AS requestId
       FROM lawyer_access_grants g
       JOIN lawyer_requests r ON r.id=g.lawyer_request_id AND r.lawyer_profile_id=?
       JOIN cases cs ON cs.id=g.case_id
       JOIN user_profiles u ON u.id=r.requester_user_id
       WHERE g.lawyer_user_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       ORDER BY cs.updated_at DESC LIMIT 100`,
    ).bind(profile.id, user.id, now).all(),
    db.prepare(
      `SELECT m.id,m.lawyer_request_id AS requestId,m.author_role AS authorRole,m.body,
        m.read_at AS readAt,m.created_at AS createdAt,a.document_id AS documentId,
        d.title AS documentTitle,a.status AS attachmentStatus
       FROM lawyer_request_messages m
       JOIN lawyer_requests r ON r.id=m.lawyer_request_id AND r.lawyer_profile_id=?
       JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.lawyer_user_id=?
         AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       LEFT JOIN lawyer_request_message_attachments a ON a.message_id=m.id
       LEFT JOIN documents d ON d.id=a.document_id
       ORDER BY m.created_at DESC LIMIT 50`,
    ).bind(profile.id, user.id, now).all(),
    db.prepare(
      `SELECT count(*) AS count FROM lawyer_request_messages m
       JOIN lawyer_requests r ON r.id=m.lawyer_request_id AND r.lawyer_profile_id=?
       JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.lawyer_user_id=?
         AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       WHERE m.author_user_id<>? AND m.read_at IS NULL`,
    ).bind(profile.id, user.id, now, user.id).first<{ count: number }>(),
    db.prepare(
      `SELECT DISTINCT d.id,d.title,d.category,d.status,d.updated_at AS updatedAt,d.case_id AS caseId,r.id AS requestId
       FROM documents d JOIN lawyer_access_grants g ON g.case_id=d.case_id
       JOIN lawyer_requests r ON r.id=g.lawyer_request_id AND r.lawyer_profile_id=?
         AND r.case_id=d.case_id AND r.workspace_id=d.workspace_id AND r.requester_user_id=d.owner_user_id
       WHERE g.lawyer_user_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       ORDER BY d.updated_at DESC LIMIT 100`,
    ).bind(profile.id, user.id, now).all(),
    db.prepare(
      `SELECT DISTINCT t.id,t.title,t.description,t.status,t.due_at AS dueAt,t.case_id AS caseId,
        t.updated_at AS updatedAt,r.id AS requestId,COALESCE(t.due_at,t.updated_at) AS sortAt,
        CASE WHEN t.owner_user_id=? AND t.plan_step_id IS NULL THEN 1 ELSE 0 END AS isEditable
       FROM tasks t JOIN lawyer_access_grants g ON g.case_id=t.case_id
       JOIN lawyer_requests r ON r.id=g.lawyer_request_id AND r.lawyer_profile_id=?
       WHERE g.lawyer_user_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       ORDER BY sortAt ASC LIMIT 100`,
    ).bind(user.id, profile.id, user.id, now).all(),
    db.prepare(
      `SELECT DISTINCT c.id,c.task_id AS taskId,c.body,c.created_at AS createdAt,u.full_name AS authorName
       FROM lawyer_task_comments c
       JOIN tasks t ON t.id=c.task_id
       JOIN lawyer_access_grants g ON g.case_id=t.case_id
       JOIN lawyer_requests r ON r.id=g.lawyer_request_id AND r.lawyer_profile_id=?
       JOIN user_profiles u ON u.id=c.author_user_id
       WHERE g.lawyer_user_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       ORDER BY c.created_at ASC LIMIT 300`,
    ).bind(profile.id, user.id, now).all(),
    db.prepare(
      `SELECT d.id,d.title,d.category,d.status,d.updated_at AS updatedAt
       FROM documents d JOIN user_profiles u ON u.id=? AND u.default_workspace_id=d.workspace_id
       WHERE d.owner_user_id=? AND d.archived_at IS NULL
       ORDER BY d.updated_at DESC LIMIT 100`,
    ).bind(user.id, user.id).all(),
    db.prepare(
      `SELECT id,lawyer_request_id AS requestId,case_id AS caseId,starts_at AS startsAt,ends_at AS endsAt,
        timezone,format,status,internal_note AS internalNote,result_note AS resultNote
       FROM lawyer_consultations WHERE lawyer_profile_id=? ORDER BY starts_at ASC LIMIT 100`,
    ).bind(profile.id).all(),
    db.prepare(
      `SELECT DISTINCT e.id,e.case_id AS caseId,e.event_type AS eventType,e.created_at AS createdAt
       FROM case_events e JOIN lawyer_access_grants g ON g.case_id=e.case_id
       JOIN lawyer_requests r ON r.id=g.lawyer_request_id AND r.lawyer_profile_id=?
       WHERE g.lawyer_user_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
       ORDER BY e.created_at DESC LIMIT 300`,
    ).bind(profile.id, user.id, now).all(),
  ]);
  return response({
    profile,
    operational,
    unreadMessageCount: Number(unreadMessages?.count ?? 0),
    requests: requests.results,
    matters: matters.results,
    messages: messages.results,
    documents: documents.results,
    ownDocuments: ownDocuments.results,
    tasks: tasks.results,
    taskComments: taskComments.results,
    consultations: consultations.results,
    caseEvents: caseEvents.results,
  });
});
