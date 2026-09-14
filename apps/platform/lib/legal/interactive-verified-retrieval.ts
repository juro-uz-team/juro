import type { LegalSourceContext } from "../legal/source-context";
import {
  legalDatabaseFreshnessFromAsOf,
  retrieveVerifiedLegalSources,
  type LegalDatabaseFreshness,
  type VerifiedLegalSourceEvidence,
} from "./verified-retrieval";

/**
 * The interactive chat path may only read already verified, locally persisted
 * legal material.  Live Lex/Advice fetching remains available to controlled
 * ingestion and staff tooling, but must never consume a user's answer budget.
 */
export type InteractiveVerifiedLegalRetrieval = {
  sources: LegalSourceContext[];
  evidence: VerifiedLegalSourceEvidence[];
  freshness: LegalDatabaseFreshness;
  legalDatabaseAsOf: string;
  sourceAccessMode: "approved_package";
  sourcesRetrievedAt: string | null;
  sourceValidationStatus: "validated" | "unavailable";
  errors: Array<{ code: string }>;
  retrievalMode: "hybrid" | "lexical";
  semanticStatus: "used" | "unavailable" | "failed";
};

function sourceRetrievedAt(sources: readonly LegalSourceContext[]): string | null {
  const timestamps = sources
    .map((source) => source.lastCheckedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  return timestamps.at(-1) ?? null;
}

export function unavailableInteractiveVerifiedLegalRetrieval(
  code = "VERIFIED_RETRIEVAL_UNAVAILABLE",
  now = new Date(),
): InteractiveVerifiedLegalRetrieval {
  const freshness = legalDatabaseFreshnessFromAsOf("unavailable", now);
  return {
    sources: [],
    evidence: [],
    freshness,
    legalDatabaseAsOf: freshness.asOf,
    sourceAccessMode: "approved_package",
    sourcesRetrievedAt: null,
    sourceValidationStatus: "unavailable",
    errors: [{ code }],
    retrievalMode: "lexical",
    semanticStatus: "unavailable",
  };
}

function aborted(signal: AbortSignal | undefined): never | null {
  if (!signal?.aborted) return null;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The request was aborted.", "AbortError");
}

/**
 * D1 does not currently expose a request-local cancellation primitive. Race
 * the bounded read against the caller's stage signal so a slow corpus
 * validation cannot hold an interactive answer hostage. The underlying read
 * is still observed and cannot create an unhandled rejection after the caller
 * has received the truthful unavailable/clarification state.
 */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  aborted(signal);
  return new Promise<T>((resolve, reject) => {
    const rejectAbort = () => reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The request was aborted.", "AbortError"),
    );
    signal.addEventListener("abort", rejectAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", rejectAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", rejectAbort);
        reject(error);
      },
    );
  });
}

/**
 * Runs a small, lexical-only D1 retrieval.  Semantic query embedding is
 * intentionally omitted: it is a network call and must not compete with the
 * initial five-second user-facing response budget.
 */
export async function retrieveInteractiveVerifiedLegalSources(input: {
  db: D1Database;
  query: string;
  locale: "ru" | "uz";
  applicableAt?: Date;
  signal?: AbortSignal;
  limit?: number;
  now?: Date;
}): Promise<InteractiveVerifiedLegalRetrieval> {
  aborted(input.signal);
  try {
    const result = await raceWithAbort(retrieveVerifiedLegalSources(
      input.db,
      input.query,
      input.locale,
      Math.max(1, Math.min(input.limit ?? 2, 2)),
      {
        now: input.now,
        applicableAt: input.applicableAt,
        // Deliberately no semantic environment: interactive retrieval only
        // reads verified D1 material and never calls an embedding provider.
      },
    ), input.signal);
    aborted(input.signal);
    return {
      sources: result.sources,
      evidence: result.evidence,
      freshness: result.freshness,
      legalDatabaseAsOf: result.legalDatabaseAsOf,
      sourceAccessMode: "approved_package",
      sourcesRetrievedAt: sourceRetrievedAt(result.sources),
      sourceValidationStatus: result.sources.length > 0 ? "validated" : "unavailable",
      errors: [],
      retrievalMode: result.retrievalMode,
      semanticStatus: result.semanticStatus,
    };
  } catch (error) {
    aborted(input.signal);
    // D1/query validation failures must not be mistaken for a verified source
    // or leak implementation details. The legal response boundary will turn
    // this into a non-chargeable clarification.
    return unavailableInteractiveVerifiedLegalRetrieval(
      error instanceof Error && error.name === "AbortError"
        ? "VERIFIED_RETRIEVAL_ABORTED"
        : "VERIFIED_RETRIEVAL_UNAVAILABLE",
      input.now,
    );
  }
}
