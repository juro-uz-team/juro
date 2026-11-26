import { requireApiUser } from "../../../../../../lib/document-builder/auth/api";
import { apiError, badRequest, forbidden } from "../../../../../../lib/document-builder/auth/responses";
import { loadDocxTemplate } from "../../../../../../lib/document-builder/generation/assets";
import { generateDocx } from "../../../../../../lib/document-builder/generation/docx";
import { paragraphsFromFinalText } from "../../../../../../lib/document-builder/generation/paragraphs";
import { getDocumentAccess } from "../../../../../../lib/document-builder/permissions";
import { sanitizeFileName } from "../../../../../../lib/document-builder/storage/files";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const access = await getDocumentAccess(id, user.id);
    if (!access?.canView || !access.canDownload) return forbidden();
    const content = await requireD1().prepare(
      "SELECT final_content AS text FROM document_current_content WHERE document_id=?",
    ).bind(id).first<{ text: string }>();
    if (!content?.text?.trim()) return badRequest("DOCUMENT_TEXT_EMPTY");
    const { language, title } = access.document;
    const template = await loadDocxTemplate(language, request);
    const bytes = generateDocx(template, paragraphsFromFinalText(content.text), {
      title, documentLanguage: language === "ru" ? "ru-RU" : "uz-Latn-UZ",
    });
    const name = sanitizeFileName(title).replace(/\.docx$/i, "") + ".docx";
    return new Response(Uint8Array.from(bytes).buffer, { headers: {
      "cache-control": "private, no-store",
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
    } });
  } catch (error) {
    return apiError(error);
  }
}
