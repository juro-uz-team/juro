import { z } from "zod";
import { parseJsonRequest } from "../../../../../../lib/auth/input";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { documentVisibilityScope } from "../../../../../../lib/document-builder/permissions/document-visibility";
import { parseJson } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { canManageTeam } from "../../../../../../lib/platform/permissions";
import { requireSelectedWorkspace, workspaceForContentEditor } from "../../../../../../lib/platform/workspace";
import { workspaceEntitlements } from "../../../../../../lib/billing/entitlements";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const user = await requireApiUser();
  const { caseId } = await params;
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  const owned = await db.prepare(
    "SELECT id,owner_user_id AS ownerUserId FROM cases WHERE id=? AND workspace_id=? AND case_visible_to(id,?) AND archived_at IS NULL LIMIT 1",
  ).bind(caseId, workspace.id, user.id).first<{ id: string; ownerUserId: string }>();
  if (!owned) return response({ error: "Дело недоступно.", code: "CASE_UNAVAILABLE" }, 404);
  const terms = await workspaceEntitlements(db, workspace.id);
  const documentVisibility = documentVisibilityScope(user.id, workspace.id);
  const eventDocumentId = "json_extract(CASE WHEN json_valid(e.metadata_json) THEN e.metadata_json ELSE '{}' END, '$.documentId')";

  const [documents, events, conversations, analyses, comparisons, sources, bookmarks, participants, lawyerRequests] = await db.batch([
    db.prepare(
      `SELECT d.id,d.title,d.status,d.language,d.plan_step_id AS planStepId,d.updated_at AS updatedAt
       FROM documents d
       WHERE ${documentVisibility.sql} AND d.case_id=? AND d.archived_at IS NULL
       ORDER BY d.updated_at DESC LIMIT 20`,
    ).bind(...documentVisibility.bindings, caseId),
    db.prepare(
      `SELECT e.event_type AS eventType,e.metadata_json AS metadataJson,e.created_at AS createdAt
       FROM case_events e
       WHERE e.case_id=?
         AND (${eventDocumentId} IS NULL OR EXISTS (
           SELECT 1 FROM documents d
           WHERE d.id=${eventDocumentId} AND ${documentVisibility.sql}
         ))
       ORDER BY e.created_at DESC LIMIT 50`,
    ).bind(caseId, ...documentVisibility.bindings),
    db.prepare(
      `SELECT id,title,status,locale,updated_at AS updatedAt
       FROM conversations
       WHERE workspace_id=? AND owner_user_id=? AND case_id=?
       ORDER BY updated_at DESC LIMIT 40`,
    ).bind(workspace.id, user.id, caseId),
    db.prepare(
      `SELECT a.id,a.status,a.error_code AS errorCode,a.updated_at AS updatedAt,
        f.file_name AS fileName,f.mime_type AS mimeType
       FROM document_analyses a
       JOIN document_files f ON f.id=a.uploaded_file_id
       WHERE a.workspace_id=? AND a.owner_user_id=? AND a.case_id=?
         AND f.workspace_id=? AND f.owner_user_id=? AND f.archived_at IS NULL
       ORDER BY a.updated_at DESC LIMIT 40`,
    ).bind(workspace.id, user.id, caseId, workspace.id, user.id),
    db.prepare(
      `SELECT id,status,stage,overall_risk AS overallRisk,error_code AS errorCode,updated_at AS updatedAt
       FROM document_comparisons
       WHERE workspace_id=? AND owner_user_id=? AND case_id=? AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 40`,
    ).bind(workspace.id, user.id, caseId),
    db.prepare(
      `SELECT id,actTitle,actIdentifier,officialUrl,status,locale,lastCheckedAt
       FROM (
         SELECT DISTINCT s.id,s.act_title AS actTitle,s.act_identifier AS actIdentifier,
           s.official_url AS officialUrl,s.status,s.locale,s.last_checked_at AS lastCheckedAt
         FROM conversation_sources cs
         JOIN conversations c ON c.id=cs.conversation_id
         JOIN legal_sources s ON s.id=cs.source_id
         WHERE c.workspace_id=? AND c.owner_user_id=? AND c.case_id=?
         UNION
         SELECT DISTINCT citation.id,citation.title AS actTitle,
           citation.act_identifier AS actIdentifier,citation.canonical_url AS officialUrl,
           citation.document_status AS status,citation.source_locale AS locale,
           citation.validated_at AS lastCheckedAt
         FROM legal_source_references citation
         JOIN conversations c ON c.id=citation.conversation_id
         WHERE c.workspace_id=? AND c.owner_user_id=? AND c.case_id=?
         UNION
         SELECT DISTINCT citation.id,citation.title AS actTitle,
           citation.act_identifier AS actIdentifier,citation.canonical_url AS officialUrl,
           citation.document_status AS status,citation.source_locale AS locale,
           citation.validated_at AS lastCheckedAt
         FROM legal_source_references citation
         JOIN conversations c ON c.id=citation.conversation_id
         JOIN case_events event ON event.case_id=?
         WHERE c.workspace_id=? AND c.owner_user_id=?
           AND event.event_type IN ('ai_action_plan_confirmed','ai_action_plan_appended')
           AND json_extract(event.metadata_json,'$.assistantMessageId')=citation.message_id
       )
       ORDER BY actTitle,id LIMIT 100`,
    ).bind(workspace.id, user.id, caseId, workspace.id, user.id, caseId, caseId, workspace.id, user.id),
    db.prepare(
      `SELECT bookmark.id AS bookmarkId,bookmark.source_id AS sourceId,
        bookmark.version_id AS versionId,bookmark.comment,bookmark.revision,
        bookmark.created_at AS createdAt,bookmark.updated_at AS updatedAt,
        source.act_title AS actTitle,source.act_identifier AS actIdentifier,
        source.official_url AS officialUrl,source.locale,
        source.last_checked_at AS lastCheckedAt,
        CASE WHEN activation.version_id=bookmark.version_id THEN 1 ELSE 0 END AS isCurrentVersion
       FROM user_legal_bookmarks bookmark
       JOIN legal_sources source ON source.id=bookmark.source_id
       JOIN legal_source_versions version
         ON version.id=bookmark.version_id AND version.source_id=source.id
       LEFT JOIN legal_source_current_activations activation ON activation.source_id=source.id
       WHERE bookmark.workspace_id=? AND bookmark.user_id=? AND bookmark.case_id=?
         AND bookmark.archived_at IS NULL
       ORDER BY bookmark.updated_at DESC LIMIT 100`,
    ).bind(workspace.id, user.id, caseId),
    db.prepare(
      `SELECT m.user_id AS userId,m.role,m.status,m.joined_at AS joinedAt,
        COALESCE(NULLIF(TRIM(p.full_name),''), CASE WHEN m.user_id=? THEN 'You' ELSE 'Workspace member' END) AS displayName
       FROM workspace_members m
       JOIN user_profiles p ON p.id=m.user_id
       WHERE m.workspace_id=? AND m.status='active' AND case_visible_to(?,m.user_id)
       ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.joined_at,m.user_id`,
    ).bind(user.id, workspace.id, caseId),
    db.prepare(
      `SELECT r.id,r.status,r.updated_at AS updatedAt,p.display_name AS lawyerName,
        g.id AS activeGrantId,g.created_at AS grantedAt,g.expires_at AS expiresAt
       FROM lawyer_requests r
       LEFT JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
       LEFT JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.revoked_at IS NULL
       WHERE r.workspace_id=? AND r.requester_user_id=? AND r.case_id=?
       ORDER BY r.updated_at DESC LIMIT 40`,
    ).bind(workspace.id, user.id, caseId),
  ]);
  return response({
    ownerUserId: owned.ownerUserId,
    canManageParticipants: workspace.type === "business" && !terms.readOnly && canManageTeam(workspace.role),
    canComment: workspace.type === "business" && terms.planCode === "company"
      && ["owner","admin","lawyer","employee"].includes(workspace.role),
    documents: documents.results,
    activity: events.results.map((event) => ({
      eventType: String((event as { eventType?: unknown }).eventType || "case_updated"),
      createdAt: String((event as { createdAt?: unknown }).createdAt || ""),
      metadata: parseJson(String((event as { metadataJson?: unknown }).metadataJson || "{}"), {}),
    })),
    conversations: conversations.results,
    comparisons: comparisons.results,
    analyses: analyses.results,
    sources: sources.results,
    bookmarks: bookmarks.results.map((bookmark) => {
      const row = bookmark as Record<string, unknown>;
      return { ...row, isCurrentVersion: Number(row.isCurrentVersion) === 1 };
    }),
    participants: participants.results.map((participant) => {
      const row = participant as Record<string, unknown>;
      return { ...row, currentUser: row.userId === user.id };
    }),
    lawyerRequests: lawyerRequests.results,
  });
});

