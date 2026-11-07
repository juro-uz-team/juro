import {ApiAuthError} from "../document-builder/auth/api";
import type { UserProfile } from "../document-builder/types";
import { requireD1 } from "../document-builder/storage/runtime";
import {
  resolveUserIdentity,
  USER_IDENTITY_SELECT,
  type UserIdentityRow,
} from "../auth/identity-protection";
import { runtimeIdentityProtection } from "../auth/identity-runtime";
import {
  workspaceForUserByIdInDatabase as workspaceForUserByIdInDatabaseInternal,
  type WorkspaceRouteOption,
  type WorkspaceRouteSource,
} from "./workspace-route-access";
import { requireWorkspaceContentEditor } from "./permissions";
import { isLocale } from "./routing";

export { workspaceForUserByIdInDatabase } from "./workspace-route-access";

type WorkspaceProfileRow = UserIdentityRow & {
  defaultWorkspaceId: string | null;
  accountType: string;
  locale: string;
  companyName: string | null;
  fullName: string | null;
};

export type WorkspaceOption = WorkspaceRouteOption;

export async function workspacesForUser(userId: string): Promise<WorkspaceOption[]> {
  const rows = await requireD1().prepare(
    `SELECT w.id,w.name,w.type,m.role
     FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
     WHERE m.user_id=? AND m.status='active'
     ORDER BY CASE w.type WHEN 'individual' THEN 0 ELSE 1 END,w.name`,
  ).bind(userId).all();
  return rows.results.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      type: row.type === "business" ? "business" : "individual",
      role: String(row.role),
    };
  });
}

export async function ensureDefaultWorkspace(userId: string): Promise<string> {
  const db = requireD1();
  const profile = await db.prepare(
    `SELECT id,${USER_IDENTITY_SELECT},
      default_workspace_id AS defaultWorkspaceId,
      account_type AS accountType,locale,
      company_name AS companyName,full_name AS fullName
     FROM user_profiles WHERE id = ? LIMIT 1`,
  ).bind(userId).first<WorkspaceProfileRow>();
  if (!profile) throw new Error("USER_PROFILE_NOT_FOUND");
  const identity = await resolveUserIdentity(
    runtimeIdentityProtection(),
    profile,
  );

  if (profile.defaultWorkspaceId) {
    const membership = await db.prepare(
      "SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
    ).bind(profile.defaultWorkspaceId, userId).first();
    if (membership) return profile.defaultWorkspaceId;
  }

  const existingMembership = await requireD1().prepare(
    `SELECT m.workspace_id AS workspaceId
     FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
     WHERE m.user_id=? AND m.status='active'
     ORDER BY m.joined_at DESC LIMIT 1`,
  ).bind(userId).first<{ workspaceId: string }>();
  if (existingMembership) {
    await requireD1().prepare(
      "UPDATE user_profiles SET default_workspace_id=?,updated_at=? WHERE id=?",
    ).bind(existingMembership.workspaceId, new Date().toISOString(), userId).run();
    return existingMembership.workspaceId;
  }

  const now = new Date().toISOString();
  // Never reuse an invalid default_workspace_id: it might identify a tenant
  // from which this user was removed.
  const workspaceId = `ws_${crypto.randomUUID().replaceAll("-", "")}`;
  const workspaceName = (
    profile.companyName
    || profile.fullName
    || identity.email
  ).slice(0, 180);
  const businessWorkspace = profile.accountType === "business";
  await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO workspaces (id,type,name,full_name,short_name,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ).bind(
      workspaceId,
      businessWorkspace ? "business" : "individual",
      workspaceName,
      businessWorkspace ? workspaceName : null,
      businessWorkspace ? workspaceName.slice(0, 80) : null,
      isLocale(profile.locale) ? profile.locale : "ru",
      now,
      now,
    ),
    db.prepare(
      "INSERT OR IGNORE INTO workspace_members (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?,?)",
    ).bind(crypto.randomUUID(), workspaceId, userId, now, now, now),
    db.prepare("UPDATE user_profiles SET default_workspace_id = ?, updated_at = ? WHERE id = ?")
      .bind(workspaceId, now, userId),
    db.prepare(
      "INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'workspace',?,'workspace_created',?,?)",
    ).bind(crypto.randomUUID(), workspaceId, userId, workspaceId, JSON.stringify({ source: "account_bootstrap" }), now),
  ]);
  return workspaceId;
}

export function workspaceForUserById(
  userId: string,
  workspaceId: string,
  options: { activate?: boolean; source?: WorkspaceRouteSource } = {},
): Promise<WorkspaceOption | null> {
  return workspaceForUserByIdInDatabaseInternal(
    requireD1(),
    userId,
    workspaceId,
    options,
  );
}

export async function workspaceForUser(user: UserProfile): Promise<WorkspaceOption> {
  const workspaceId = await ensureDefaultWorkspace(user.id);
  const membership = await requireD1().prepare(
    `SELECT m.role,w.name,w.type
     FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
     WHERE m.workspace_id=? AND m.user_id=? AND m.status='active' LIMIT 1`,
  ).bind(workspaceId, user.id).first<{ role: string; name: string; type: string }>();
  if (!membership) throw new Error("WORKSPACE_ACCESS_DENIED");
  return {
    id: workspaceId,
    role: membership.role,
    name: membership.name,
    type: membership.type === "business" ? "business" : "individual",
  };
}

export async function workspaceForContentEditor(user: UserProfile, selectedWorkspaceId?: string | null): Promise<WorkspaceOption> {
  const workspace = selectedWorkspaceId ? await workspaceForUserById(user.id, selectedWorkspaceId, {activate:false}) : await workspaceForUser(user);
  if (!workspace) throw new ApiAuthError("Workspace unavailable",403);
  requireWorkspaceContentEditor(workspace.role);
  return workspace;
}
