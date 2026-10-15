import { z } from "zod";
import type { PlatformLocale } from "./routing";

export const workspaceInvitationAcceptInputSchema = z.object({
  token: z.string().min(1).max(256),
  locale: z.enum(["ru", "uz", "en"]).default("ru"),
}).strict();

export type WorkspaceInvitationLocale = PlatformLocale;

export type WorkspaceInvitationRecord = {
  id: string;
  workspaceId: string;
  workspaceType: string;
  role: string;
  emailHash: string;
  emailLookupHash: string | null;
  emailLookupKeyVersion: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export async function workspaceInvitationByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<WorkspaceInvitationRecord | null> {
  return db.prepare(
    `SELECT i.id,i.workspace_id AS workspaceId,w.type AS workspaceType,i.role,
      i.email_hash AS emailHash,i.email_lookup_hash AS emailLookupHash,
      i.email_lookup_key_version AS emailLookupKeyVersion,
      i.expires_at AS expiresAt,i.accepted_at AS acceptedAt,
      i.revoked_at AS revokedAt
     FROM workspace_invitations i
     JOIN workspaces w ON w.id=i.workspace_id
     WHERE i.token_hash=? LIMIT 1`,
  ).bind(tokenHash).first<WorkspaceInvitationRecord>();
}

export async function acceptWorkspaceInvitation(
  db: D1Database,
  input: {
    invitationId: string;
    tokenHash: string;
    expectedEmailHash: string;
    expectedEmailLookupHash: string | null;
    expectedEmailLookupKeyVersion: string | null;
    userId: string;
    now: string;
  },
): Promise<boolean> {
  const { withPracticeSeat } = await import("../practice/limits");
  return withPracticeSeat(input.invitationId, input.userId, () => acceptWorkspaceInvitationRecord(db, input));
}

async function acceptWorkspaceInvitationRecord(
  db: D1Database,
  input: {
    invitationId: string; tokenHash: string; expectedEmailHash: string;
    expectedEmailLookupHash: string | null; expectedEmailLookupKeyVersion: string | null;
    userId: string; now: string;
  },
): Promise<boolean> {
  const claimId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const auditEventId = `workspace-invitation:${input.invitationId}:accepted`;
  const results = await db.batch([
    db.prepare(
      `UPDATE workspace_invitations
       SET accepted_at=?,acceptance_claim_id=?,updated_at=?
       WHERE id=?
         AND token_hash=?
         AND email_hash=?
         AND email_lookup_hash IS ?
         AND email_lookup_key_version IS ?
         AND accepted_at IS NULL
         AND acceptance_claim_id IS NULL
         AND revoked_at IS NULL
         AND expires_at>?
       RETURNING id`,
    ).bind(
      input.now,
      claimId,
      input.now,
      input.invitationId,
      input.tokenHash,
      input.expectedEmailHash,
      input.expectedEmailLookupHash,
      input.expectedEmailLookupKeyVersion,
      input.now,
    ),
    db.prepare(
      `INSERT INTO workspace_members
       (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
       SELECT ?,i.workspace_id,?,i.role,'active',?,?,?
       FROM workspace_invitations i
       WHERE i.id=? AND i.acceptance_claim_id=?
       ON CONFLICT(workspace_id,user_id) DO UPDATE SET
         role=CASE
           WHEN workspace_members.role='owner' THEN workspace_members.role
           ELSE excluded.role
         END,
         status='active',
         updated_at=excluded.updated_at`,
    ).bind(
      membershipId,
      input.userId,
      input.now,
      input.now,
      input.now,
      input.invitationId,
      claimId,
    ),
    db.prepare(
      `UPDATE user_profiles
       SET default_workspace_id=(
         SELECT workspace_id FROM workspace_invitations
         WHERE id=? AND acceptance_claim_id=?
       ),updated_at=?
       WHERE id=?
         AND EXISTS (
           SELECT 1 FROM workspace_invitations
           WHERE id=? AND acceptance_claim_id=?
         )`,
    ).bind(
      input.invitationId,
      claimId,
      input.now,
      input.userId,
      input.invitationId,
      claimId,
    ),
    db.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,
        metadata_json,created_at)
       SELECT ?,i.workspace_id,?,'invitation',i.id,'invitation_accepted',
         json_object(
           'invitedRole',i.role,
           'effectiveRole',(
             SELECT m.role FROM workspace_members m
             WHERE m.workspace_id=i.workspace_id AND m.user_id=?
           )
         ),?
       FROM workspace_invitations i
       WHERE i.id=? AND i.acceptance_claim_id=?`,
    ).bind(
      auditEventId,
      input.userId,
      input.userId,
      input.now,
      input.invitationId,
      claimId,
    ),
  ]);
  return (results[0]?.results.length ?? 0) === 1;
}

export function workspaceInvitationRedirect(
  locale: WorkspaceInvitationLocale,
  workspaceType: string,
  workspaceId: string,
): string {
  if (workspaceType === "business") {
    return `/${locale}/business/${encodeURIComponent(workspaceId)}/dashboard`;
  }
  return `/${locale}/individual/dashboard`;
}
