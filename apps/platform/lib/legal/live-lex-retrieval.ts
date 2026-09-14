import type { LegalSourceContext } from "../legal/source-context";
import {
  retrieveDirectLegalSources,
  type DirectLegalRetrieval,
  type DirectLegalSourceEvidence,
} from "./direct-retrieval";
import type { LegalDatabaseFreshness } from "./verified-retrieval";

/**
 * The only runtime legal retrieval contract for user-facing AI and document
 * analysis.  It intentionally contains no D1 corpus, publication, review or
 * Vectorize dependency: the evidence is fetched from the canonical HTTPS
 * Lex.uz page for this request and discarded after the answer is produced.
 */
export type LiveLexRetrieval = Pick<DirectLegalRetrieval,
  "sources" | "freshness" | "legalDatabaseAsOf" | "sourceAccessMode"
  | "sourcesRetrievedAt" | "sourceValidationStatus" | "errors" | "evidence">;

export type LiveLexRetrievalResult = {
  sources: LegalSourceContext[];
  freshness: LegalDatabaseFreshness;
  legalDatabaseAsOf: string;
  sourceAccessMode: "direct";
  sourcesRetrievedAt: string | null;
  sourceValidationStatus: "validated" | "unavailable";
  errors: Array<{ code: string }>;
  evidence: DirectLegalSourceEvidence[];
};

export async function retrieveLiveLexSources(input: {
  query: string;
  locale: "ru" | "uz";
  limit?: number;
  signal?: AbortSignal;
  budgetMs?: number;
  searchQueries?: readonly string[] | Promise<readonly string[]>;
  knownOfficialUrls?: readonly string[];
  discoverOfficialUrls?: (query: string, locale: "ru" | "uz", signal: AbortSignal) => Promise<string[]>;
}): Promise<LiveLexRetrievalResult> {
  const result = await retrieveDirectLegalSources(input.query, input.locale, {
    limit: Math.max(1, Math.min(input.limit ?? 3, 5)),
    signal: input.signal,
    budgetMs: input.budgetMs,
    searchQueries: input.searchQueries,
    knownOfficialUrls: input.knownOfficialUrls,
    discoverOfficialUrls: input.discoverOfficialUrls,
  });
  return {
    ...result,
    errors: result.errors.map((error) => ({ code: error.code })),
  };
}

/** Compatibility adapter for background document analysis dependency injection. */
export async function retrieveLiveLexSourcesForDocument(
  _db: D1Database,
  query: string,
  locale: "ru" | "uz",
  limit?: number,
): Promise<LiveLexRetrievalResult> {
  return retrieveLiveLexSources({
    query: query.slice(0, 12_000),
    locale,
    limit,
    // Document jobs are asynchronous, but live retrieval must still be
    // bounded and never become an unbounded queue consumer.
    budgetMs: 8_000,
  });
}
