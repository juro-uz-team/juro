import { validAdminOrigin } from "./admin-origin";
import { randomToken, sha256 } from "./crypto";
import type { PlatformStaffAccess } from "./staff-access";

export const ADMIN_HANDOFF_TTL_MS = 2 * 60 * 1_000;

export type AdminHandoffEnvironment = "development" | "staging" | "production";

export type IssuedAdminHandoff = {
  ticket: string;
  expiresAt: string;
};

function environment(value: unknown): AdminHandoffEnvironment | null {
  return value === "development" || value === "staging" || value === "production"
    ? value
    : null;
}

/**
 * A ticket is deliberately distinct from both the app cookie and the later
 * admin cookie. The raw value is returned exactly once and only its SHA-256
 * is persisted. Consuming it is an atomic, one-use operation in the admin API.
 */
export async function issueAdminDomainHandoff(
  db: D1Database,
  input: {
    staff: PlatformStaffAccess;
    appEnvironment: unknown;
    destinationOrigin: string;
    now?: Date;
  },
): Promise<IssuedAdminHandoff> {
  const appEnvironment = environment(input.appEnvironment);
  const destination = new URL(input.destinationOrigin);
  if (
    !appEnvironment
    || !validAdminOrigin(destination, appEnvironment)
    || destination.username
    || destination.password
    || destination.pathname !== "/"
    || destination.search
    || destination.hash
  ) {
    throw new Error("ADMIN_HANDOFF_CONFIGURATION_INVALID");
  }

  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const mfaMs = Date.parse(input.staff.mfaVerifiedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(mfaMs) || mfaMs > nowMs) {
    throw new Error("ADMIN_HANDOFF_SESSION_INVALID");
  }

  const createdAt = now.toISOString();
  const expiresAt = new Date(nowMs + ADMIN_HANDOFF_TTL_MS).toISOString();
  const ticket = randomToken(32);
  const ticketHash = await sha256(ticket);
  const ticketId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO admin_handoff_tickets (
         id,environment,token_hash,staff_user_id,source_session_id,
         source_mfa_verified_at,destination_origin,expires_at,created_at
       ) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(
      ticketId,
      appEnvironment,
      ticketHash,
      input.staff.userId,
      input.staff.sessionId,
      input.staff.mfaVerifiedAt,
      destination.origin,
      expiresAt,
      createdAt,
    ),
    db.prepare(
      `INSERT INTO admin_domain_audit_events (
         id,environment,admin_session_id,actor_user_id,action,entity_type,
         entity_id,metadata_json,created_at
       ) VALUES (?,?,NULL,?,'handoff_issued','admin_handoff_ticket',?,?,?)`,
    ).bind(
      auditId,
      appEnvironment,
      input.staff.userId,
      ticketId,
      JSON.stringify({
        destinationOrigin: destination.origin,
        sourceSessionId: input.staff.sessionId,
        assurance: "mfa",
      }),
      createdAt,
    ),
  ]);
  if (
    Number(results[0]?.meta.changes ?? 0) !== 1
    || Number(results[1]?.meta.changes ?? 0) !== 1
  ) {
    throw new Error("ADMIN_HANDOFF_WRITE_FAILED");
  }

  return { ticket, expiresAt };
}
