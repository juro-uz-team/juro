import type { LegalChatRequest, LegalSourceContext } from "../ai/provider";
import type {ServiceExecutionObservation} from "../ai/runtime-execution-observation";
import {observeCurrentLexDocument} from "../legal/lex-document-status";
import {isCurrentSourceObservation, isFreshSourceObservation, type SourceObservation} from "../legal/source-observation";
import {createSourceObservationClient} from "./source-observation-service";
import { fitsLegalEvidenceBudget } from "../legal/legal-evidence-budget";
import {
  retrieveLiveLexSources,
  type LiveLexRetrievalResult,
} from "../legal/live-lex-retrieval";
import { detectArticleNumbers } from "../legal/legal-language";
import { citationArticleNumber as targetCitationArticle } from "../legal/citation-article";
export { citationArticleNumber as targetCitationArticle } from "../legal/citation-article";
import { fetchDirectOfficialLexDocument } from "../legal/direct-retrieval";
import {scheduleOfficialDiscovery} from "../legal/official-research-schedule";
import { referencedArticleContextRequests, selectReferencedArticleContext } from "../legal/referenced-article-context";
import { readBoundedLegalSourceBytes } from "../legal/source-fetch";
import {
  legalDatabaseFreshnessFromAsOf,
  type LegalDatabaseFreshness,
} from "../legal/verified-retrieval";
import {
  createTargetLegalAnswerClient,
  TARGET_LEGAL_ANSWER_CONTRACT_VERSION,
  type TargetQuestionPlanningHints,
  type TargetLegalAnswerResult,
} from "./target-retrieval";

/** The indexed target's accepted complete-answer contract includes the shared
 * semantic planning, two bounded search/support passes and the publisher's
 * current-status check. A repair must not consume the status-check budget. */
export const LEGAL_RETRIEVAL_BUDGET_MS = 80_000;
/** Leave the caller a small margin to observe and record the target deadline. */
export const LEGAL_RETRIEVAL_STAGE_TIMEOUT_MS = LEGAL_RETRIEVAL_BUDGET_MS + 500;

export function legalRetrievalEnvironment(bindings: {
  APP_ENV?: "development" | "staging" | "production";
  LEGAL_RETRIEVAL_ENVIRONMENT?: "development" | "staging" | "production";
}): "development" | "staging" | "production" {
  return bindings.LEGAL_RETRIEVAL_ENVIRONMENT ?? bindings.APP_ENV ?? "development";
}

export type LegalChatSourceEvidence = {
  sourceId: string;
  sourceKind: "lex";
  canonicalUrl: string;
  contentSha256: string;
  retrievedAt: string;
  validatedAt: string;
  validationStatus: "validated";
};

export type LegalChatSourceRetrieval = {
  sources: LegalSourceContext[];
  coverageRequirements?: LegalChatRequest["coverageRequirements"];
  freshness: LegalDatabaseFreshness;
  legalDatabaseAsOf: string;
  sourceAccessMode: "direct" | "approved_package" | "mixed";
  sourcesRetrievedAt: string | null;
  sourceValidationStatus: "validated" | "unavailable";
  errors: Array<{ code: string }>;
  evidence: LegalChatSourceEvidence[];
  coverageStatus: "good_coverage" | "partial_coverage" | "weak_coverage" | "no_coverage";
  retrievalTelemetry?: {
    indexedHitCount: number;
    liveHitCount: number;
    queriesRun: number;
    retrievedCandidateCount: number;
    rerankCandidateCount: number;
    rerankedCandidateCount: number;
    rerankingOutcome: "not_configured" | "not_needed" | "selected" | "rejected" | "deterministic_fallback" | "failed_closed";
    rerankingFailureCode: string | null;
    exactWindowSuccesses: number;
    denseUnavailable: boolean;
    repairQueriesRun?: number;
    indexedAvailability?: "available" | "degraded" | "unavailable";
    coverageRequirements?: Array<{
      requirementId: string;
      statement: string;
      status: "covered" | "uncovered";
      provisionIds: string[];
    }>;
    selectedProvisions?: Array<{
      provisionId: string;
      chunkId: string;
      sparseRank: number | null;
      denseRank: number | null;
      semanticScore: number | null;
      fusionScore: number | null;
      selectionMethod: "semantic_reranker" | "deterministic_fallback";
      matchedQueryCount: number;
      requirementIds: string[];
    }>;
    indexVersion?: string | null;
    rerankerVersion?: string | null;
    targetOutcome?: "selected" | "unavailable" | "timed_out" | "failed";
    targetFailureCode?: "TARGET_SOURCE_UNAVAILABLE" | "TARGET_RETRIEVAL_TIMEOUT" | "TARGET_RETRIEVAL_FAILED"
      | Extract<TargetLegalAnswerResult, { safeErrorCode: string }>["safeErrorCode"] | null;
    targetLatencyMs?: number;
    targetContractVersion?: string;
    targetExecution?: ServiceExecutionObservation | null;
    contextualPlanningLatencyMs?: number;
    targetBudgetMs?: number;
    fusionOutcome: "indexed" | "live" | "mixed" | "none";
  };
};

