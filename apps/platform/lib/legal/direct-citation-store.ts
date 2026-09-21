import type { LegalSourceContext } from "../legal/source-context";
import { parsePrivateDocumentLocator } from "../document-analysis/private-document-locator";
import { canonicalSecondaryInternetUrl } from "./secondary-internet-url";
import { assertCitationEvidenceIdentity, citationEvidenceReceiptSchema } from "../legal-corpus/citation-evidence";

type ReturnedCitation = {
  sourceId: string;
  actTitle: string;
  actIdentifier: string | null;
  article: string | null;
  excerpt: string | null;
  originalUrl: string;
  status: string;
  effectiveDate: string | null;
  verifiedAt: string;
};

export type LegalCitationAccessMode = "direct" | "approved_package" | "mixed";

/**
 * Persists only source metadata already exposed in a completed answer. It is
 * shared by direct staff retrieval and the interactive verified corpus path;
 * neither path supplies raw HTML or a complete legal document here.
 */
export function legalCitationStatements(input: {
  db: D1Database;
  sources: readonly LegalSourceContext[];
  citations: readonly ReturnedCitation[];
  aiRunId?: string;
  guestRunId?: string;
  conversationId?: string | null;
  messageId?: string | null;
  now: string;
  sourceAccessMode: LegalCitationAccessMode;
}): D1PreparedStatement[] {
  if ((!input.aiRunId && !input.guestRunId) || (input.aiRunId && input.guestRunId)) {
    throw new TypeError("A direct citation must belong to exactly one AI run.");
  }
  const contexts = new Map(input.sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  return input.citations.flatMap((citation) => {
    const source = contexts.get(citation.sourceId);
    const validatedLex = source?.verificationState === "direct_validated"
      || source?.verificationState === "verified";
    const officialLex = (() => {
      try {
        const url = new URL(source?.officialUrl ?? "");
        return url.protocol === "https:" && (url.hostname === "lex.uz" || url.hostname === "www.lex.uz");
      } catch { return false; }
    })();
    const retainedPrivate = source?.sourceType === "internal"
      && source.sourceClass === "USER_TRUSTED_PRIVATE"
      && source.verificationState === "user_supplied"
      && source.status === "user_supplied"
      && parsePrivateDocumentLocator(source.officialUrl) !== null
      && source.sourceQuality?.passed === true;
    const authenticatedPrivate=source?.sourceType==="internal"&&source.verificationState==="user_supplied"
      &&source.status==="unconfirmed"&&parsePrivateDocumentLocator(source.officialUrl)===source.id
      &&source.privateDocumentReceipt!==undefined
      &&source.sourceClass===(source.privateDocumentReceipt.accessScope==="workspace"?"TENANT_TRUSTED_PRIVATE":"USER_TRUSTED_PRIVATE");
    const trustedPrivate=retainedPrivate||authenticatedPrivate;
    const trustedSecondary = source?.sourceType === "advice"
      && source.sourceClass === "SECONDARY_REFERENCE"
      && source.verificationState === "web_cited"
      && source.status === "unconfirmed"
      && canonicalSecondaryInternetUrl(source.officialUrl) === source.officialUrl
      && source.sourceQuality?.passed === true;
    const accepted = source
      && citation.originalUrl === source.officialUrl
      && ((source.sourceType === "lex" && officialLex && validatedLex) || trustedPrivate || trustedSecondary);
    if (!source || !accepted) return [];
    if (source.citationEvidenceReceipt) {
      const receipt = citationEvidenceReceiptSchema.parse(source.citationEvidenceReceipt);
      assertCitationEvidenceIdentity(receipt, {officialUrl: source.officialUrl,
        languageTag: {ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"}[source.locale] ?? source.locale,
        articleNumber: citation.article, sha256: source.contentSha256});
      if (!source.spans?.some(span => span.textSha256 === receipt.textSha256)) {
        throw new TypeError("CITATION_EVIDENCE_TEXT_MISMATCH");
      }
    }
    const citationKey = `${source.id}\u0000${citation.article ?? ""}`;
    if (seen.has(citationKey)) return [];
    const candidateExcerpt = citation.excerpt;
    const exactExcerpt = candidateExcerpt && source.spans?.some((span) => span.text.startsWith(candidateExcerpt))
      ? candidateExcerpt.slice(0, 1_200)
      : null;
    // A single act URL can support several cited provisions. Persist each
    // article separately so opening article 408 can never reuse article 215.
    seen.add(citationKey);
    return [input.db.prepare(
      `INSERT INTO legal_source_references (
        id,ai_run_id,guest_run_id,conversation_id,message_id,source_kind,source_locale,
        canonical_id,source_url,canonical_url,title,act_identifier,article_reference,
        excerpt,document_status,effective_date,retrieved_at,validated_at,content_sha256,
        fetch_status,citation_validation_status,source_access_mode,created_at,evidence_receipt_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      input.aiRunId ?? null,
      input.guestRunId ?? null,
      input.conversationId ?? null,
      input.messageId ?? null,
      source.sourceType,
      source.locale,
      source.actIdentifier,
      source.officialUrl,
      source.officialUrl,
      citation.actTitle.slice(0, 500),
      citation.actIdentifier,
      citation.article,
      exactExcerpt,
      citation.status,
      citation.effectiveDate,
      source.lastCheckedAt,
      citation.verifiedAt,
      source.contentSha256,
      "success",
      "validated",
      source.verificationState === "direct_validated" ? "direct" : "approved_package",
      input.now,
      source.citationEvidenceReceipt
        ? JSON.stringify(citationEvidenceReceiptSchema.parse(source.citationEvidenceReceipt)) : null,
    )];
  });
}

/** Compatibility wrapper for staff-only live direct retrieval callers. */
export function directCitationStatements(input: Omit<Parameters<typeof legalCitationStatements>[0], "sourceAccessMode">) {
  return legalCitationStatements({ ...input, sourceAccessMode: "direct" });
}
