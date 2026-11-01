import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { LegalChatResponse } from "../ai/legal-chat-schema";
import type { CitationEvidenceReceipt } from "../legal-corpus/citation-evidence";
import type { OfficialProvision } from "./contracts";
import { readSavedNormalizedText, readNormalizedSourceFile } from "./normalized-document";
import { withinSignal } from "./lifetime";
import { savedSourceIdentityMatches } from "./saved-source-identity";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const receiptSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), capability: z.enum(["current", "history"]),
  kind: z.enum(["provision", "normalized-article", "normalized-document", "normalized-section"]),
  r2Key: z.string().min(1).max(1024), byteCount: z.number().int().positive(), sha256: digest,
  officialUrl: z.string().url(), languageTag: z.enum(["en", "ru", "uz-Latn", "uz-Cyrl"]),
  articleNumber: z.string().nullable(), textSha256: digest,
  store: z.object({ namespace: z.string().min(1), generationSha256: digest }).strict().optional(),
}).strict();

export type CitationRecord = {
  source: LegalChatResponse["sources"][number];
  evidence: OfficialProvision;
  receipt: CitationEvidenceReceipt;
  accessMode: "direct" | "approved_package";
};

export function citationStatements(input: { db: D1Database; now: string; citations: readonly CitationRecord[] } & (
  { aiRunId: string; conversationId: string; messageId: string; guestRunId?: never }
  | { guestRunId: string; aiRunId?: never; conversationId?: never; messageId?: never }
)) {
  return input.citations.map(({ source, receipt, evidence, accessMode }) => {
    const retained = receiptSchema.parse(receipt);
    if (source.sourceId !== evidence.identity || source.originalUrl !== evidence.sourceUrl
      || receipt.officialUrl !== evidence.sourceUrl || receipt.r2Key !== evidence.objectKey
      || receipt.sha256 !== evidence.sha256 || receipt.byteCount !== evidence.byteCount
      || (receipt.kind === "provision" && receipt.textSha256 !== receipt.sha256)) {
      throw new Error("CITATION_EVIDENCE_MISMATCH");
    }
    const locale = { en: "en", ru: "ru", "uz-Latn": "uz", "uz-Cyrl": "uzc" }[receipt.languageTag];
    return input.db.prepare(`INSERT INTO legal_source_references
      (id,ai_run_id,guest_run_id,conversation_id,message_id,source_kind,source_locale,canonical_id,
       source_url,canonical_url,title,act_identifier,article_reference,excerpt,document_status,effective_date,
       retrieved_at,validated_at,content_sha256,fetch_status,citation_validation_status,source_access_mode,
       created_at,evidence_receipt_json,answer_source_id)
      VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,'success','validated',?,?,?,?)`)
      .bind(randomUUID(), input.aiRunId ?? null, input.guestRunId ?? null, input.conversationId ?? null, input.messageId ?? null,
        accessMode === "approved_package" ? "package" : "lex", locale,
        source.originalUrl, receipt.officialUrl, source.actTitle, source.actIdentifier, source.article,
        source.excerpt, source.status, source.effectiveDate, source.verifiedAt, source.verifiedAt,
        receipt.textSha256, accessMode, input.now, JSON.stringify(retained), source.sourceId);
  });
}

