export type DocumentVisibilityScope = {
  sql: string;
  bindings: string[];
};

/**
 * Query-time equivalent of the view boundary enforced by getDocumentAccess.
 * The caller must use the `d` alias for documents and apply this predicate
 * before COUNT, ORDER BY, or LIMIT so inaccessible metadata cannot influence
 * aggregates or pagination.
 */
export function documentVisibilityScope(
  userId: string,
  activeWorkspaceId: string,
  now = new Date().toISOString(),
): DocumentVisibilityScope {
  const safePermissionSet =
    "CASE WHEN json_valid(dc.permission_set_json) THEN dc.permission_set_json ELSE '[]' END";
  return {
    sql: `(
      d.workspace_id = ?
      AND (d.case_id IS NULL OR case_visible_to(d.case_id, ?))
      AND (
        d.owner_user_id = ?
        OR EXISTS (
          SELECT 1
          FROM document_collaborators dc
          WHERE dc.document_id = d.id
            AND dc.user_id = ?
            AND dc.invitation_status = 'accepted'
            AND dc.can_view = 1
            AND dc.status IN ('active', 'opened', 'confirmed')
            AND (
              dc.permission_set_json IS NULL
              OR json_array_length(${safePermissionSet}) = 0
              OR EXISTS (
                SELECT 1 FROM json_each(${safePermissionSet}) permission
                WHERE permission.value = 'view_document'
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM lawyer_request_message_attachments attachment
          JOIN lawyer_request_messages message
            ON message.id = attachment.message_id
            AND message.lawyer_request_id = attachment.lawyer_request_id
          JOIN lawyer_requests request ON request.id = attachment.lawyer_request_id
          JOIN lawyer_profiles profile ON profile.id = request.lawyer_profile_id
          LEFT JOIN lawyer_access_grants grant_row
            ON grant_row.lawyer_request_id = request.id
            AND grant_row.case_id = request.case_id
            AND grant_row.lawyer_user_id = profile.user_id
            AND grant_row.revoked_at IS NULL
            AND (grant_row.expires_at IS NULL OR grant_row.expires_at > ?)
          WHERE attachment.document_id = d.id
            AND attachment.recipient_user_id = ?
            AND attachment.id = (
              SELECT latest_attachment.id
              FROM lawyer_request_message_attachments latest_attachment
              WHERE latest_attachment.document_id = d.id
                AND latest_attachment.recipient_user_id = ?
              ORDER BY latest_attachment.created_at DESC, latest_attachment.id DESC
              LIMIT 1
            )
            AND (
              (
                request.requester_user_id = ?
                AND attachment.shared_by_user_id = profile.user_id
              )
              OR (
                profile.user_id = ?
                AND attachment.shared_by_user_id = request.requester_user_id
                AND grant_row.id IS NOT NULL
                AND profile.status = 'public_approved'
                AND profile.marketplace_status = 'public_approved'
              )
            )
        )
        OR (
          d.case_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM lawyer_access_grants grant_row
            JOIN lawyer_requests request
              ON request.id = grant_row.lawyer_request_id
              AND request.case_id = d.case_id
              AND request.workspace_id = d.workspace_id
              AND request.requester_user_id = d.owner_user_id
            JOIN lawyer_profiles profile
              ON profile.id = request.lawyer_profile_id
              AND profile.user_id = ?
              AND profile.status = 'public_approved'
              AND profile.marketplace_status = 'public_approved'
            WHERE grant_row.case_id = d.case_id
              AND grant_row.lawyer_user_id = ?
              AND grant_row.revoked_at IS NULL
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at > ?)
          )
        )
      )
    )`,
    bindings: [
      activeWorkspaceId,
      userId,
      userId,
      userId,
      now,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      now,
    ],
  };
}
