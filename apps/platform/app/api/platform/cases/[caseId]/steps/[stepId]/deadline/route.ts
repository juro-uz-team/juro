import { parseJsonRequest } from "../../../../../../../../lib/auth/input";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../../../../../lib/document-builder/storage/runtime";
import {
  calculateDeadline,
  deadlineCalculationInputSchema,
} from "../../../../../../../../lib/platform/deadline-calculator";
import { workspaceForUser } from "../../../../../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

/** Returns a deterministic preview. Applying it remains a separate confirmed plan write. */
export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string; stepId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const { caseId, stepId } = await params;
  const parsed = await parseJsonRequest(request, deadlineCalculationInputSchema, 32_768);
  if (!parsed.ok) {
    return response({
      error: "Некорректные параметры расчёта срока.",
      code: parsed.error.toUpperCase(),
    }, parsed.error === "payload_too_large" ? 413 : 400);
  }

  const workspace = await workspaceForUser(user);
  const owned = await requireD1().prepare(
    "SELECT s.id FROM action_plan_steps s JOIN action_plans p ON p.id=s.plan_id JOIN cases c ON c.id=p.case_id WHERE s.id=? AND c.id=? AND c.workspace_id=? AND case_visible_to(c.id,?) AND c.archived_at IS NULL LIMIT 1",
  ).bind(stepId, caseId, workspace.id, user.id).first();
  if (!owned) {
    return response({ error: "Дело или шаг недоступны.", code: "CASE_STEP_UNAVAILABLE" }, 404);
  }

  return response({
    result: calculateDeadline(parsed.data),
    requiresConfirmation: true,
  });
});
