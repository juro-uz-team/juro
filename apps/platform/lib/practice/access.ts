import type { PoolClient } from "pg";
import { database } from "../storage/connection";
import { entitlementsForSubscription } from "../billing/entitlements";
import { PracticeError, roles, type Actor, type Role } from "./domain";
import { matterScopeFor } from "./case-scope";

export async function transaction<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database().pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function practiceActor(
  client: PoolClient,
  userId: string,
  workspaceId: string,
  write = false,
): Promise<Actor> {
  if (process.env.PRACTICE_ENABLED !== "true")
    throw new PracticeError("MODULE_DISABLED", 503);
  // Enrollment and membership are read afresh, including every file and export.
  const config = (
    await client.query(
      `SELECT enabled,pilot_until,features FROM practice_workspaces
    WHERE workspace_id=$1 FOR SHARE`,
      [workspaceId],
    )
  ).rows[0];
  if (!config) throw new PracticeError("PILOT_INVITATION_REQUIRED", 403);
  const member = (
    await client.query(
      `SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND status='active' FOR SHARE`,
      [workspaceId, userId],
    )
  ).rows[0];
  let role: Actor["role"];
  if (member && roles.includes(member.role)) role = member.role as Role;
  else {
    const contact = (
      await client.query(
        `SELECT c.contact_id FROM practice_contacts c WHERE c.workspace_id=$1 AND c.linked_user_id=$2
      AND EXISTS(SELECT 1 FROM practice_invitations i WHERE i.workspace_id=c.workspace_id AND i.contact_id=c.contact_id
      AND i.accepted_by=$2 AND i.confirmed_at IS NOT NULL AND i.revoked_at IS NULL) LIMIT 1`,
        [workspaceId, userId],
      )
    ).rows[0];
    if (!contact) throw new PracticeError("ACCESS_DENIED", 403);
    role = "client";
  }
  const subscription =
    (
      await client.query(
        `SELECT plan_code AS "planCode",status,current_period_ends_at AS "currentPeriodEndsAt"
    FROM subscriptions WHERE workspace_id=$1 LIMIT 1`,
        [workspaceId],
      )
    ).rows[0] ?? null;
  const entitlement = entitlementsForSubscription(subscription);
  // Only an explicitly recorded staff grant admits a pilot without a paid plan.
  const paid =
    entitlement.planCode !== "free" && config.features.practice === true;
  const pilot =
    config.pilot_until && new Date(config.pilot_until).getTime() > Date.now();
  const writable = Boolean(config.enabled && (paid || pilot));
  if (write && !writable) throw new PracticeError("READ_ONLY", 403);
  return {
    userId,
    workspaceId,
    role,
    writable,
    planCode: entitlement.planCode,
  };
}

export async function requireCase(
  client: PoolClient,
  actor: Actor,
  caseId: string,
  kind: "legal" | "finance" = "legal",
) {
  if (
    (kind === "legal" && actor.role === "accountant") ||
    (kind === "finance" && actor.role === "assistant")
  )
    throw new PracticeError("ACCESS_DENIED", 403);
  const row = (
    await client.query(
      `SELECT m.*,c.title,c.description,c.status,c.legal_area,c.owner_user_id
    FROM practice_matters m JOIN cases c ON c.id=m.case_id
    WHERE m.workspace_id=$1 AND m.case_id=$4 AND ${matterScopeFor(kind === "finance")}`,
      [actor.workspaceId, actor.role, actor.userId, caseId],
    )
  ).rows[0];
  if (!row) throw new PracticeError("NOT_FOUND", 404);
  return row;
}

export async function memberAllowed(
  client: PoolClient,
  actor: Actor,
  userId: string,
) {
  const member = (
    await client.query(
      `SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND status='active'`,
      [actor.workspaceId, userId],
    )
  ).rows[0];
  if (
    !member ||
    !["owner", "admin", "lawyer", "assistant"].includes(member.role)
  )
    throw new PracticeError("MEMBER_UNAVAILABLE");
  return member as { role: Role };
}

export async function audit(
  client: PoolClient,
  actor: Actor,
  entity: string,
  entityId: string,
  action: string,
  metadata: object = {},
) {
  await client.query(
    `INSERT INTO workspace_audit_events(id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      crypto.randomUUID(),
      actor.workspaceId,
      actor.userId,
      entity,
      entityId,
      action,
      JSON.stringify(metadata),
      new Date().toISOString(),
    ],
  );
}

/** Existing tenant-wide APIs do not understand case assignments. Restrict these
 * surfaces for enrolled users; Practice's own handlers perform per-row checks.
 * This guard stays active when the module is disabled or a grant expires. */
export function legacyPracticeSensitivePath(pathname: string) {
  return (
    /^\/api\/(?:platform|document-builder)(?:\/|$)/.test(pathname) ||
    /^\/(?:ru|uz|en)\/(?:individual|entrepreneur|lawyer|business(?:\/ws_[a-z0-9]+)?)\/(?:cases|action-plan|documents|document-builder|ai-chat|calendar|contacts|consultations|history|archive|document-review|document-comparisons)(?:\/|$)/i.test(
      pathname,
    ) ||
    /^\/document-builder(?:\/|$)/.test(pathname)
  );
}
export async function legacyPracticeAccessDenied(
  userId: string,
  pathname: string,
): Promise<boolean> {
  if (!legacyPracticeSensitivePath(pathname)) return false;
  if (
    /^\/api\/platform\/(?:workspaces|team|profile|settings|billing|admin|subscriptions)(?:\/|$)/.test(
      pathname,
    )
  )
    return false;
  const installed = await database().pool.query(
    `SELECT to_regclass('app.practice_workspaces') AS name`,
  );
  if (!installed.rows[0].name) return false;
  const explicitWorkspace =
    /^\/(?:ru|uz|en)\/business\/(ws_[a-z0-9]+)\//i.exec(pathname)?.[1] ?? null;
  const exists = await database().pool.query(
    `SELECT 1 FROM user_profiles u
    JOIN practice_workspaces p ON p.workspace_id=coalesce($2,u.default_workspace_id)
    WHERE u.id=$1 LIMIT 1`,
    [userId, explicitWorkspace],
  );
  return exists.rowCount !== 0;
}

export async function notify(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  key: string,
  kind: string,
  entityId: string,
) {
  const id = crypto.randomUUID();
  const result = await client.query(
    `INSERT INTO practice_notifications(id,workspace_id,user_id,event_key,kind,entity_id)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,event_key) DO NOTHING RETURNING id`,
    [id, workspaceId, userId, key, kind, entityId],
  );
  if (result.rowCount)
    await client.query(
      `INSERT INTO notifications(id,workspace_id,user_id,type,title,body,created_at)
    SELECT $1,$2,id,'practice',CASE locale WHEN 'uz' THEN 'JURO Practice yangilanishi' WHEN 'en' THEN 'JURO Practice update' ELSE 'Обновление JURO Practice' END,
    CASE locale WHEN 'uz' THEN 'Tafsilotlarni himoyalangan makonda oching.' WHEN 'en' THEN 'Open your secure workspace for details.' ELSE 'Откройте защищённое пространство для подробностей.' END,$4
    FROM user_profiles WHERE id=$3`,
      [id, workspaceId, userId, new Date().toISOString()],
    );
}