type TargetAttemptTelemetry = Pick<
  NonNullable<LegalChatSourceRetrieval["retrievalTelemetry"]>,
  "targetOutcome" | "targetFailureCode" | "targetLatencyMs" | "contextualPlanningLatencyMs" | "targetBudgetMs" | "targetContractVersion" | "targetExecution"
>;

export function shouldRetrieveSecondaryInternet(
  retrieval: Pick<LegalChatSourceRetrieval, "coverageStatus"> & Partial<Pick<LegalChatSourceRetrieval, "sourceAccessMode" | "errors">>,
): boolean {
  if (retrieval.errors?.some(error => error.code === "QUESTION_INTERPRETATION_UNAVAILABLE"
    || error.code === "HISTORICAL_INDEXED_COVERAGE_UNAVAILABLE")) return false;
  return retrieval.coverageStatus !== "good_coverage"
    || retrieval.sourceAccessMode === "direct" || retrieval.sourceAccessMode === "mixed";
}

type LiveSearchInput = Parameters<typeof retrieveLiveLexSources>[0];

function liveCoverage(
  query: string,
  sources: readonly LegalSourceContext[],
): LegalChatSourceRetrieval["coverageStatus"] {
  if (sources.length === 0) return "no_coverage";
  const requestedArticles = detectArticleNumbers(query);
  const foundArticles = new Set(sources.map((source) => source.article).filter(Boolean));
  if (requestedArticles.some((article) => !foundArticles.has(article))) {
    return foundArticles.size > 0 ? "partial_coverage" : "weak_coverage";
  }
  // Availability and lexical relevance cannot establish semantic coverage of
  // the whole question. The answer still needs independent scoped validation.
  return sources.some((source) =>
    source.sourceClass === "OFFICIAL_LEGISLATION"
    && source.verificationState === "direct_validated"
    && source.sourceQuality?.passed
    && Boolean(source.spans?.[0]?.text.trim() || source.excerpt?.trim())
  ) ? "partial_coverage" : "weak_coverage";
}

function withLiveCoverage(
  result: LiveLexRetrievalResult,
  query: string,
  targetTelemetry?: TargetAttemptTelemetry,
): LegalChatSourceRetrieval {
  return {
    ...result,
    coverageStatus: liveCoverage(query, result.sources),
    retrievalTelemetry: {
      indexedHitCount: 0,
      liveHitCount: result.sources.length,
      queriesRun: 0,
      retrievedCandidateCount: 0,
      rerankCandidateCount: 0,
      rerankedCandidateCount: 0,
      rerankingOutcome: "not_configured",
      rerankingFailureCode: null,
      exactWindowSuccesses: 0,
      denseUnavailable: false,
      ...targetTelemetry,
      fusionOutcome: result.sources.length > 0 ? "live" : "none",
    },
  };
}

function unavailableHistoricalCoverage(
  applicableAt: string,
  now: Date,
): LegalChatSourceRetrieval {
  const checkedAt = now.toISOString();
  return {
    sources: [],
    freshness: legalDatabaseFreshnessFromAsOf(checkedAt, now),
    legalDatabaseAsOf: applicableAt,
    sourceAccessMode: "approved_package",
    sourcesRetrievedAt: null,
    sourceValidationStatus: "unavailable",
    errors: [{ code: "HISTORICAL_INDEXED_COVERAGE_UNAVAILABLE" }],
    evidence: [],
    coverageStatus: "no_coverage",
    retrievalTelemetry: {
      indexedHitCount: 0,
      liveHitCount: 0,
      queriesRun: 0,
      retrievedCandidateCount: 0,
      rerankCandidateCount: 0,
      rerankedCandidateCount: 0,
      rerankingOutcome: "failed_closed",
      rerankingFailureCode: "HISTORICAL_INDEXED_COVERAGE_UNAVAILABLE",
      exactWindowSuccesses: 0,
      denseUnavailable: false,
      indexedAvailability: "unavailable",
      fusionOutcome: "none",
    },
  };
}

