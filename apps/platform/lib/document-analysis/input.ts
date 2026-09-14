import type { LegalSourceContext } from "../legal/source-context";
import type { AnalysisPackageContext } from "../document-comparison/types";

export type DocumentAnalysisProviderRequest = {
  fileName: string;
  mimeType: string;
  extractedText: string;
  detectedLanguage: string;
  extractionWarnings: string[];
  packageContext: AnalysisPackageContext | null;
  locale: "ru" | "uz";
  mode: "quick" | "full" | "expert";
  userSide: string | null;
  sources: LegalSourceContext[];
  legalDatabaseAsOf: string;
  requestId: string;
};

/**
 * Keeps user-file evidence in a distinct envelope. The content is intentionally
 * preserved for legal analysis; the envelope is a trust boundary, not filtering.
 */
export function buildDocumentAnalysisProviderInput(input: DocumentAnalysisProviderRequest) {
  return {
    analysisRequest: {
      jurisdiction: "UZ",
      outputLanguage: input.locale,
      mode: input.mode,
      legalDatabaseAsOf: input.legalDatabaseAsOf,
    },
    officialLexSources: input.sources.map((source) => ({
      sourceId: source.id,
      actTitle: source.actTitle,
      actIdentifier: source.actIdentifier,
      article: source.article ?? null,
      excerpt: source.excerpt ?? null,
      originalUrl: source.officialUrl,
      effectiveDate: source.effectiveDate ?? null,
      verifiedAt: source.verifiedAt,
    })),
    untrustedDocument: {
      fileName: input.fileName,
      mimeType: input.mimeType,
      detectedLanguage: input.detectedLanguage,
      extractionWarnings: input.extractionWarnings,
      packageContext: input.packageContext,
      declaredUserSide: input.userSide,
      documentText: input.extractedText,
    },
  };
}
