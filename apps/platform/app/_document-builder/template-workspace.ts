import { workspaceEntitlements } from "../../lib/billing/entitlements";
import { getOrCreateUserProfile } from "../../lib/document-builder/storage/db";
import { requireD1 } from "../../lib/document-builder/storage/runtime";
import { isAccountType, workspaceForAccountRoute, workspaceTypeForAccountType } from "../../lib/platform/routing";
import { requireSelectedWorkspace, workspacesForUser } from "../../lib/platform/workspace";
import type { ChatGPTUser } from "../chatgpt-auth";

export async function templateWorkspaceTerms(user: ChatGPTUser | null, workspaceId?: string, accountType?: string) {
  if (!user) return null;
  const profile = await getOrCreateUserProfile(user);
  const workspace = await requireSelectedWorkspace(profile, workspaceId);
  const active = !workspaceId && accountType && isAccountType(accountType) && workspace.type !== workspaceTypeForAccountType(accountType)
    ? workspaceForAccountRoute(workspace, await workspacesForUser(profile.id), accountType)
    : workspace;
  return workspaceEntitlements(requireD1(), active.id);
}