function unavailablePlannedCoverage(now: Date,
  requirements: NonNullable<ReturnType<typeof targetAnswerDetails>>["coverageRequirements"] = [],
  code = "TARGET_EVIDENCE_CEILING_EXCEEDED",
): LegalChatSourceRetrieval {
  const checkedAt = now.toISOString();
  return {
    sources: [],
    freshness: legalDatabaseFreshnessFromAsOf(checkedAt, now),
    legalDatabaseAsOf: checkedAt,
    sourceAccessMode: "approved_package",
    sourcesRetrievedAt: null,
    sourceValidationStatus: "unavailable",
    errors: [{ code }],
    evidence: [],
    coverageStatus: "no_coverage",
    coverageRequirements: requirements.map(requirement => ({...requirement, priority: requirement.priority ?? "core", sourceIds: []})),
    retrievalTelemetry: {
      indexedHitCount: 0,
      liveHitCount: 0,
      queriesRun: 0,
      retrievedCandidateCount: 0,
      rerankCandidateCount: 0,
      rerankedCandidateCount: 0,
      rerankingOutcome: "failed_closed",
      rerankingFailureCode: code,
      exactWindowSuccesses: 0,
      denseUnavailable: false,
      indexedAvailability: code === "QUESTION_INTERPRETATION_UNAVAILABLE" ? "unavailable" : "available",
      fusionOutcome: "none",
    },
  };
}

function targetAnswerDetails(result: TargetLegalAnswerResult, locale: "ru" | "uz") {
  const endpointLabel = (endpoint: { kind: "current" } | { kind: "timestamp"; instant: string }) =>
    endpoint.kind === "timestamp" ? endpoint.instant.slice(0, 10)
      : locale === "ru" ? "Действующая редакция" : "Amaldagi tahrir";
  if (result.kind === "legal_answer" || result.kind === "conditional_answer"
    || result.kind === "partial_legal_answer") {
    return {
      statements: result.whatTheLawSays.map((statement) => ({
        statement,
        temporalEndpoint: result.temporalEndpoint,
      })),
      formulationsUsed: result.formulationsUsed,
      partial: result.kind === "partial_legal_answer",
      uncoveredRequirementIds: result.kind === "partial_legal_answer"
        ? result.uncoveredSupportingRequirementIds : [],
      coverageRequirements: result.coverageRequirements ?? [],
    };
  }
  if (result.kind === "comparison_answer") {
    return {
      statements: [
        ...result.left.whatTheLawSays.map((statement) => ({
          statement: { ...statement, requirementId: `left:${statement.requirementId}` },
          temporalEndpoint: result.left.temporalEndpoint,
        })),
        ...result.right.whatTheLawSays.map((statement) => ({
          statement: { ...statement, requirementId: `right:${statement.requirementId}` },
          temporalEndpoint: result.right.temporalEndpoint,
        })),
      ],
      formulationsUsed: result.endpointFormulationSearches,
      partial: false,
      uncoveredRequirementIds: [],
      coverageRequirements: [
        ...(result.left.coverageRequirements ?? []).map(requirement => ({
          ...requirement, id: `left:${requirement.id}`,
          statement: `${endpointLabel(result.left.temporalEndpoint)}: ${requirement.statement}`,
        })),
        ...(result.right.coverageRequirements ?? []).map(requirement => ({
          ...requirement, id: `right:${requirement.id}`,
          statement: `${endpointLabel(result.right.temporalEndpoint)}: ${requirement.statement}`,
        })),
      ],
    };
  }
  return null;
}

function uniqueTargetStatements(
  answer: NonNullable<ReturnType<typeof targetAnswerDetails>>,
) {
  const unique = new Map<string, (typeof answer.statements)[number]>();
  for (const entry of answer.statements) {
    const endpointKey = entry.temporalEndpoint.kind === "timestamp"
      ? entry.temporalEndpoint.instant
      : "current";
    const key = `${entry.statement.provisionRenditionId}:${endpointKey}`;
    if (!unique.has(key)) {
      unique.set(key, entry);
    }
  }
  return [...unique.values()];
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function withinSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", aborted);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", aborted);
      reject(error);
    });
  });
}

