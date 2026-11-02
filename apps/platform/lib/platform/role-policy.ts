export const workspaceRoles = ["owner", "admin", "lawyer", "employee", "viewer", "external", "assistant", "accountant"] as const;
export type WorkspaceRole = typeof workspaceRoles[number];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && workspaceRoles.includes(value as WorkspaceRole);
}

export function canManageTeam(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function canEditWorkspaceContent(role: string): boolean {
  return role === "owner" || role === "admin" || role === "lawyer" || role === "employee";
}
