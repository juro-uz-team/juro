import { assertSafeWrite, requireApiUser } from "../../../../lib/document-builder/auth/api";
import { apiError, badRequest, jsonResponse } from "../../../../lib/document-builder/auth/responses";
import { createStoredDocument } from "../../../../lib/document-builder/storage/documents";
import { receiptAnswersSchema } from "../../../../lib/document-builder/validation/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const body = await request.json() as Record<string, unknown>;
    const parsed = receiptAnswersSchema.safeParse(body.answers);
    if (!parsed.success) return badRequest("Анкета содержит некорректные данные.", "INVALID_ANSWERS");
    const document = await createStoredDocument(user, {
      answers: parsed.data,
      title: typeof body.title === "string" ? body.title : undefined,
      autoContent: typeof body.autoContent === "string" ? body.autoContent : undefined,
      finalContent: typeof body.finalContent === "string" ? body.finalContent : undefined,
      manuallyEdited: Boolean(body.manuallyEdited),
    }, request.headers.get("x-juro-workspace-id"));
    return jsonResponse({ document }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