async function withTargetCoverage(
  result: TargetLegalAnswerResult,
  locale: "ru" | "uz",
  now: Date,
  verifyCurrentSource: (url: string) => Promise<SourceObservation>,
  clock: () => number,
): Promise<LegalChatSourceRetrieval | null> {
  if (result.kind === "clarification_required" && result.safeErrorCode === "EVIDENCE_CEILING_EXCEEDED") {
    return unavailablePlannedCoverage(now, result.coverageRequirements);
  }
  const answer = targetAnswerDetails(result, locale);
  if (!answer) return null;
  const checkedAt = now.toISOString();
  const candidates = uniqueTargetStatements(answer);
  if (!fitsLegalEvidenceBudget(candidates.map(entry => entry.statement.controllingQuotation))) {
    return unavailablePlannedCoverage(now, answer.coverageRequirements);
  }
  const urls = [...new Set(candidates.filter((entry) => entry.temporalEndpoint.kind === "current")
    .map((entry) => entry.statement.officialCitations[0]!.url))];
  const observations = new Map(await Promise.all(urls.map(async (url) => {
    const checked = candidates.map(entry => entry.statement.currentSourceStatus?.observation)
      .filter(observation => isFreshSourceObservation(observation, url, clock()))
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
    if (checked) return [url, checked] as const;
    try { return [url, await verifyCurrentSource(url)] as const; }
    catch { return [url, null] as const; }
  })));
  type Statement = (typeof candidates)[number]["statement"];
  const statusKey = (statement: Statement) => JSON.stringify([statement.officialCitations[0]!.url,
    statement.currentSourceStatus?.pinnedTextSha256 ?? null]);
  const statuses = new Map(candidates.map(({statement}) => {
    const url = statement.officialCitations[0]!.url;
    const observation = observations.get(url);
    const expected = statement.currentSourceStatus?.pinnedTextSha256;
    const status = !expected || !isFreshSourceObservation(observation, url, clock()) ? "unavailable"
      : !observation.current ? "repealed" : isCurrentSourceObservation(observation,
        {officialUrl: url, normalizedTextSha256: expected, now: clock()}) ? "current" : "changed_revision";
    return [statusKey(statement), status] as const;
  }));
  const statements = candidates.filter((entry) => entry.temporalEndpoint.kind !== "current"
    || statuses.get(statusKey(entry.statement)) === "current");
  const droppedCurrent = statements.length !== candidates.length;
  if (droppedCurrent) console.warn(JSON.stringify({ event: "legal.current_source_status_filtered",
    candidateProvisionCount: candidates.length, retainedProvisionCount: statements.length,
    unavailableDocuments: [...statuses.values()].filter((status) => status === "unavailable").length,
    repealedDocuments: [...statuses.values()].filter((status) => status === "repealed").length,
    changedRevisions: [...statuses.values()].filter((status) => status === "changed_revision").length }));
  if (!fitsLegalEvidenceBudget(statements.map(entry => entry.statement.controllingQuotation))) {
    return unavailablePlannedCoverage(now, answer.coverageRequirements);
  }
  const sources = await Promise.all(statements.map(async (
    { statement, temporalEndpoint },
  ): Promise<LegalSourceContext> => {
    const historicalInstant = temporalEndpoint.kind === "timestamp"
      ? temporalEndpoint.instant
      : null;
    const citation = statement.officialCitations[0]!;
    const observedAt = historicalInstant ? checkedAt : observations.get(citation.url)!.observedAt;
    const endpointKey = historicalInstant ?? "current";
    const idHash = await sha256Text(`${statement.provisionRenditionId}:${endpointKey}`);
    const id = `target:${idHash.slice(0, 48)}`;
    const textSha256 = await sha256Text(statement.controllingQuotation);
    return {
        id,
        actTitle: citation.label.split(" — ")[0]?.trim() || citation.label,
        actIdentifier: null,
        officialUrl: citation.url,
        revisionDate: historicalInstant,
        lastCheckedAt: observedAt,
        locale: statement.evidenceLocator ? {ru: "ru", "uz-Latn": "uz", "uz-Cyrl": "uzc", en: "en"}[statement.evidenceLocator.languageTag] : locale,
        publishedAt: null,
        sourceType: "lex",
        status: "verified",
        verificationState: "verified",
        verifiedAt: observedAt,
        ...(!historicalInstant && statement.currentSourceStatus ? {currentSourceStatus: {
          ...statement.currentSourceStatus, observation: observations.get(citation.url)!,
        }} : {}),
        contentSha256: statement.evidenceSha256,
        ...(statement.evidenceLocator ? {citationEvidenceReceipt: {...statement.evidenceLocator, textSha256}} : {}),
        article: targetCitationArticle(citation.label, statement.controllingQuotation),
        excerpt: statement.controllingQuotation.slice(0, 1_200),
        effectiveDate: historicalInstant,
        applicabilityStatus: historicalInstant ? "historical" : "current",
        sourceClass: "OFFICIAL_LEGISLATION",
        retrievalSelection: "semantic_reranker",
        spans: [{
          id,
          article: targetCitationArticle(citation.label, statement.controllingQuotation),
          paragraph: null,
          text: statement.controllingQuotation,
          textSha256,
          quality: "high",
        }],
        sourceQuality: {
          passed: true,
          title: true,
          sufficientText: true,
          clean: true,
          locale: true,
          canonicalUrl: true,
          structured: true,
        },
    };
  }));
  if (sources.length === 0 && !droppedCurrent) return null;
  const freshness = legalDatabaseFreshnessFromAsOf(checkedAt, now);
  const provisionsByRequirement = new Map<string, Set<string>>();
  for (const { statement } of answer.statements.filter((entry) =>
    entry.temporalEndpoint.kind !== "current"
      || statuses.get(statusKey(entry.statement)) === "current")) {
    const provisions = provisionsByRequirement.get(statement.requirementId) ?? new Set<string>();
    provisions.add(statement.provisionRenditionId);
    provisionsByRequirement.set(statement.requirementId, provisions);
  }
  return {
    sources,
    freshness,
    legalDatabaseAsOf: freshness.asOf,
    sourceAccessMode: "approved_package",
    coverageRequirements: answer.coverageRequirements.map(requirement => ({
      id: requirement.id, statement: requirement.statement, priority: requirement.priority ?? "core",
      ...(requirement.scopeKind ? {scopeKind: requirement.scopeKind} : {}),
      ...(requirement.origin ? {origin: requirement.origin} : {}),
      ...(requirement.unresolvedDimensions ? {unresolvedDimensions: requirement.unresolvedDimensions} : {}),
      ...(requirement.questionContext ? {questionContext: requirement.questionContext} : {}),
      sourceIds: statements.flatMap((entry, index) => answer.statements.some(candidate =>
        candidate.statement.requirementId === requirement.id
        && candidate.statement.provisionRenditionId === entry.statement.provisionRenditionId)
        ? [sources[index]!.id] : []),
    })),
    sourcesRetrievedAt: checkedAt,
    sourceValidationStatus: sources.length ? "validated" : "unavailable",
    errors: droppedCurrent ? [{ code: [...statuses.values()].includes("unavailable")
      ? "LEGAL_SOURCE_CURRENT_STATUS_UNAVAILABLE" : [...statuses.values()].includes("changed_revision")
        ? "LEGAL_SOURCE_REVISION_CHANGED" : "LEGAL_SOURCE_DOCUMENT_REPEALED" }] : [],
    evidence: sources.map((source) => ({
      sourceId: source.id,
      sourceKind: "lex",
      canonicalUrl: source.officialUrl,
      contentSha256: source.contentSha256,
      retrievedAt: checkedAt,
      validatedAt: source.verifiedAt ?? checkedAt,
      validationStatus: "validated",
    })),
    coverageStatus: answer.partial || droppedCurrent ? "partial_coverage" : "good_coverage",
    retrievalTelemetry: {
      indexedHitCount: sources.length,
      liveHitCount: 0,
      queriesRun: answer.formulationsUsed,
      retrievedCandidateCount: sources.length,
      rerankCandidateCount: sources.length,
      rerankedCandidateCount: sources.length,
      rerankingOutcome: "selected",
      rerankingFailureCode: null,
      exactWindowSuccesses: sources.length,
      denseUnavailable: false,
      indexedAvailability: "available",
      coverageRequirements: [
        ...[...provisionsByRequirement].map(([requirementId, provisionIds]) => ({
          requirementId,
          statement: "",
          status: "covered" as const,
          provisionIds: [...provisionIds],
        })),
        ...answer.uncoveredRequirementIds.map((requirementId) => ({
          requirementId,
          statement: "",
          status: "uncovered" as const,
          provisionIds: [],
        })),
      ],
      indexVersion: "r2-native-accepted",
      rerankerVersion: "target-provision-selector",
      fusionOutcome: "indexed",
    },
  };
}

