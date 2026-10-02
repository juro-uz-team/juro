import {assertTemplatePlan} from "../../../../../lib/control-center/template-access";
import { resolvedDocument } from "../../../../../lib/document-builder/registry/published";
import { assertSafeWrite, requireApiUser } from "../../../../../lib/document-builder/auth/api";
import { apiError, badRequest, forbidden, jsonResponse, notFound } from "../../../../../lib/document-builder/auth/responses";
import { getDocumentByCode } from "../../../../../lib/document-builder/registry";
import { renderConfiguredDocument } from "../../../../../lib/document-builder/registry/engine";
import { requireOwner } from "../../../../../lib/document-builder/permissions";
import { loadConfiguredDocument } from "../../../../../lib/document-builder/storage/configured-documents";
import { isoNow } from "../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../lib/document-builder/storage/runtime";
import { saveConfiguredDocumentSchema } from "../../../../../lib/document-builder/validation/schema";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function firstText(answers: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = answers[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const document = await loadConfiguredDocument(id, user.id);
    if (!document) return notFound();
    return jsonResponse({ document });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const access = await requireOwner(id, user.id);
    if (!access) return forbidden();
    if (access.document.status === "Архив") return badRequest("Сначала восстановите документ из архива.", "ARCHIVED");
    const current = await loadConfiguredDocument(id, user.id);
    if (!current) return notFound();
    const parsed = saveConfiguredDocumentSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest("Не удалось проверить данные документа.", "INVALID_CONFIGURED_DOCUMENT");
    if (parsed.data.revision && parsed.data.revision !== current.revision) {
      return jsonResponse({ error: "Документ изменён в другой вкладке. Обновите страницу.", code: "REVISION_CONFLICT", currentRevision: current.revision }, { status: 409 });
    }
    const definition = await resolvedDocument(current.templateCode,current.templateVersion);
    if (!definition) return badRequest("Конфигурация шаблона не найдена.", "TEMPLATE_NOT_FOUND");
    await assertTemplatePlan(definition,user.id);
    const rendered = renderConfiguredDocument(definition, parsed.data.answers, parsed.data.language);
    const now = isoNow();
    const nextRevision = current.revision + 1;
    const nextStatus = current.status === "Согласован" ? "Готов" : current.status;
    const primary = firstText(parsed.data.answers, ["claimant.fullName", "employee.fullName", "creditor.fullName"]);
    const secondary = firstText(parsed.data.answers, ["respondent.fullName", "employer.name", "debtor.fullName"]);
    await requireD1().batch([
      requireD1().prepare("UPDATE documents SET title = ?, language = ?, lender_name = ?, borrower_name = ?, status = ?, revision = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?")
        .bind(parsed.data.title, parsed.data.language, primary, secondary, nextStatus, nextRevision, now, id, user.id),
      requireD1().prepare("UPDATE document_answers SET answers_json = ?, updated_at = ? WHERE document_id = ?").bind(JSON.stringify(parsed.data.answers), now, id),
      requireD1().prepare("UPDATE document_current_content SET auto_content = ?, final_content = ?, manually_edited = ?, updated_at = ? WHERE document_id = ?")
        .bind(rendered.plainText, parsed.data.finalContent, parsed.data.manuallyEdited ? 1 : 0, now, id),
    ]);
    return jsonResponse({ saved: true, revision: nextRevision, status: nextStatus, updatedAt: now, autoContent: rendered.plainText });
  } catch (error) {
    return apiError(error);
  }
}
