import { parseJsonRequest } from "../../../../../lib/auth/input";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../../lib/document-builder/storage/runtime";
import {
  CaseLifecycleError,
  caseLifecycleIdempotencyKeySchema,
  caseLifecycleRequestSchema,
  executeCaseLifecycle,
} from "../../../../../lib/platform/case-lifecycle";
import { workspaceForContentEditor } from "../../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

function lifecycleError(error: CaseLifecycleError) {
  const status = error.code === "CASE_UNAVAILABLE" ? 404 : error.code === "CASE_LIFECYCLE_INVALID" ? 400 : 409;
  return response({ code: error.code, error: error.message }, status);
}

export const PATCH = withApiErrors(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const { caseId } = await params;
  const parsed = await parseJsonRequest(request, caseLifecycleRequestSchema, 1_024);
  if (!parsed.ok) return response({ code: "INVALID_CASE_LIFECYCLE_INPUT" }, parsed.error === "payload_too_large" ? 413 : 400);
  const idempotency = caseLifecycleIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key")?.trim() ?? "");
  if (!idempotency.success) return response({ code: "INVALID_IDEMPOTENCY_KEY" }, 400);
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  try {
    const result = await executeCaseLifecycle({
      db: requireD1(), caseId, workspaceId: workspace.id, actorUserId: user.id,
      action: parsed.data.action, idempotencyKey: idempotency.data,
    });
    return response({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CaseLifecycleError) return lifecycleError(error);
    throw error;
  }
});