async function completeArticleContexts(retrieval: LegalChatSourceRetrieval, options: {
  locale: "ru" | "uz"; signal?: AbortSignal; budgetMs: number;
  reader?: typeof fetchDirectOfficialLexDocument;
  onStarted?: () => void | Promise<void>;
  onlyIncompleteArticles?: boolean;
}): Promise<LegalChatSourceRetrieval> {
  const requests = referencedArticleContextRequests(retrieval.sources, options.onlyIncompleteArticles);
  if (requests.length === 0) return retrieval;
  await options.onStarted?.();
  const reader = options.reader ?? fetchDirectOfficialLexDocument;
  // Multiple references into one public document share the response bytes in
  // this request only. Each resulting article retains its own validated spans.
  const fetches = new Map<string, Promise<{ bytes: ArrayBuffer; status: number; headers: Headers }>>();
  const sharedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "object" && "url" in input ? input.url : String(input);
    // Keep robots.txt on the fetcher's smaller original byte limit.
    if (new URL(url).pathname === "/robots.txt") return fetch(input, init);
    const key = `${init?.method ?? "GET"}:${url}`;
    let pending = fetches.get(key);
    if (!pending) {
      pending = fetch(input, init).then(async response => ({
        bytes: new Uint8Array(await readBoundedLegalSourceBytes(response, 16 * 1024 * 1024,
          Math.max(1, Math.floor(Math.min(6_000, options.budgetMs))))).buffer,
        status: response.status, headers: response.headers,
      }));
      fetches.set(key, pending);
    }
    const response = await pending;
    return new Response(response.bytes.slice(0), { status: response.status, headers: response.headers });
  };
  const contexts = await Promise.all(requests.map(async request => {
    try {
      const fetched = await reader(request.url, options.locale, {
        query: `Article ${request.article}`, completeArticle: true, signal: options.signal, fetchImpl: sharedFetch,
        budgetMs: Math.max(1, Math.floor(Math.min(6_000, options.budgetMs))),
      });
      const source = selectReferencedArticleContext(fetched.source, request.article);
      return source ? { source, evidence: { ...fetched.evidence, sourceId: source.id } } : null;
    } catch { return null; }
  }));
  const completed = contexts.filter(context => context !== null);
  retrieval.sources.push(...completed.map(context => context.source));
  retrieval.evidence.push(...completed.map(context => context.evidence));
  retrieval.sourceAccessMode = "direct";
  retrieval.retrievalTelemetry = { ...retrieval.retrievalTelemetry!,
    liveHitCount: (retrieval.retrievalTelemetry?.liveHitCount ?? 0) + completed.length,
    fusionOutcome: retrieval.retrievalTelemetry?.indexedHitCount ? "mixed" : "live" };
  if (completed.length !== requests.length) {
    retrieval.coverageStatus = "partial_coverage";
    retrieval.errors.push({ code: "LEGAL_REFERENCED_ARTICLE_UNAVAILABLE" });
  }
  return retrieval;
}

