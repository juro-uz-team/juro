import { validAdminOrigin } from "./admin-origin";
import { randomToken, sha256 } from "./crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ADMIN_SESSION_TTL_MS = 15 * 60 * 1_000;
const FRESH_MFA_WINDOW_MS = 15 * 60 * 1_000;

export type AdminDomainEnvironment = "development" | "staging" | "production";
export type AdminDomainRole = "super_admin" | "lawyer_moderator";
export type AdminDomainPrincipal = {
  sessionId: string;
  userId: string;
  sourceSessionId: string;
  sourceMfaVerifiedAt: string;
  roles: AdminDomainRole[];
  expiresAt: string;
};

export class AdminDomainSessionError extends Error {
  constructor(
    public readonly code: "SESSION_DENIED" | "TICKET_DENIED" | "TICKET_WRITE_FAILED",
  ) {
    super(code);
    this.name = "AdminDomainSessionError";
  }
}

function validEnvironment(value: unknown): value is AdminDomainEnvironment {
  return value === "development" || value === "staging" || value === "production";
}

function iso(now: Date): string {
  const value = now.toISOString();
  if (!Number.isFinite(Date.parse(value))) throw new AdminDomainSessionError("SESSION_DENIED");
  return value;
}

function rolesFromAssignments(rows: Array<{ role: string }>): AdminDomainRole[] {
  const roles = new Set<AdminDomainRole>();
  for (const row of rows) {
    if (row.role === "administrator") roles.add("super_admin");
    if (row.role === "legal_reviewer") roles.add("lawyer_moderator");
  }
  return [...roles];
}

async function currentRoles(
  db: D1Database,
  input: { userId: string; sourceSessionId: string; now: Date },
): Promise<AdminDomainRole[]> {
  const nowIso = iso(input.now);
  const freshSince = new Date(input.now.getTime() - FRESH_MFA_WINDOW_MS).toISOString();
  const rows = await db.prepare(
    `SELECT DISTINCT assignment.role
     FROM platform_staff_assignments assignment
     JOIN auth_sessions source
       ON source.id=? AND source.user_id=assignment.user_id
     LEFT JOIN auth_devices device ON device.id=source.device_id
     WHERE assignment.user_id=?
       AND assignment.role IN ('administrator','legal_reviewer')
       AND assignment.revoked_at IS NULL
       AND assignment.granted_at<=? AND assignment.expires_at>?
       AND source.revoked_at IS NULL
       AND source.assurance_level='mfa'
       AND source.mfa_verified_at IS NOT NULL
       AND source.mfa_verified_at>=? AND source.mfa_verified_at<=?
       AND source.expires_at>? AND coalesce(source.idle_expires_at,source.expires_at)>?
       AND (source.device_id IS NULL OR (device.id IS NOT NULL AND device.revoked_at IS NULL))
       AND EXISTS (
         SELECT 1 FROM auth_totp_credentials credential
         WHERE credential.user_id=assignment.user_id
           AND credential.status='active' AND credential.verified_at IS NOT NULL
           AND credential.verified_at<=? AND credential.disabled_at IS NULL
       )`,
  ).bind(
    input.sourceSessionId,
    input.userId,
    nowIso,
    nowIso,
    freshSince,
    nowIso,
    nowIso,
    nowIso,
    nowIso,
  ).all<{ role: string }>();
  return rolesFromAssignments(rows.results);
}

function ticketToken(value: unknown): string | null {
  return typeof value === "string" && TOKEN_PATTERN.test(value) ? value : null;
}

export async function consumeAdminDomainHandoff(
  db: D1Database,
  input: {
    ticket: unknown;
    environment: unknown;
    destinationOrigin: string;
    now?: Date;
  },
): Promise<{ token: string; csrfToken: string; expiresAt: string; roles: AdminDomainRole[] }> {
  const ticket = ticketToken(input.ticket);
  if (!ticket || !validEnvironment(input.environment)) {
    throw new AdminDomainSessionError("TICKET_DENIED");
  }
  const destination = new URL(input.destinationOrigin);
  if (destination.origin !== input.destinationOrigin || !validAdminOrigin(destination, input.environment)) {
    throw new AdminDomainSessionError("TICKET_DENIED");
  }
  const now = input.now ?? new Date();
  const nowIso = iso(now);
  const hash = await sha256(ticket);
  const row = await db.prepare(
    `SELECT id,staff_user_id AS userId,source_session_id AS sourceSessionId,
       source_mfa_verified_at AS sourceMfaVerifiedAt
     FROM admin_handoff_tickets
     WHERE token_hash=? AND environment=? AND destination_origin=?
       AND redeemed_at IS NULL AND expires_at>? LIMIT 1`,
  ).bind(hash, input.environment, destination.origin, nowIso).first<{
    id: string;
    userId: string;
    sourceSessionId: string;
    sourceMfaVerifiedAt: string;
  }>();
  if (!row) throw new AdminDomainSessionError("TICKET_DENIED");
  const roles = await currentRoles(db, { userId: row.userId, sourceSessionId: row.sourceSessionId, now });
  if (!roles.length) throw new AdminDomainSessionError("TICKET_DENIED");

  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_MS).toISOString();
  const ticketClaim = await db.prepare(
    `UPDATE admin_handoff_tickets
     SET redeemed_at=?,redeemed_admin_session_id=?
     WHERE id=? AND redeemed_at IS NULL AND expires_at>?`,
  ).bind(nowIso, sessionId, row.id, nowIso).run();
  if (Number(ticketClaim.meta.changes ?? 0) !== 1) {
    throw new AdminDomainSessionError("TICKET_DENIED");
  }
  const writes = await db.batch([
    db.prepare(
      `INSERT INTO admin_domain_sessions (
         id,environment,staff_user_id,source_session_id,token_hash,
         source_mfa_verified_at,expires_at,last_seen_at,created_at
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(
      sessionId,
      input.environment,
      row.userId,
      row.sourceSessionId,
      await sha256(token),
      row.sourceMfaVerifiedAt,
      expiresAt,
      nowIso,
      nowIso,
    ),
    db.prepare(
      `INSERT INTO admin_domain_audit_events (
         id,environment,admin_session_id,actor_user_id,action,entity_type,
         entity_id,metadata_json,created_at
       ) VALUES (?,?,?,?,?,'admin_handoff_ticket',?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      input.environment,
      sessionId,
      row.userId,
      "handoff_consumed",
      row.id,
      JSON.stringify({ roles, sourceSessionId: row.sourceSessionId }),
      nowIso,
    ),
  ]);
  if (Number(writes[0]?.meta.changes ?? 0) !== 1 || Number(writes[1]?.meta.changes ?? 0) !== 1) {
    throw new AdminDomainSessionError("TICKET_WRITE_FAILED");
  }
  return { token, csrfToken, expiresAt, roles };
}

