/** Shared SQL predicate. Parameters: workspace, fixed role, current user.
 * A marketplace case keeps its original workspace and ID. Its firm extension
 * requires both the original active lawyer grant and explicit client/firm
 * linkage; neither a firm manager nor platform staff can bypass that grant. */
export function matterScopeFor(financial = false) {
  return `(
    $2 IN ('owner','admin','accountant')
    OR ($2 IN ('lawyer','assistant') AND EXISTS(SELECT 1 FROM practice_assignments a WHERE a.case_id=m.case_id AND a.user_id=$3))
    OR ($2='client' AND EXISTS(SELECT 1 FROM practice_contacts pc JOIN practice_invitations pi ON pi.workspace_id=pc.workspace_id AND pi.contact_id=pc.contact_id AND pi.accepted_by=pc.linked_user_id AND pi.confirmed_at IS NOT NULL AND pi.revoked_at IS NULL WHERE pc.workspace_id=m.workspace_id AND pc.contact_id=m.contact_id AND pc.linked_user_id=$3))
  ) AND EXISTS(SELECT 1 FROM cases original WHERE original.id=m.case_id AND (
    original.workspace_id=m.workspace_id OR (
      EXISTS(SELECT 1 FROM practice_contacts pc JOIN practice_invitations pi ON pi.workspace_id=pc.workspace_id AND pi.contact_id=pc.contact_id AND pi.accepted_by=original.owner_user_id AND pi.confirmed_at IS NOT NULL AND pi.revoked_at IS NULL
        WHERE pc.workspace_id=m.workspace_id AND pc.contact_id=m.contact_id AND pc.linked_user_id=original.owner_user_id)
      AND (${financial ? "true" : "$2='client'"} OR EXISTS(
        SELECT 1 FROM lawyer_access_grants g JOIN lawyer_requests r ON r.id=g.lawyer_request_id AND r.case_id=g.case_id
        JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id AND p.user_id=g.lawyer_user_id
        JOIN workspace_members member ON member.workspace_id=m.workspace_id AND member.user_id=g.lawyer_user_id AND member.status='active' AND member.role IN ('owner','admin','lawyer')
        WHERE g.case_id=m.case_id AND g.lawyer_user_id=m.responsible_user_id AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at::timestamptz>now()) AND r.workspace_id=original.workspace_id
          AND r.requester_user_id=original.owner_user_id AND p.status='public_approved' AND p.marketplace_status='public_approved'
      ))
    )
  ))`;
}
