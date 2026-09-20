import type { ControllingEvidenceResolution } from "../legal-corpus/target-evidence";
import { parseControllingEvidenceResolution } from "../legal-corpus/target-evidence";
import { citationEvidenceReceiptSchema } from "../legal-corpus/citation-evidence";
import { citationArticleNumber } from "../legal/citation-article";
import { isCurrentSourceObservation, type PinnedSourceStatus } from "../legal/source-observation";
import type { LegalEvidence, LegalTime } from "./answer-engine";
import { timeIdentity } from "./evidence-boundary";

const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** Only the authenticated reader supplies text and citation metadata. Search
 * hits and model selections cannot manufacture either. Article fragments are
 * withheld if their complete parent article could not be recovered. */
export async function corpusAnswerEvidence(input: {
  resolution: ControllingEvidenceResolution;
  endpoint: LegalTime;
  currentAt: string;
  currentSourceStatus?: PinnedSourceStatus;
}): Promise<LegalEvidence> {
  const resolution = parseControllingEvidenceResolution(input.resolution);
  const original = resolution.controlling;
  if (original.textualAuthority !== "controlling") throw new Error("CORPUS_AUTHORITY_UNRESOLVED");
  const article = citationArticleNumber(original.officialCitation.label, original.provisionText);
  if (article && !resolution.articleContext) throw new Error("CORPUS_COMPLETE_ARTICLE_UNAVAILABLE");
  const complete = resolution.articleContext ?? original;
  if (complete.provisionRenditionId !== original.provisionRenditionId
    || complete.textRevisionId !== original.textRevisionId
    || complete.provisionConceptId !== original.provisionConceptId
    || complete.legalInstrumentId !== original.legalInstrumentId
    || complete.officialExpressionId !== original.officialExpressionId
    || complete.languageTag !== original.languageTag
    || complete.textualAuthority !== original.textualAuthority
    || complete.officialCitation.url !== original.officialCitation.url
    || complete.evidence.sourceNormalizedSha256 !== original.evidence.sourceNormalizedSha256
    || complete.evidence.sourceRevisionId !== original.evidence.sourceRevisionId
    || !complete.provisionText.replace(/\s+/gu, " ").includes(original.provisionText.replace(/\s+/gu, " ").trim())) {
    throw new Error("CORPUS_ARTICLE_IDENTITY_MISMATCH");
  }
  if (resolution.articleContext && (!article
    || complete.evidence.sha256 !== complete.evidence.sourceNormalizedSha256)) {
    throw new Error("CORPUS_ARTICLE_RECEIPT_INVALID");
  }
  const checkedAt = Date.parse(input.currentAt);
  if (!Number.isFinite(checkedAt)) throw new Error("CORPUS_OBSERVATION_TIME_INVALID");
  if (input.endpoint.kind === "current" && (!input.currentSourceStatus
    || !isCurrentSourceObservation(input.currentSourceStatus.observation, {
      officialUrl: complete.officialCitation.url,
      normalizedTextSha256: input.currentSourceStatus.pinnedTextSha256, now: checkedAt,
    }))) throw new Error("CORPUS_CURRENT_SOURCE_UNCONFIRMED");
  const textSha256 = await digest(complete.provisionText);
  const receipt = citationEvidenceReceiptSchema.parse({
    version: 1, capability: input.endpoint.kind === "current" ? "current" : "history",
    kind: resolution.articleContext ? "normalized-article" : "provision",
    r2Key: complete.evidence.r2Key, byteCount: complete.evidence.byteCount,
    sha256: complete.evidence.sha256, officialUrl: complete.officialCitation.url,
    languageTag: complete.languageTag, articleNumber: article, textSha256,
  });
  // Complete articles can be discovered through several different chunks.
  // Their identity is the exact saved text at the requested endpoint.
  const id = `corpus-${await digest(JSON.stringify([timeIdentity(input.endpoint), receipt]))}`;
  return {
    source: {
      id, actTitle: original.officialCitation.label, actIdentifier: original.legalInstrumentId,
      officialUrl: original.officialCitation.url, article,
      revisionDate: null, publishedAt: null, lastCheckedAt: input.currentAt,
      verifiedAt: input.currentAt, locale: {ru:"ru", "uz-Latn":"uz", "uz-Cyrl":"uzc", en:"en"}[complete.languageTag],
      sourceType: "lex", sourceClass: "OFFICIAL_LEGISLATION",
      status: input.endpoint.kind === "current" ? "current" : "historical",
      applicabilityStatus: input.endpoint.kind === "current" ? "current" : "historical",
      verificationState: "verified", contentSha256: receipt.sha256,
      citationEvidenceReceipt: receipt,
      ...(input.endpoint.kind === "current" ? {currentSourceStatus: input.currentSourceStatus} : {}),
    },
    text: complete.provisionText, textSha256, endpoint: input.endpoint, origin: "indexed",
  };
}
