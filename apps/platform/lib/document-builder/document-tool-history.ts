import type { DocumentRecord, FileRecord } from "./types";

export async function documentToolHistory(
  db: D1Database, workspaceId: string, userId: string, documents: DocumentRecord[], files: FileRecord[],
) {
  const entries = [
    ...documents.map(document => ({ id: document.id, documentId: document.id, fileId: document.signedFileId })),
    ...files.map(file => ({ id: file.id, documentId: null, fileId: file.id })),
  ];
  if (!entries.length) return {};
  const queries = entries.flatMap(({ documentId, fileId }) => {
    const match = `WITH matching_files AS (
      SELECT f.id FROM document_files f
      WHERE f.workspace_id=? AND f.owner_user_id=?
        AND (f.document_id=? OR f.tool_source_document_id=? OR f.id=? OR f.sha256 IN (
          SELECT input.sha256 FROM document_files input
          WHERE input.id=? AND input.workspace_id=f.workspace_id AND input.owner_user_id=f.owner_user_id
            AND input.size_bytes=f.size_bytes AND input.sha256 IS NOT NULL))
    )`;
    const bindings = [workspaceId, userId, documentId, documentId, fileId, fileId, workspaceId, userId];
    return [
      db.prepare(`${match} SELECT a.id FROM document_analyses a
        WHERE a.workspace_id=? AND a.owner_user_id=? AND a.deletion_requested_at IS NULL
          AND a.uploaded_file_id IN (SELECT id FROM matching_files)
        ORDER BY CASE WHEN a.status='completed' THEN 0 ELSE 1 END,a.created_at DESC,a.id DESC LIMIT 1`).bind(...bindings),
      db.prepare(`${match} SELECT cmp.id FROM document_comparisons cmp
        WHERE cmp.workspace_id=? AND cmp.owner_user_id=? AND cmp.deleted_at IS NULL
          AND (cmp.version_one_file_id IN (SELECT id FROM matching_files)
            OR cmp.version_two_file_id IN (SELECT id FROM matching_files))
        ORDER BY CASE WHEN cmp.status IN ('completed','completed_partial') THEN 0 ELSE 1 END,cmp.created_at DESC,cmp.id DESC LIMIT 1`).bind(...bindings),
    ];
  });
  const results = await db.batch<{ id: string }>(queries);
  return Object.fromEntries(entries.map(({ id }, index) => [id, {
    analysisId: results[index * 2].results[0]?.id,
    comparisonId: results[index * 2 + 1].results[0]?.id,
  }]));
}