export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  if (workspace.type !== "business" || (await workspaceEntitlements(db, workspace.id)).planCode !== "company") {
    return response({ code: "PLAN_LIMIT" }, 403);
  }
  const { caseId } = await params;
  const input = await parseJsonRequest(request, z.object({ comment: z.string().trim().min(1).max(2_000) }).strict(), 12_000);
  if (!input.ok) return response({ code: "INVALID_COMMENT" }, 400);
  const result = await db.prepare(`INSERT INTO case_events(id,case_id,actor_user_id,event_type,metadata_json,created_at)
    SELECT ?,id,?,'company_case_comment',?,? FROM cases
    WHERE id=? AND workspace_id=? AND archived_at IS NULL AND case_visible_to(id,?)`)
    .bind(crypto.randomUUID(),user.id,JSON.stringify({ comment: input.data.comment }),new Date().toISOString(),caseId,workspace.id,user.id).run();
  return result.meta.changes ? response({ ok: true }, 201) : response({ code: "CASE_UNAVAILABLE" }, 404);
});

const participantChange = z.object({ userId: z.string().min(1).max(240), assigned: z.boolean() }).strict();

export const PATCH = withApiErrors(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  if (workspace.type !== "business" || !canManageTeam(workspace.role)) return response({ code: "FORBIDDEN" }, 403);
  const { caseId } = await params;
  const input = await parseJsonRequest(request, participantChange, 1_024);
  if (!input.ok) return response({ code: "INVALID_PARTICIPANT" }, 400);
  const db = requireD1();
  const { userId, assigned } = input.data;
  if (user.id === userId) return response({ code: "INVALID_PARTICIPANT" }, 400);
  const member = await db.prepare(`SELECT m.id FROM workspace_members m JOIN cases c ON c.workspace_id=m.workspace_id
    WHERE c.id=? AND c.workspace_id=? AND m.user_id=? AND m.status='active'
      AND c.owner_user_id<>m.user_id AND case_visible_to(c.id,?)`)
    .bind(caseId, workspace.id, userId, user.id).first<{ id: string }>();
  if (!member) return response({ code: "CASE_PARTICIPANT_UNAVAILABLE" }, 404);
  const now = new Date().toISOString();
  const [changed] = await db.batch([
    assigned
      ? db.prepare(`INSERT INTO company_case_participants(case_id,member_id)
          SELECT ?,id FROM workspace_members WHERE id=? AND status='active'
          AND case_visible_to(?,?) ON CONFLICT DO NOTHING`).bind(caseId, member.id, caseId, user.id)
      : db.prepare(`DELETE FROM company_case_participants WHERE case_id=? AND member_id=?
          AND case_visible_to(?,?)`).bind(caseId, member.id, caseId, user.id),
    db.prepare(`INSERT INTO workspace_audit_events(id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
      SELECT ?,?,?,'case',?,?,?,? WHERE changes()=1`)
      .bind(crypto.randomUUID(), workspace.id, user.id, caseId, assigned ? "case_participant_assigned" : "case_participant_removed",
        JSON.stringify({ userId }), now),
  ]);
  return response({ changed: changed.meta.changes === 1 });
});
