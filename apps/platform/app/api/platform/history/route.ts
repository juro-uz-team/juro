import { requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { documentVisibilityScope } from "../../../../lib/document-builder/permissions/document-visibility";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { canManageTeam } from "../../../../lib/platform/permissions";
import { workspaceForUser } from "../../../../lib/platform/workspace";

export const GET = withApiErrors(async function GET() {
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  const db = requireD1();
  const documentVisibility = documentVisibilityScope(user.id, workspace.id);
  const eventDocumentId = "json_extract(CASE WHEN json_valid(e.metadata_json) THEN e.metadata_json ELSE '{}' END, '$.documentId')";
  const auditDocumentId = "json_extract(CASE WHEN json_valid(audit_event.metadata_json) THEN audit_event.metadata_json ELSE '{}' END, '$.documentId')";
  const auditWhere = canManageTeam(workspace.role)
    ? "audit_event.workspace_id=?"
    : "audit_event.workspace_id=? AND audit_event.actor_user_id=?";
  const auditBinds = canManageTeam(workspace.role) ? [workspace.id] : [workspace.id, user.id];
  const [audit, documents, cases] = await db.batch([
    db.prepare(
      `SELECT audit_event.id,'workspace' AS source,audit_event.entity_type AS entityType,
        audit_event.entity_id AS entityId,audit_event.action,
        audit_event.metadata_json AS metadataJson,audit_event.actor_user_id AS actorUserId,
        audit_event.created_at AS createdAt
       FROM workspace_audit_events audit_event
       WHERE ${auditWhere}
         AND (
           audit_event.entity_type <> 'document'
           OR EXISTS (
             SELECT 1 FROM documents d
             WHERE d.id=audit_event.entity_id AND ${documentVisibility.sql}
           )
         )
         AND (
           NOT EXISTS (SELECT 1 FROM documents referenced_document WHERE referenced_document.id=audit_event.entity_id)
           OR EXISTS (
             SELECT 1 FROM documents d
             WHERE d.id=audit_event.entity_id AND ${documentVisibility.sql}
           )
         )
         AND (
           ${auditDocumentId} IS NULL
           OR EXISTS (
             SELECT 1 FROM documents d
             WHERE d.id=${auditDocumentId} AND ${documentVisibility.sql}
           )
         )
       ORDER BY audit_event.created_at DESC LIMIT 150`,
    ).bind(
      ...auditBinds,
      ...documentVisibility.bindings,
      ...documentVisibility.bindings,
      ...documentVisibility.bindings,
    ),
    db.prepare(
      `SELECT e.id,'document' AS source,'document' AS entityType,e.document_id AS entityId,e.type AS action,
        e.metadata_json AS metadataJson,e.actor_user_id AS actorUserId,e.created_at AS createdAt
       FROM activity_events e JOIN documents d ON d.id=e.document_id
       WHERE ${documentVisibility.sql}
       ORDER BY e.created_at DESC LIMIT 150`,
    ).bind(...documentVisibility.bindings),
    db.prepare(
      `SELECT e.id,'case' AS source,'case' AS entityType,e.case_id AS entityId,e.event_type AS action,
        e.metadata_json AS metadataJson,e.actor_user_id AS actorUserId,e.created_at AS createdAt
       FROM case_events e JOIN cases c ON c.id=e.case_id
       WHERE c.workspace_id=? AND case_visible_to(c.id,?)
         AND (${eventDocumentId} IS NULL OR EXISTS (
           SELECT 1 FROM documents d
           WHERE d.id=${eventDocumentId} AND ${documentVisibility.sql}
         ))
       ORDER BY e.created_at DESC LIMIT 150`,
    ).bind(workspace.id, user.id, ...documentVisibility.bindings),
  ]);
  const events = [...audit.results, ...documents.results, ...cases.results]
    .sort((left, right) => String((right as Record<string, unknown>).createdAt).localeCompare(String((left as Record<string, unknown>).createdAt)))
    .slice(0, 250);
  return Response.json({ events }, { headers: { "cache-control": "private, no-store" } });
});
