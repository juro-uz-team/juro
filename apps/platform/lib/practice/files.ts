import type { PoolClient } from "pg";
import { audit, requireCase } from "./access";
import { documentAllowed } from "./documents";
import { hash, PracticeError, type Actor } from "./domain";
import {
  sanitizeFileName,
  validateUploadBytes,
} from "../document-builder/storage/file-validation";
import { quarantineScanAndStorePrivateObject } from "../document-builder/storage/quarantined-upload";
import { getPrivateObject } from "../document-builder/storage/files";

export async function uploadFile(
  client: PoolClient,
  actor: Actor,
  file: File,
  input: {
    caseId: string;
    documentId?: string;
    purpose: string;
    versionId?: string;
    clientVisible: boolean;
  },
) {
  if (
    !["material", "signed", "payment_evidence", "template"].includes(
      input.purpose,
    )
  )
    throw new PracticeError("INVALID_INPUT");
  const finance = input.purpose === "payment_evidence";
  await requireCase(client, actor, input.caseId, finance ? "finance" : "legal");
  if (input.purpose === "template")
    throw new PracticeError("USE_TEMPLATE_IMPORT");
  if (input.documentId) {
    const doc = await documentAllowed(client, actor, input.documentId);
    if (doc.case_id !== input.caseId) throw new PracticeError("NOT_FOUND", 404);
    if (
      input.purpose === "signed" &&
      (!doc.agreed_version_id || doc.agreed_version_id !== input.versionId)
    )
      throw new PracticeError("SIGNED_VERSION_MISMATCH", 409);
  } else if (input.purpose === "signed")
    throw new PracticeError("SIGNED_VERSION_MISMATCH");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspection = await validateUploadBytes(file, bytes);
  if (inspection) throw new PracticeError(inspection.code);
  if (input.purpose === "signed" && file.type !== "application/pdf")
    throw new PracticeError("SIGNED_PDF_REQUIRED");
  const id = crypto.randomUUID(),
    key = `practice/${actor.workspaceId}/${id}`,
    now = new Date().toISOString();
  await quarantineScanAndStorePrivateObject({
    key,
    bytes,
    mimeType: file.type,
  });
  await client.query(
    `INSERT INTO document_files(id,workspace_id,document_id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,sha256,created_at,updated_at)
    VALUES($1,$2,$3,$4,'attachment',$5,$6,$7,$8,$9,$10,$10)`,
    [
      id,
      actor.workspaceId,
      input.documentId ?? null,
      actor.userId,
      key,
      sanitizeFileName(file.name),
      file.type,
      bytes.length,
      hash(bytes),
      now,
    ],
  );
  await client.query(
    `INSERT INTO practice_files(file_id,case_id,client_visible,uploaded_by,purpose,version_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [
      id,
      input.caseId,
      actor.role === "client" || input.clientVisible,
      actor.userId,
      input.purpose,
      input.versionId ?? null,
    ],
  );
  await audit(client, actor, "file", id, "file.uploaded", {
    purpose: input.purpose,
  });
  return { id };
}
export async function downloadFile(
  client: PoolClient,
  actor: Actor,
  fileId: string,
) {
  const file = (
    await client.query(
      `SELECT d.*,f.case_id,f.purpose,f.client_visible,f.uploaded_by FROM document_files d JOIN practice_files f ON f.file_id=d.id WHERE d.id=$1 AND d.workspace_id=$2`,
      [fileId, actor.workspaceId],
    )
  ).rows[0];
  if (!file) throw new PracticeError("NOT_FOUND", 404);
  await requireCase(
    client,
    actor,
    file.case_id,
    file.purpose === "payment_evidence" ? "finance" : "legal",
  );
  if (
    actor.role === "client" &&
    !file.client_visible &&
    file.uploaded_by !== actor.userId
  )
    throw new PracticeError("NOT_FOUND", 404);
  const object = await getPrivateObject(file.r2_key);
  if (!object) throw new PracticeError("FILE_UNAVAILABLE", 503);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (file.sha256 && hash(bytes) !== file.sha256)
    throw new PracticeError("FILE_INTEGRITY_FAILED", 503);
  return { file, bytes };
}
