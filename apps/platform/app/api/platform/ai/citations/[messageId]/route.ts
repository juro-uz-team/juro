import { withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { requireR2, runtimeEnv } from "../../../../../../lib/document-builder/storage/runtime";
import { assertCitationEvidenceIdentity, citationEvidenceReceiptSchema, fetchCitationEvidence } from "../../../../../../lib/legal-corpus/citation-evidence";
import { legalRetrievalEnvironment } from "../../../../../../lib/legal-corpus/environment";
import { parsePrivateDocumentLocator } from "../../../../../../lib/document-analysis/private-document-locator";
import { normalizeArticleNumber } from "../../../../../../lib/legal/legal-language";
import { classifyLegalSourceUrl } from "../../../../../../lib/legal/source-fetch";
import {legalChatOwner} from "../../../../../../lib/legal-chat/http-owner";

type Context = { params: Promise<{ messageId: string }> };

type CitationRow = {
  answerSourceId: string | null;
  evidenceReceiptJson?: string | null;
  title: string;
  articleReference: string | null;
  excerpt: string | null;
  documentStatus: string | null;
  effectiveDate: string | null;
  canonicalUrl: string;
  sourceLocale: string;
  validatedAt: string;
  sourceKind: string;
  contentSha256: string;
};

type PrivateDocumentRow = {
  vectorId: string;
  charStart: number;
  charEnd: number;
  page: number;
  documentVersionId: string;
  sourceHash: string;
  language: string;
  r2Key: string;
  sizeBytes: number;
  fileName: string;
  version: number;
  createdAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PRIVATE_DOCUMENT_CHARACTERS = 200_000;

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

function officialLexUrl(value: string): boolean {
  try {
    return classifyLegalSourceUrl(value).sourceKind === "lex";
  } catch {
    return false;
  }
}

function checksumHex(value: ArrayBuffer | undefined): string | null {
  if (!value) return null;
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedArticle(value: string | null): string | null {
  if (!value) return null;
  const direct = normalizeArticleNumber(value);
  if (direct) return direct;
  const number = value.match(/\d+(?:\s*[-.‐‑–—]\s*[\p{L}\d]+)?/u)?.[0] ?? "";
  return normalizeArticleNumber(number) || null;
}

export const GET = withApiErrors(async function GET(request: Request, context: Context) {
  const owner=await legalChatOwner(request);
  if(!owner)return response({code:"CITATION_UNAVAILABLE"},404);
  const { messageId } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const sourceUrl = searchParams.get("sourceUrl") ?? "";
  const requestedArticleRaw = searchParams.get("article");
  const requestedSourceId = searchParams.get("sourceId");
  const requestedArticle = normalizedArticle(requestedArticleRaw);
  const privateVectorId = parsePrivateDocumentLocator(sourceUrl);
  if (
    !UUID.test(messageId)
    || sourceUrl.length > 2_000
    || (requestedSourceId !== null && (!requestedSourceId.trim() || requestedSourceId.length > 160))
    || (requestedArticleRaw !== null && (requestedArticleRaw.length > 160 || !requestedArticle))
    || (!officialLexUrl(sourceUrl) && !privateVectorId)
  ) {
    return response({ code: "CITATION_UNAVAILABLE" }, 404);
  }
  const db = owner.db;
  const citations = await db.prepare(`SELECT reference.title,reference.answer_source_id AS answerSourceId,
      reference.article_reference AS articleReference,reference.excerpt,
      reference.document_status AS documentStatus,reference.effective_date AS effectiveDate,
      reference.canonical_url AS canonicalUrl,reference.source_locale AS sourceLocale,
      reference.validated_at AS validatedAt,reference.source_kind AS sourceKind,
      reference.content_sha256 AS contentSha256,reference.evidence_receipt_json AS evidenceReceiptJson
    FROM legal_source_references AS reference
    INNER JOIN conversations AS conversation ON conversation.id=reference.conversation_id
    WHERE reference.message_id=? AND reference.canonical_url=?
      AND reference.citation_validation_status='validated'
      AND conversation.workspace_id=? AND conversation.owner_user_id=?
    ORDER BY reference.created_at ASC LIMIT 64`).bind(
    messageId, sourceUrl, owner.workspaceId, owner.userId,
  ).all<CitationRow>();
  const candidates = requestedArticle
    ? citations.results.filter((candidate) => normalizedArticle(candidate.articleReference) === requestedArticle)
    : citations.results;
  // URL/article pairs can collide across sections and captured revisions.
  // Legacy rows may fall back only when the saved locator is unambiguous.
  const legacy = candidates.length === 1 ? candidates[0] : undefined;
  const citation = requestedSourceId
    ? candidates.find(candidate => candidate.answerSourceId === requestedSourceId)
      ?? (legacy?.answerSourceId == null ? legacy : undefined)
    : legacy;
  if (!citation) return response({ code: "CITATION_UNAVAILABLE" }, 404);

  if (privateVectorId) {
    if (citation.sourceKind !== "internal") return response({ code: "CITATION_UNAVAILABLE" }, 404);
    const privateDocument = await db.prepare(`SELECT
        chunk.vector_id AS vectorId,chunk.char_start AS charStart,chunk.char_end AS charEnd,chunk.page,
        job.document_version_id AS documentVersionId,job.source_hash AS sourceHash,job.language,
        version.r2_key AS r2Key,version.size_bytes AS sizeBytes,version.file_name AS fileName,
        version.version,version.created_at AS createdAt
      FROM user_document_vector_chunks AS chunk
      INNER JOIN user_document_index_jobs AS job ON job.id=chunk.job_id AND job.status='submitted'
      INNER JOIN analysis_document_versions AS version ON version.id=job.document_version_id
        AND version.analysis_id=job.analysis_id AND version.workspace_id=job.workspace_id
        AND version.owner_user_id=job.owner_user_id AND version.sha256=job.source_hash
      INNER JOIN document_analyses AS analysis ON analysis.id=job.analysis_id
        AND analysis.workspace_id=job.workspace_id AND analysis.owner_user_id=job.owner_user_id
      WHERE chunk.vector_id=? AND chunk.status='submitted' AND job.workspace_id=?
        AND analysis.status='completed' AND job.source_hash=?
        AND (job.access_scope='workspace' OR (job.access_scope='owner' AND job.owner_user_id=?))
        AND version.version=(SELECT max(latest.version) FROM analysis_document_versions latest
          WHERE latest.analysis_id=job.analysis_id AND latest.workspace_id=job.workspace_id)
      LIMIT 1`).bind(
      privateVectorId, owner.workspaceId, citation.contentSha256, owner.userId,
    ).first<PrivateDocumentRow>();
    if (!privateDocument) return response({ code: "CITATION_UNAVAILABLE" }, 404);
    const object = await requireR2().get(privateDocument.r2Key);
    if (
      !object
      || object.size !== Number(privateDocument.sizeBytes)
      || checksumHex(object.checksums.sha256) !== privateDocument.sourceHash
    ) return response({ code: "CITATION_UNAVAILABLE" }, 404);
    const bytes = await object.arrayBuffer();
    if (await sha256(bytes) !== privateDocument.sourceHash) {
      return response({ code: "CITATION_UNAVAILABLE" }, 404);
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    } catch {
      return response({ code: "CITATION_UNAVAILABLE" }, 404);
    }
    const displayed = text.slice(0, MAX_PRIVATE_DOCUMENT_CHARACTERS);
    return response({
      documentTitle: privateDocument.fileName,
      documentType: "uploaded_document",
      documentNumber: null,
      adoptingAuthority: null,
      sourceClass: "USER_TRUSTED_PRIVATE",
      articleNumber: null,
      articleTitle: null,
      part: Number(privateDocument.page) > 0 ? `page:${privateDocument.page}` : null,
      chapter: null,
      section: null,
      text: displayed || citation.excerpt,
      fullArticle: false,
      fullDocument: displayed.length > 0,
      privateSource: true,
      truncated: text.length > displayed.length,
      language: privateDocument.language,
      status: "user_supplied",
      validFrom: null,
      validTo: null,
      versionDate: privateDocument.createdAt,
      officialUrl: citation.canonicalUrl,
      verifiedAt: citation.validatedAt,
      availableLanguages: [],
      versionHistory: [{
        versionNumber: privateDocument.version,
        status: "user_supplied",
        validFrom: null,
        validTo: null,
        versionDate: privateDocument.createdAt,
        fetchedAt: citation.validatedAt,
      }],
    });
  }
  if (citation.sourceKind !== "lex") return response({ code: "CITATION_UNAVAILABLE" }, 404);

  if (citation.evidenceReceiptJson) {
    try {
      const receipt = citationEvidenceReceiptSchema.parse(JSON.parse(citation.evidenceReceiptJson));
      assertCitationEvidenceIdentity(receipt, {officialUrl: citation.canonicalUrl, sha256: citation.contentSha256,
        languageTag: {ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"}[citation.sourceLocale] ?? citation.sourceLocale,
        articleNumber: citation.articleReference});
      const env = runtimeEnv();
      if (!env.LEGAL_RETRIEVAL_SERVICE) throw new TypeError("CITATION_SERVICE_UNAVAILABLE");
      const evidence = await fetchCitationEvidence(env.LEGAL_RETRIEVAL_SERVICE, legalRetrievalEnvironment(env), receipt);
      return response({documentTitle: citation.title, documentType: null, documentNumber: null,
        adoptingAuthority: null, sourceClass: "OFFICIAL_LEGISLATION", articleNumber: citation.articleReference,
        articleTitle: null, part: null, chapter: null, section: null, ...evidence,
        language: receipt.languageTag, status: citation.documentStatus ?? "unknown",
        validFrom: citation.effectiveDate, validTo: null, versionDate: citation.effectiveDate,
        officialUrl: citation.canonicalUrl, verifiedAt: citation.validatedAt,
        evidenceIdentity: {receiptVersion: receipt.version, capability: receipt.capability, kind: receipt.kind,
          r2Key: receipt.r2Key, sha256: receipt.sha256, textSha256: receipt.textSha256},
        availableLanguages: [], versionHistory: []});
    } catch {
      // A missing immutable object must never be replaced by the latest text.
      return response({documentTitle: citation.title, articleNumber: citation.articleReference,
        text: citation.excerpt, fullArticle: false, truncated: false, evidenceUnavailable: true, language: citation.sourceLocale,
        status: citation.documentStatus ?? "unknown", officialUrl: citation.canonicalUrl,
        verifiedAt: citation.validatedAt, availableLanguages: [], versionHistory: []});
    }
  }

  // Older answers have no authenticated full-article receipt. Preserve the
  // saved fragment; reopening must not imply completeness or select other text.
  return response({documentTitle: citation.title, articleNumber: citation.articleReference,
    text: citation.excerpt, fullArticle: false, truncated: false, evidenceUnavailable: true,
    language: citation.sourceLocale, status: citation.documentStatus ?? "unknown",
    officialUrl: citation.canonicalUrl, verifiedAt: citation.validatedAt,
    availableLanguages: [], versionHistory: []});
});
