import { requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { getPrivateObject } from "../../../../../../lib/document-builder/storage/files";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { workspaceForUser } from "../../../../../../lib/platform/workspace";

export const GET = withApiErrors(async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  const { fileId } = await params;
  const file = await requireD1().prepare(
    `SELECT f.r2_key AS r2Key,f.file_name AS fileName,f.mime_type AS mimeType
     FROM document_files f WHERE f.id=? AND f.workspace_id=? AND f.owner_user_id=? AND (
       (f.kind IN ('analysis_safe','review_upload') AND EXISTS (
         SELECT 1 FROM document_analyses a WHERE a.uploaded_file_id=f.id AND a.workspace_id=f.workspace_id
           AND a.owner_user_id=f.owner_user_id AND a.deletion_requested_at IS NULL))
       OR (f.kind='comparison_version' AND EXISTS (
         SELECT 1 FROM document_comparisons c WHERE c.workspace_id=f.workspace_id
           AND c.owner_user_id=f.owner_user_id AND c.deleted_at IS NULL
           AND (c.version_one_file_id=f.id OR c.version_two_file_id=f.id)))
     ) LIMIT 1`,
  ).bind(fileId, workspace.id, user.id).first<{ r2Key: string; fileName: string; mimeType: string }>();
  if (!file) return Response.json({ error: "Файл не найден." }, { status: 404 });
  const object = await getPrivateObject(file.r2Key);
  if (!object) return Response.json({ error: "Файл недоступен." }, { status: 404 });
  const inline = ["application/pdf", "image/jpeg", "image/png"].includes(file.mimeType);
  return new Response(object.body, {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