export async function requireAdminDomainSession(
  db: D1Database,
  input: { token: unknown; environment: unknown; now?: Date },
): Promise<AdminDomainPrincipal> {
  const token = ticketToken(input.token);
  if (!token || !validEnvironment(input.environment)) {
    throw new AdminDomainSessionError("SESSION_DENIED");
  }
  const now = input.now ?? new Date();
  const nowIso = iso(now);
  const row = await db.prepare(
    `SELECT id,staff_user_id AS userId,source_session_id AS sourceSessionId,
       source_mfa_verified_at AS sourceMfaVerifiedAt,expires_at AS expiresAt
     FROM admin_domain_sessions
     WHERE token_hash=? AND environment=? AND revoked_at IS NULL AND expires_at>?
     LIMIT 1`,
  ).bind(await sha256(token), input.environment, nowIso).first<{
    id: string;
    userId: string;
    sourceSessionId: string;
    sourceMfaVerifiedAt: string;
    expiresAt: string;
  }>();
  if (!row) throw new AdminDomainSessionError("SESSION_DENIED");
  const roles = await currentRoles(db, { userId: row.userId, sourceSessionId: row.sourceSessionId, now });
  if (!roles.length) throw new AdminDomainSessionError("SESSION_DENIED");
  const touched = await db.prepare(
    `UPDATE admin_domain_sessions SET last_seen_at=?
     WHERE id=? AND revoked_at IS NULL AND expires_at>?`,
  ).bind(nowIso, row.id, nowIso).run();
  if (Number(touched.meta.changes ?? 0) !== 1) throw new AdminDomainSessionError("SESSION_DENIED");
  return {
    sessionId: row.id,
    userId: row.userId,
    sourceSessionId: row.sourceSessionId,
    sourceMfaVerifiedAt: row.sourceMfaVerifiedAt,
    roles,
    expiresAt: row.expiresAt,
  };
}

/**
 * Revoke the independent admin-domain session server-side before the browser
 * clears its cookie. This deliberately does not affect the originating app
 * session; a staff member may continue using the ordinary platform surface.
 */
export async function revokeAdminDomainSession(
  db: D1Database,
  input: { token: unknown; environment: unknown; now?: Date },
): Promise<void> {
  const principal = await requireAdminDomainSession(db, input);
  const now = input.now ?? new Date();
  const nowIso = iso(now);
  const revoked = await db.prepare(
    `UPDATE admin_domain_sessions SET revoked_at=?,last_seen_at=?
     WHERE id=? AND revoked_at IS NULL AND expires_at>?`,
  ).bind(nowIso, nowIso, principal.sessionId, nowIso).run();
  if (Number(revoked.meta.changes ?? 0) !== 1) {
    throw new AdminDomainSessionError("SESSION_DENIED");
  }
  await appendAdminDomainAudit(db, {
    environment: input.environment as AdminDomainEnvironment,
    principal,
    action: "admin_session_revoked",
    metadata: {},
    now,
  });
}

export function adminRoleAllows(
  roles: readonly AdminDomainRole[],
  capability: "dashboard.view" | "lawyer.profiles.moderate" | "lawyer.profiles.block" | "lawyer.reviews.moderate" | "legal.corpus.manage",
): boolean {
  return roles.includes("super_admin") || (
    (capability === "lawyer.profiles.moderate" || capability === "lawyer.reviews.moderate")
      && roles.includes("lawyer_moderator")
  );
}

export async function appendAdminDomainAudit(
  db: D1Database,
  input: {
    environment: AdminDomainEnvironment;
    principal: AdminDomainPrincipal;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata: Record<string, unknown>;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const written = await db.prepare(
    `INSERT INTO admin_domain_audit_events (
       id,environment,admin_session_id,actor_user_id,action,entity_type,
       entity_id,metadata_json,created_at
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    input.environment,
    input.principal.sessionId,
    input.principal.userId,
    input.action,
    input.entityType ?? null,
    input.entityId ?? null,
    JSON.stringify(input.metadata),
    iso(now),
  ).run();
  if (Number(written.meta.changes ?? 0) !== 1) {
    throw new AdminDomainSessionError("SESSION_DENIED");
  }
}
