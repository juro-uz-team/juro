import type { PinnedSourceStatus } from "./source-observation";
import type { CitationEvidenceReceipt } from "../legal-corpus/citation-evidence";

export type LegalSourceSpan = {
  id: string;
  article: string | null;
  paragraph: string | null;
  text: string;
  textSha256: string;
  quality: "high";
  /** Server-only corpus position used to bound adjacent-provision expansion. */
  provisionSequence?: number;
};
export type LegalSourceContext = {
  /** Authenticated upload identity. Rechecked against the document ledger when
   * the owning chat transaction saves a private citation. Never sent to models. */
  privateDocumentReceipt?: {
    analysisId:string;documentVersionId:string;workspaceId:string;ownerUserId:string;
    accessScope:"owner"|"workspace";caseId:string|null;
  };
  /** Server-owned publisher observation and authenticated parent fingerprint. */
  currentSourceStatus?: PinnedSourceStatus;
  /** Server-owned immutable evidence locator; never supplied to the model. */
  citationEvidenceReceipt?: CitationEvidenceReceipt;
  id: string;
  actTitle: string;
  actIdentifier: string | null;
  officialUrl: string;
  revisionDate: string | null;
  lastCheckedAt: string;
  locale: string;
  publishedAt: string | null;
  sourceType: string;
  status: string;
  verificationState: string;
  verifiedAt: string;
  contentSha256: string;
  article?: string | null;
  excerpt?: string | null;
  effectiveDate?: string | null;
  applicabilityStatus?: "current" | "historical";
  documentType?: string | null;
  documentNumber?: string | null;
  adoptingAuthority?: string | null;
  sourceClass?: "OFFICIAL_LEGISLATION" | "OFFICIAL_GOVERNMENT_GUIDANCE" | "OWNER_TRUSTED_GLOBAL" | "TENANT_TRUSTED_PRIVATE" | "USER_TRUSTED_PRIVATE" | "DERIVED_TRANSLATION" | "SECONDARY_REFERENCE";
  /** Request-scoped clean text. It must never be persisted after generation. */
  spans?: LegalSourceSpan[];
  sourceQuality?: {
    passed: boolean;
    title: boolean;
    sufficientText: boolean;
    clean: boolean;
    locale: boolean;
    canonicalUrl: boolean;
    structured: boolean;
  };
  /** Server-only provenance. It is never serialized into the model payload. */
  retrievalSelection?: "semantic_reranker" | "deterministic_fallback" | "responsive_neighbour";
};
