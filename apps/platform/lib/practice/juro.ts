import type { PoolClient } from "pg";
import { requireCase } from "./access";
import { hash, PracticeError, type Actor } from "./domain";
import { escapeHtml } from "./content";
import { getPrivateObject } from "../document-builder/storage/files";

/** Read the existing object through current case permissions. No document,
 * account, case or content row is copied into a second source of truth. */
export async function juroMaterial(
  client: PoolClient,
  actor: Actor,
  documentId: string,
  download = false,
) {
  const row = (
    await client.query(
      `SELECT d.*,c.owner_user_id AS case_owner_user_id,coalesce(t.final_content,'') AS final_content FROM documents d
    JOIN practice_matters m ON m.case_id=d.case_id AND m.workspace_id=$2 JOIN cases c ON c.id=m.case_id AND c.workspace_id=d.workspace_id
    LEFT JOIN document_current_content t ON t.document_id=d.id WHERE d.id=$1 AND NOT EXISTS(SELECT 1 FROM practice_documents WHERE document_id=d.id)`,
      [documentId, actor.workspaceId],
    )
  ).rows[0];
  if (!row) throw new PracticeError("NOT_FOUND", 404);
  await requireCase(client, actor, row.case_id);
  const collaborator = async () =>
    (
      await client.query(
        `SELECT 1 FROM document_collaborators WHERE document_id=$1 AND user_id=$2 AND can_view=1 AND ($3=false OR can_download=1) AND invitation_status='accepted' AND status IN ('active','opened','confirmed') AND revoked_at IS NULL`,
        [documentId, actor.userId, download],
      )
    ).rows[0];
  if (actor.role === "client" && row.owner_user_id !== actor.userId) {
    const shared = await collaborator();
    if (!shared) throw new PracticeError("NOT_FOUND", 404);
  }
  if (
    actor.role !== "client" &&
    row.owner_user_id !== row.case_owner_user_id &&
    row.owner_user_id !== actor.userId &&
    !(await collaborator())
  )
    throw new PracticeError("NOT_FOUND", 404);
  return {
    ...row,
    html: row.final_content
      .split(/\r?\n/)
      .map((line: string) => `<p>${escapeHtml(line)}</p>`)
      .join(""),
  };
}
export async function juroMaterialFile(
  client: PoolClient,
  actor: Actor,
  fileId: string,
) {
  const file = (
    await client.query(
      `SELECT * FROM document_files WHERE id=$1 AND archived_at IS NULL`,
      [fileId],
    )
  ).rows[0];
  if (!file?.document_id) throw new PracticeError("NOT_FOUND", 404);
  await juroMaterial(client, actor, file.document_id, true);
  const object = await getPrivateObject(file.r2_key);
  if (!object) throw new PracticeError("FILE_UNAVAILABLE", 503);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (file.sha256 && hash(bytes) !== file.sha256)
    throw new PracticeError("FILE_INTEGRITY_FAILED", 503);
  return { file, bytes };
}