export async function readSavedCitationReceipt(input: { db: D1Database; workspaceId: string; userId: string;
  messageId: string; sourceId?: string; sourceUrl?: string; article?: string }) {
  if (!input.sourceId && !input.sourceUrl) throw new Error("CITATION_SELECTION_REQUIRED");
  const rows = await input.db.prepare(`SELECT r.id AS referenceId,r.evidence_receipt_json AS receiptJson,r.excerpt AS excerpt,
    r.answer_source_id AS answerSourceId,m.structured_json AS answerJson,r.canonical_url AS canonicalUrl,
    r.title,r.article_reference AS article,r.document_status AS status,r.effective_date AS effectiveDate,
    r.validated_at AS verifiedAt
    FROM legal_source_references r JOIN conversations c ON c.id=r.conversation_id
    JOIN conversation_messages m ON m.id=r.message_id AND m.conversation_id=c.id
    JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id AND member.status='active'
    WHERE c.workspace_id=? AND c.owner_user_id=? AND c.status='active' AND r.message_id=?
      AND ((? IS NOT NULL AND r.answer_source_id=?) OR ((? IS NULL OR r.answer_source_id IS NULL) AND r.canonical_url=?
        AND (? IS NULL OR r.article_reference=?))) LIMIT 2`)
    .bind(input.workspaceId, input.userId, input.messageId, input.sourceId ?? null, input.sourceId ?? null,
      input.sourceId ?? null, input.sourceUrl ?? null, input.article ?? null, input.article ?? null)
    .all<{ referenceId: string; answerSourceId: string | null; answerJson: string | null; canonicalUrl: string;
      receiptJson: string | null; excerpt: string | null; title: string; article: string | null;
      status: string | null; effectiveDate: string | null; verifiedAt: string }>();
  if (rows.results.length > 1) throw new Error("CITATION_SELECTION_AMBIGUOUS");
  const row = rows.results[0];
  if (row && input.sourceId && !row.answerSourceId
    && !savedSourceIdentityMatches(row.answerJson, input.sourceId, row.canonicalUrl, row.article)) return null;
  if (!row?.receiptJson) return null;
  return { referenceId: row.referenceId, receipt: receiptSchema.parse(JSON.parse(row.receiptJson)), excerpt: row.excerpt,
    title: row.title, article: row.article, status: row.status, effectiveDate: row.effectiveDate, verifiedAt: row.verifiedAt };
}

/** Reopen the saved version, without promoting that version to present-day legal authority. */
export async function openSavedCitation(input: Parameters<typeof readSavedCitationReceipt>[0] & {
  signal: AbortSignal;
  includePdf?: boolean;
  objects: { get(key: string, store: CitationEvidenceReceipt["store"], signal: AbortSignal): Promise<Uint8Array | null> };
}) {
  const saved = await withinSignal(input.signal, () => readSavedCitationReceipt(input));
  if (!saved) return null;
  const { receipt } = saved;
  if ((input.sourceUrl !== undefined && input.sourceUrl !== receipt.officialUrl)
    || (input.article !== undefined && input.article !== saved.article)) throw new Error("CITATION_SELECTION_MISMATCH");
  const url = new URL(receipt.officialUrl);
  if (url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error("CITATION_PUBLISHER_INVALID");
  if (receipt.byteCount > 8 * 1024 * 1024) throw new Error("CITATION_OBJECT_BOUND");
  const bytes = await withinSignal(input.signal, () => input.objects.get(receipt.r2Key, receipt.store, input.signal));
  if (!bytes) throw new Error("CITATION_OBJECT_UNAVAILABLE");
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("CITATION_OBJECT_BOUND");
  const serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (receipt.kind === "normalized-article" && !receipt.articleNumber) throw new Error("CITATION_ARTICLE_MISSING");
  const text = receipt.kind === "provision" ? serialized : readSavedNormalizedText({ serialized,
    expectedUrl: receipt.officialUrl, kind: receipt.kind, articleNumber: receipt.articleNumber, textSha256: receipt.textSha256 });
  const sourceFile = receipt.kind === "provision" ? undefined : readNormalizedSourceFile(serialized, receipt.officialUrl);
  let pdfBytes: Uint8Array | undefined;
  if (sourceFile) {
    const pdf = await withinSignal(input.signal, () => input.objects.get(sourceFile.objectKey, receipt.store, input.signal));
    if (!pdf) throw new Error("CITATION_SOURCE_FILE_UNAVAILABLE");
    if (input.includePdf) pdfBytes = new Uint8Array(pdf);
  }
  const current = await withinSignal(input.signal, () => readSavedCitationReceipt(input));
  if (!current) return null;
  if (!isDeepStrictEqual(current, saved)) throw new Error("CITATION_RECEIPT_CHANGED");
  input.signal.throwIfAborted();
  return { ...saved, text, ...(sourceFile ? { sourceFile } : {}), ...(pdfBytes ? { pdfBytes } : {}) };
}
