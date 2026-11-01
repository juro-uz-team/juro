import { requireApiUser } from "../document-builder/auth/api";
import { requireD1 } from "../document-builder/storage/runtime";
import { workspaceForUser, workspaceForUserById } from "../platform/workspace";
import { isWorkspaceId } from "../platform/routing";
import { withinSignal } from "./lifetime";

/** Account/session verification stays in shared infrastructure; requested workspace selection never falls back. */
export async function authenticateSignedAnswer(request: Request, signal: AbortSignal) {
  const user = await withinSignal(signal, () => requireApiUser(request));
  const selected = request.headers.get("x-juro-workspace-id");
  if (selected !== null && !isWorkspaceId(selected)) throw new Error("WORKSPACE_ACCESS_DENIED");
  const workspace = await withinSignal(signal, () => selected === null ? workspaceForUser(user)
    : workspaceForUserById(user.id, selected, { activate: false }));
  if (!workspace) throw new Error("WORKSPACE_ACCESS_DENIED");
  signal.throwIfAborted();
  return { db: requireD1(), workspaceId: workspace.id, userId: user.id };
}

/** Compatibility boundary for retained saved-content actions. */
export async function optionalSignedAnswerOwner(request: Request) {
  try { return await authenticateSignedAnswer(request, AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])); }
  catch (error) {
    if (error instanceof Error && error.message === "WORKSPACE_ACCESS_DENIED") return null;
    throw error;
  }
}
