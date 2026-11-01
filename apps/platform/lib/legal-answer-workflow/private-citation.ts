import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parsePrivateDocumentLocator } from "../document-analysis/private-document-locator";
import { readAuthorizedPrivateDocument } from "./private-documents";
import { withinSignal } from "./lifetime";
import { savedSourceIdentityMatches } from "./saved-source-identity";

export async function openPrivateSavedCitation(input: {
  db: D1Database; workspaceId: string; userId: string; messageId: string; sourceUrl: string; sourceId?: string;
  signal: AbortSignal; objects: Parameters<typeof readAuthorizedPrivateDocument>[0]["objects"];
}) {
  const vectorId = parsePrivateDocumentLocator(input.sourceUrl);
  if (!vectorId) throw new Error("PRIVATE_CITATION_LOCATOR_INVALID");
  const metadata = async () => {
    const rows = await withinSignal(input.signal, () => input.db.prepare(`SELECT r.id AS referenceId,
      r.answer_source_id AS answerSourceId,m.structured_json AS answerJson,r.article_reference AS article,
      r.conversation_id AS conversationId,r.title,r.content_sha256 AS savedHash,r.validated_at AS verifiedAt,
      chunk.char_start AS charStart,chunk.char_end AS charEnd,chunk.page,
      v.id AS documentVersionId,v.sha256 AS sourceHash,v.file_name AS fileName,v.created_at AS createdAt,job.language
      FROM legal_source_references r JOIN conversations c ON c.id=r.conversation_id
      JOIN conversation_messages m ON m.id=r.message_id AND m.conversation_id=c.id AND m.author_type='assistant'
      JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id AND member.status='active'
      JOIN user_document_vector_chunks chunk ON chunk.vector_id=? AND chunk.status='submitted' AND chunk.deleted_at IS NULL
      JOIN user_document_index_jobs job ON job.id=chunk.job_id AND job.workspace_id=c.workspace_id
        AND job.status='submitted' AND job.deleted_at IS NULL
      JOIN analysis_document_versions v ON v.id=job.document_version_id AND v.workspace_id=job.workspace_id
        AND v.owner_user_id=job.owner_user_id AND v.sha256=job.source_hash
      WHERE c.workspace_id=? AND c.owner_user_id=? AND c.status='active' AND r.message_id=?
        AND r.source_kind='internal' AND r.canonical_url=? AND (? IS NULL OR r.answer_source_id=? OR r.answer_source_id IS NULL) LIMIT 2`)
      .bind(vectorId, input.workspaceId, input.userId, input.messageId, input.sourceUrl, input.sourceId ?? null, input.sourceId ?? null)
      .all<{ referenceId: string; answerSourceId: string | null; answerJson: string | null; article: string | null;
        conversationId: string; title: string; savedHash: string; verifiedAt: string;
        charStart: number; charEnd: number; page: number; documentVersionId: string; sourceHash: string;
        fileName: string; createdAt: string; language: string }>());
    if (rows.results.length > 1) throw new Error("CITATION_SELECTION_AMBIGUOUS");
    const row = rows.results[0];
    if (row && input.sourceId && !row.answerSourceId
      && !savedSourceIdentityMatches(row.answerJson, input.sourceId, input.sourceUrl, row.article)) return null;
    return row ?? null;
  };
  const saved = await metadata();
  if (!saved) return null;
  const document = await readAuthorizedPrivateDocument({ ...input, conversationId: saved.conversationId,
    documentId: saved.documentVersionId, maximumBytes: 8 * 1024 * 1024 });
  if (saved.sourceHash !== document.sha256 || !Number.isSafeInteger(saved.charStart) || !Number.isSafeInteger(saved.charEnd)
    || saved.charStart < 0 || saved.charEnd <= saved.charStart || saved.charEnd > document.text.length) {
    throw new Error("PRIVATE_CITATION_INTEGRITY");
  }
  const text = document.text.slice(saved.charStart, saved.charEnd);
  if (saved.savedHash !== document.sha256 && saved.savedHash !== createHash("sha256").update(text).digest("hex")) {
    throw new Error("PRIVATE_CITATION_INTEGRITY");
  }
  if (!isDeepStrictEqual(await metadata(), saved)) throw new Error("PRIVATE_CITATION_ACCESS_CHANGED");
  return { documentTitle: saved.title || saved.fileName, documentType: null, documentNumber: null, adoptingAuthority: null,
    sourceClass: "private", articleNumber: null, articleTitle: null, part: null, chapter: null, section: null,
    text, fullArticle: false, fullDocument: saved.charStart === 0 && saved.charEnd === document.text.length,
    privateSource: true, evidenceUnavailable: false, truncated: false, language: saved.language,
    status: "private", validFrom: null, validTo: null, versionDate: saved.createdAt, officialUrl: input.sourceUrl,
    verifiedAt: saved.verifiedAt, availableLanguages: [], versionHistory: [] };
}