/**
 * Retrieves hash-verified evidence through the R2-native sparse+dense target
 * service. Current requests continue to direct Lex when indexed evidence is
 * unavailable or insufficient; historical requests fail closed because live
 * retrieval is not applicability-aware. The retired D1/Qdrant protocol is absent.
 */
export async function retrieveCorpusAwareLegalSources(input: {
  query: string;
  locale: "ru" | "uz";
  targetService?: Fetcher;
  targetEnvironment?: "development" | "staging" | "production";
  targetQuestionId?: string;
  priorUserQuestions?: readonly string[];
  targetPlanningHints?: TargetQuestionPlanningHints | Promise<TargetQuestionPlanningHints | undefined>;
  requirePlanningHints?: boolean;
  verifyCurrentSource?: (url: string) => Promise<SourceObservation>;
  clock?: () => number;
  articleContextReader?: typeof fetchDirectOfficialLexDocument;
  contextualQuestion?: string | Promise<string>;
  applicableAt?: string;
  lexSearchQueries?: readonly string[] | Promise<readonly string[]>;
  limit?: number;
  signal?: AbortSignal;
  budgetMs?: number;
  targetBudgetMs?: number;
  discoverOfficialUrls?: LiveSearchInput["discoverOfficialUrls"];
  /** Generic indexed-latency signal; never changes either branch's deadline. */
  officialDiscoveryDelayMs?: number;
  liveSearch?: typeof retrieveLiveLexSources;
  onLiveSearchStarted?: () => void | Promise<void>;
  now?: Date;
}): Promise<LegalChatSourceRetrieval> {
  input.signal?.throwIfAborted();
  const retrievalStartedAt = performance.now();
  let targetTelemetry: TargetAttemptTelemetry | undefined;
  let partialIndexed: LegalChatSourceRetrieval | null = null;
  let rejectedIndexedErrors: LegalChatSourceRetrieval["errors"] = [];
  let discoveredOfficialUrls: string[] = [];
  let coverageRequirements: LegalChatRequest["coverageRequirements"] = [];
  const contextualPlanningStartedAt = performance.now();
  const planningPromise = Promise.all([
      Promise.resolve(input.contextualQuestion).catch(() => undefined),
      Promise.resolve(input.targetPlanningHints).catch(() => undefined),
    ]);
  const [contextualQuestion, planningHints] = input.signal
      ? await withinSignal(planningPromise, input.signal)
      : await planningPromise;
  input.signal?.throwIfAborted();
  if (input.requirePlanningHints && !planningHints) {
    return unavailablePlannedCoverage(input.now ?? new Date(), [], "QUESTION_INTERPRETATION_UNAVAILABLE");
  }
  const applicableAt = input.applicableAt ?? (planningHints?.temporalEndpoint?.kind === "timestamp"
    ? planningHints.temporalEndpoint.instant : undefined);
  coverageRequirements = planningHints?.requirements.map((requirement, index) => ({
      id: `requirement-${index + 1}`, ...requirement, sourceIds: [],
    })) ?? [];
  const contextualPlanningLatencyMs = Math.max(0, performance.now() - contextualPlanningStartedAt);
  const discoverySchedule = planningHints && input.targetService && input.discoverOfficialUrls && !applicableAt && !planningHints.comparison
    ? scheduleOfficialDiscovery({
      query: Promise.resolve(input.lexSearchQueries ?? []).catch(() => []).then(queries => [...new Set([input.query,
        ...queries.map(query => query.replace(/\s+/gu, " ").trim().slice(0, 240)).filter(Boolean)])].slice(0, 4).join("\n").slice(0, 500)),
      locale: input.locale, discover: input.discoverOfficialUrls,
      delayMs: input.officialDiscoveryDelayMs ?? 2_000, signal: input.signal, requestId: input.targetQuestionId,
    }) : null;
  try {
  if (input.targetService && input.targetEnvironment && input.targetQuestionId) {
    const remainingBudgetMs = Math.max(
      1,
      Math.floor((input.budgetMs ?? 12_000) - (performance.now() - retrievalStartedAt)),
    );
    const targetTimeoutMs = Math.max(1, Math.min(
      input.targetBudgetMs ?? remainingBudgetMs,
      remainingBudgetMs,
    ));
    const targetController = new AbortController();
    const abortFromCaller = () => targetController.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const targetTimer = setTimeout(() => targetController.abort(
      new DOMException("Target retrieval deadline exceeded", "TimeoutError"),
    ), targetTimeoutMs);
    const targetStartedAt = performance.now();
    let targetExecution: ServiceExecutionObservation | null = null;
    try {
      const target = await withinSignal(createTargetLegalAnswerClient({
          service: input.targetService,
          environment: input.targetEnvironment,
          signal: targetController.signal,
          onExecutionObserved: observation => {targetExecution = observation;},
        }).answer({
          id: input.targetQuestionId,
          question: input.query,
          contextualQuestion,
          priorUserQuestions: input.priorUserQuestions?.slice(-6),
          planningHints,
          applicableAt,
        }), targetController.signal);
      if (target.kind === "source_unavailability" && target.safeErrorCode === "QUESTION_INTERPRETATION_UNAVAILABLE") {
        return unavailablePlannedCoverage(input.now ?? new Date(), target.coverageRequirements, target.safeErrorCode);
      }
      if (target.kind === "insufficient_indexed_coverage" || target.kind === "source_unavailability") {
        discoveredOfficialUrls = target.discoveredOfficialUrls ?? [];
        if (target.coverageRequirements?.length) coverageRequirements = target.coverageRequirements.map(requirement => ({
          id: requirement.id, statement: requirement.statement, priority: requirement.priority ?? "core", sourceIds: [],
          ...(requirement.scopeKind ? {scopeKind: requirement.scopeKind} : {}),
          ...(requirement.origin ? {origin: requirement.origin} : {}),
          ...(requirement.unresolvedDimensions ? {unresolvedDimensions: requirement.unresolvedDimensions} : {}),
          ...(requirement.questionContext ? {questionContext: requirement.questionContext} : {}),
        }));
      }
      const selectedRequirements = targetAnswerDetails(target, input.locale)?.coverageRequirements;
      if (selectedRequirements?.length) coverageRequirements = selectedRequirements.map(requirement => ({
        ...requirement, priority: requirement.priority ?? "core", sourceIds: [],
      }));
      let indexed = await withTargetCoverage(target, input.locale, input.now ?? new Date(),
        input.verifyCurrentSource ?? (input.targetService && input.targetEnvironment
          ? createSourceObservationClient({service: input.targetService, environment: input.targetEnvironment})
          : observeCurrentLexDocument), input.clock ?? Date.now);
      if (indexed?.coverageStatus === "partial_coverage" && indexed.sources.length === 0) {
        rejectedIndexedErrors = indexed.errors;
        indexed = null;
      }
      if (indexed) {
        indexed.retrievalTelemetry = {
          ...indexed.retrievalTelemetry!,
          targetOutcome: "selected",
          targetContractVersion: TARGET_LEGAL_ANSWER_CONTRACT_VERSION,
          targetExecution,
          targetFailureCode: null,
          targetLatencyMs: Math.max(0, performance.now() - targetStartedAt),
          contextualPlanningLatencyMs,
          targetBudgetMs: targetTimeoutMs,
        };
        if (indexed.coverageStatus === "good_coverage") {
          if (!applicableAt && !planningHints?.comparison) await completeArticleContexts(indexed, {
            locale: input.locale, signal: targetController.signal,
            budgetMs: targetTimeoutMs - (performance.now() - targetStartedAt),
            reader: input.articleContextReader, onStarted: input.onLiveSearchStarted,
            // The selector has already assessed material references and used
            // its bounded repair. Do not discover unrelated references again
            // after complete indexed coverage; recover only truncated text.
            onlyIncompleteArticles: true,
          });
          if (indexed.coverageStatus === "good_coverage") return indexed;
        }
        if (indexed.coverageStatus === "partial_coverage") {
          partialIndexed = indexed;
          targetTelemetry = {
            targetOutcome: "selected",
            targetContractVersion: TARGET_LEGAL_ANSWER_CONTRACT_VERSION,
            targetExecution,
            targetFailureCode: null,
            targetLatencyMs: Math.max(0, performance.now() - targetStartedAt),
            contextualPlanningLatencyMs,
            targetBudgetMs: targetTimeoutMs,
          };
        } else {
          return indexed;
        }
      }
      if (!indexed) targetTelemetry = {
        targetContractVersion: TARGET_LEGAL_ANSWER_CONTRACT_VERSION,
        targetExecution,
        targetOutcome: "unavailable",
        targetFailureCode: "safeErrorCode" in target ? target.safeErrorCode : "TARGET_SOURCE_UNAVAILABLE",
        targetLatencyMs: Math.max(0, performance.now() - targetStartedAt),
        contextualPlanningLatencyMs,
        targetBudgetMs: targetTimeoutMs,
      };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      const timedOut = targetController.signal.aborted;
      targetTelemetry = {
        targetExecution,
        targetOutcome: timedOut ? "timed_out" : "failed",
        targetFailureCode: timedOut ? "TARGET_RETRIEVAL_TIMEOUT" : "TARGET_RETRIEVAL_FAILED",
        targetLatencyMs: Math.max(0, performance.now() - targetStartedAt),
        contextualPlanningLatencyMs,
        targetBudgetMs: targetTimeoutMs,
      };
    } finally {
      clearTimeout(targetTimer);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
  if (applicableAt || planningHints?.comparison) {
    const comparisonEndpoint = planningHints?.comparison?.left.kind === "timestamp" ? planningHints.comparison.left
      : planningHints?.comparison?.right.kind === "timestamp" ? planningHints.comparison.right : undefined;
    const historical = unavailableHistoricalCoverage(applicableAt ?? comparisonEndpoint?.instant ?? (input.now ?? new Date()).toISOString(), input.now ?? new Date());
    historical.coverageRequirements = coverageRequirements;
    historical.retrievalTelemetry = {
      ...historical.retrievalTelemetry!,
      ...targetTelemetry,
    };
    return historical;
  }
  await input.onLiveSearchStarted?.();
  const liveSearch = input.liveSearch ?? retrieveLiveLexSources;
  const result = await liveSearch({
    query: input.query,
    locale: input.locale,
    limit: input.limit,
    signal: input.signal,
    budgetMs: input.budgetMs === undefined
      ? undefined
      : Math.max(1, Math.floor(input.budgetMs - (performance.now() - retrievalStartedAt))),
    searchQueries: Promise.resolve(input.lexSearchQueries ?? []).catch(() => []),
    knownOfficialUrls: discoveredOfficialUrls,
    discoverOfficialUrls: discoverySchedule?.discover ?? input.discoverOfficialUrls,
  });
  const live = withLiveCoverage(result, input.query, targetTelemetry);
  // A live source may answer a different scope; only final answer validation
  // establishes completeness. Failure notices are rendered for incomplete answers.
  live.errors = [...rejectedIndexedErrors, ...live.errors];
  live.coverageRequirements = coverageRequirements;
  const complete = (retrieval: LegalChatSourceRetrieval) => completeArticleContexts(retrieval, {
    locale: input.locale, signal: input.signal, reader: input.articleContextReader,
    budgetMs: (input.budgetMs ?? 12_000) - (performance.now() - retrievalStartedAt),
  });
  if (!partialIndexed) return complete(live);
  const sources = [...partialIndexed.sources];
  // Different articles in the same instrument are independent evidence.
  const sourceIdentity = (source: LegalChatSourceRetrieval["sources"][number]) =>
    JSON.stringify([source.officialUrl, source.article, source.spans?.map(span => span.text), source.excerpt]);
  const known = new Set(sources.map(sourceIdentity));
  for (const source of live.sources) {
    const identity = sourceIdentity(source);
    if (!known.has(identity)) {
      sources.push(source);
      known.add(identity);
    }
  }
  const evidence = [...partialIndexed.evidence];
  const evidenceKeys = new Set(evidence.map((entry) => `${entry.canonicalUrl}:${entry.contentSha256}`));
  for (const entry of live.evidence) {
    const key = `${entry.canonicalUrl}:${entry.contentSha256}`;
    if (!evidenceKeys.has(key)) evidence.push(entry);
  }
  return complete({
    ...partialIndexed,
    sources,
    evidence,
    errors: [...partialIndexed.errors, ...live.errors],
    coverageStatus: "partial_coverage",
    retrievalTelemetry: {
      ...partialIndexed.retrievalTelemetry!,
      ...targetTelemetry,
      liveHitCount: live.sources.length,
      fusionOutcome: live.sources.length > 0 ? "mixed" : "indexed",
    },
  });
  } finally {
    await discoverySchedule?.close();
  }
}
