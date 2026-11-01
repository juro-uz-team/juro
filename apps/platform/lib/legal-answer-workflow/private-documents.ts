import { createHash } from "node:crypto";
import type { LegalRequest } from "./contracts";
import type { ProvisionObjects } from "./evidence";
import { withinSignal } from "./lifetime";

export const maximumPrivateDocumentBytes = 8 * 1024 * 1024;

type PrivateDocumentInput = {
  db: D1Database; workspaceId: string; userId: string; conversationId: string | null;
  /** Immutable analysis_document_versions IDs, never object keys or model-provided locators. */
  documentIds: readonly string[]; signal: AbortSignal; objects: ProvisionObjects;
};

function accessQuery(input: Pick<PrivateDocumentInput, "workspaceId" | "userId" | "conversationId">, id: string) {
  return { sql: `SELECT v.r2_key AS objectKey,v.size_bytes AS byteCount,v.sha256 AS sha256
    FROM analysis_document_versions v
    JOIN document_analyses a ON a.id=v.analysis_id AND a.workspace_id=v.workspace_id AND a.owner_user_id=v.owner_user_id
    JOIN document_files f ON f.id=a.uploaded_file_id AND f.workspace_id=a.workspace_id AND f.owner_user_id=a.owner_user_id
    JOIN workspace_members member ON member.workspace_id=v.workspace_id AND member.user_id=? AND member.status='active'
    WHERE v.id=? AND v.workspace_id=? AND a.status='completed' AND a.deletion_requested_at IS NULL
      AND f.archived_at IS NULL AND f.kind='analysis_safe' AND v.mime_type='text/markdown; charset=utf-8'
      AND (v.owner_user_id=? OR EXISTS (SELECT 1 FROM user_document_index_jobs job
        WHERE job.document_version_id=v.id AND job.analysis_id=a.id AND job.workspace_id=v.workspace_id
          AND job.owner_user_id=v.owner_user_id AND job.access_scope='workspace' AND job.status='submitted'
          AND job.source_hash=v.sha256 AND job.deleted_at IS NULL))
      AND EXISTS (SELECT 1 FROM file_scan_results scan WHERE scan.analysis_id=a.id AND scan.file_id=f.id
        AND scan.workspace_id=a.workspace_id AND scan.owner_user_id=a.owner_user_id
        AND scan.verdict='clean' AND scan.source_sha256=f.sha256)
      AND NOT EXISTS (SELECT 1 FROM file_scan_results scan WHERE scan.file_id=f.id
        AND scan.source_sha256=f.sha256 AND scan.verdict='infected')
      AND (? IS NULL OR EXISTS (SELECT 1 FROM conversations c WHERE c.id=? AND c.workspace_id=?
        AND c.owner_user_id=? AND c.status='active'))`,
    values: [input.userId, id, input.workspaceId, input.userId, input.conversationId, input.conversationId, input.workspaceId, input.userId] };
}

export async function requirePrivateDocumentAccess(input: Omit<PrivateDocumentInput, "objects">) {
  if (new Set(input.documentIds).size !== input.documentIds.length) {
    throw new Error("PRIVATE_DOCUMENT_SELECTION_INVALID");
  }
  for (const id of input.documentIds) {
    const access = accessQuery(input, id);
    if (!await withinSignal(input.signal, () => input.db.prepare(access.sql).bind(...access.values).first())) {
      throw new Error("PRIVATE_DOCUMENT_UNAVAILABLE");
    }
  }
}

/** Lock revocable records and recheck authorization inside the same transaction that publishes the answer. */
export function privateDocumentPublicationStatements(input: Pick<PrivateDocumentInput, "db" | "workspaceId" | "userId" | "conversationId" | "documentIds">) {
  if (new Set(input.documentIds).size !== input.documentIds.length) throw new Error("PRIVATE_DOCUMENT_SELECTION_INVALID");
  return input.documentIds.flatMap(id => {
    const access = accessQuery(input, id);
    return [
      input.db.prepare(`UPDATE document_analyses SET id=id WHERE workspace_id=? AND id IN
        (SELECT analysis_id FROM analysis_document_versions WHERE id=? AND workspace_id=?)`)
        .bind(input.workspaceId, id, input.workspaceId),
      input.db.prepare(`UPDATE document_files SET id=id WHERE workspace_id=? AND id IN
        (SELECT a.uploaded_file_id FROM document_analyses a JOIN analysis_document_versions v ON v.analysis_id=a.id
          WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=v.workspace_id)`)
        .bind(input.workspaceId, id, input.workspaceId),
      input.db.prepare(`UPDATE user_document_index_jobs SET id=id WHERE document_version_id=? AND workspace_id=?`)
        .bind(id, input.workspaceId),
      input.db.prepare(`SELECT CASE WHEN EXISTS (${access.sql}) THEN 1
        ELSE json_extract('PRIVATE_DOCUMENT_ACCESS_REVOKED','$') END AS allowed`).bind(...access.values),
    ];
  });
}

/** Explicitly selected private text stays case context and is never admitted to the official inventory. */
export async function readAuthorizedPrivateDocument(input: Omit<PrivateDocumentInput, "documentIds"> & {
  documentId: string; maximumBytes?: number;
}) {
  const maximum = input.maximumBytes ?? maximumPrivateDocumentBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maximumPrivateDocumentBytes) throw new Error("PRIVATE_DOCUMENT_BOUND");
  const access = accessQuery(input, input.documentId);
  const readMetadata = () => withinSignal(input.signal, () => input.db.prepare(access.sql).bind(...access.values)
    .first<{objectKey: string; byteCount: number; sha256: string}>());
  const metadata = await readMetadata();
  if (!metadata) throw new Error("PRIVATE_DOCUMENT_UNAVAILABLE");
  if (!Number.isSafeInteger(metadata.byteCount) || metadata.byteCount < 1 || metadata.byteCount > maximum
    || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !metadata.objectKey.startsWith("analysis-versions/")) {
    throw new Error("PRIVATE_DOCUMENT_METADATA_INVALID");
  }
  const bytes = await withinSignal(input.signal, () => input.objects.get(metadata.objectKey, input.signal));
  if (!bytes || bytes.byteLength !== metadata.byteCount
    || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) throw new Error("PRIVATE_DOCUMENT_INTEGRITY");
  const current = await readMetadata();
  if (!current || current.objectKey !== metadata.objectKey || current.sha256 !== metadata.sha256
    || current.byteCount !== metadata.byteCount) throw new Error("PRIVATE_DOCUMENT_UNAVAILABLE");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim()) throw new Error("PRIVATE_DOCUMENT_EMPTY");
  return { ...metadata, text };
}

export async function loadPrivateAnswerDocuments(input: PrivateDocumentInput): Promise<LegalRequest["privateDocuments"]> {
  if (new Set(input.documentIds).size !== input.documentIds.length) {
    throw new Error("PRIVATE_DOCUMENT_SELECTION_INVALID");
  }
  const documents: { id: string; text: string }[] = [];
  for (const id of input.documentIds) {
    const { text } = await readAuthorizedPrivateDocument({ ...input, documentId: id });
    documents.push({ id, text });
  }
  return documents;
}
