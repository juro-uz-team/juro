import {assertTemplatePlan} from "../../../../lib/control-center/template-access";
import { resolvedDocument } from "../../../../lib/document-builder/registry/published";
import { assertSafeWrite, requireApiUser } from "../../../../lib/document-builder/auth/api";
import { apiError, badRequest, jsonResponse } from "../../../../lib/document-builder/auth/responses";
import { getDocumentByCode } from "../../../../lib/document-builder/registry";
import { createConfiguredDocument } from "../../../../lib/document-builder/storage/configured-documents";
import { configuredDraftSchema } from "../../../../lib/document-builder/validation/schema";
import { workspaceForContentEditor } from "../../../../lib/platform/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const parsed = configuredDraftSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest("Не удалось проверить данные конструктора.", "INVALID_CONFIGURED_DRAFT");
    const definition = await resolvedDocument(parsed.data.templateCode);
    if (!definition || definition.status !== "published") return badRequest("Шаблон недоступен или ещё находится на проверке.", "TEMPLATE_UNAVAILABLE");
    await assertTemplatePlan(definition,user.id);
    if (parsed.data.caseId) {
      const { requireD1 } = await import("../../../../lib/document-builder/storage/runtime");
      const workspace = await workspaceForContentEditor(user);
      const owned = await requireD1().prepare("SELECT c.id FROM cases c LEFT JOIN action_plans p ON p.case_id=c.id LEFT JOIN action_plan_steps s ON s.plan_id=p.id AND s.id=? WHERE c.id=? AND c.workspace_id=? AND (? IS NULL OR s.id IS NOT NULL) LIMIT 1")
        .bind(parsed.data.planStepId ?? null, parsed.data.caseId, workspace.id, parsed.data.planStepId ?? null).first();
      if (!owned) return badRequest("Дело или шаг недоступны.", "CASE_ACCESS_DENIED");
    }
    const document = await createConfiguredDocument(user, { definition, language: parsed.data.language, answers: parsed.data.answers, title: parsed.data.title, finalContent: parsed.data.finalContent, manuallyEdited: parsed.data.manuallyEdited, caseId: parsed.data.caseId, planStepId: parsed.data.planStepId });
    return jsonResponse({ document }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
