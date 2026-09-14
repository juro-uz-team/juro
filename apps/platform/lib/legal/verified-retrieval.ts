import type { LegalSourceContext } from "../legal/source-context";
import { legalSourceLifecycleEvidenceSchema } from "./source-lifecycle";
import { legalSourcePublicationEvidenceSchema } from "./source-publication";
import { legalSourceApplicabilityEvidenceSchema } from "./source-review";
import { filterVerifiedLexSources } from "./source-trust";
import { rankSparseBm25, reciprocalRankFusion } from "./hybrid-ranking";
import { normalizeLegalSearchQuery } from "./legal-language";
import {
  semanticLegalChunkRanks,
  type LegalSemanticSearchEnv,
} from "./semantic-retrieval";
import { uzbekistanCalendarDate } from "./applicability-date";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_FRESHNESS_AGE_DAYS = 7;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
// The lexical query expands each term over six fields and up to three
// locale-aware casing forms. Keep the combined lexical + semantic binding
// budget deliberately small for D1, rather than relying on SQLite defaults.
const MAX_RETRIEVAL_LEXICAL_KEYWORDS = 4;
const MAX_RETRIEVAL_SEMANTIC_VECTOR_IDS = 16;

export type LegalDatabaseFreshnessStatus = "fresh" | "stale" | "unavailable";

export type LegalDatabaseFreshness = {
  status: LegalDatabaseFreshnessStatus;
  asOf: string;
  ageDays: number | null;
  maxAgeDays: number;
};

export type VerifiedLegalSourceEvidence = {
  sourceId: string;
  versionId: string;
  publicationId: string;
  publicationEvidenceSha256: string;
  lifecycleEventId: string;
  lifecycleEvidenceSha256: string;
  sectionId: string;
  sectionContentSha256: string;
};

export type VerifiedLegalRetrieval = {
  sources: LegalSourceContext[];
  evidence: VerifiedLegalSourceEvidence[];
  freshness: LegalDatabaseFreshness;
  legalDatabaseAsOf: string;
  retrievalMode: "hybrid" | "lexical";
  semanticStatus: "used" | "unavailable" | "failed";
  applicableAt: string;
};

export type CorpusSyncRow = {
  sourceKind: string;
  finishedAt: string | null;
};

export type PublishedReadingEvidenceRow = {
  sectionId: string;
  canonicalRef: string | null;
  article: string | null;
  heading: string | null;
  bodyText: string;
  sequence: number;
  sectionContentSha256: string;
  chunkId: string;
  chunkIndex: number;
  chunkLanguage: string;
  chunkContentText: string;
  chunkContentSha256: string;
  vectorId: string | null;
  indexedAt: string | null;
};

export type VerifiedLegalSourceEvidenceRow = PublishedReadingEvidenceRow & {
  id: string;
  officialUrl: string;
  canonicalId: string | null;
  actTitle: string;
  actIdentifier: string | null;
  publishedAt: string | null;
  revisionDate: string | null;
  lastCheckedAt: string;
  locale: string;
  sourceType: string;
  status: string;
  verificationState: string;
  sourceVerifiedAt: string | null;
  sourceContentSha256: string | null;
  sourceVerifiedByUserId: string | null;
  sourceVerificationNotes: string | null;
  sourceEffectiveAt: string | null;
  sourceExpiresAt: string | null;
  versionId: string;
  versionLanguage: string;
  versionStatus: string;
  versionContentSha256: string;
  versionVerifiedAt: string | null;
  versionVerifiedByUserId: string | null;
  versionEffectiveAt: string | null;
  versionExpiresAt: string | null;
  publicationId: string;
  reviewId: string;
  reviewEvidenceSha256: string;
  publicationRawContentSha256: string;
  publicationParsedContentSha256: string;
  publishedByUserId: string;
  publicationEvidenceJson: string;
  publicationEvidenceSha256: string;
  publicationPublishedAt: string;
  activationActivatedByUserId: string;
  activationActivatedAt: string;
  lifecycleEventId: string;
  lifecycleEventType: string;
  lifecyclePreviousPublicationId: string | null;
  lifecyclePreviousVersionId: string | null;
  lifecycleReasonNotes: string | null;
  lifecycleActedByUserId: string;
  lifecycleActorSessionId: string;
  lifecycleActorAssignmentIdsJson: string;
  lifecycleMfaVerifiedAt: string;
  lifecycleEvidenceJson: string;
  lifecycleEvidenceSha256: string;
  lifecycleOccurredAt: string;
  sectionCount: number;
  chunkCount: number;
  applicabilityId: string | null;
  applicabilityEffectiveAt: string | null;
  applicabilityExpiresAt: string | null;
  applicabilityReviewedByUserId: string | null;
  applicabilityReviewerSessionId: string | null;
  applicabilityMfaVerifiedAt: string | null;
  applicabilityEvidenceJson: string | null;
  applicabilityEvidenceSha256: string | null;
  applicabilityCreatedAt: string | null;
  supersedingApplicabilityEffectiveAt: string | null;
  supersedingApplicabilityEvidenceJson: string | null;
  supersedingApplicabilityEvidenceSha256: string | null;
  supersessionLifecycleEvidenceJson: string | null;
  supersessionLifecycleEvidenceSha256: string | null;
};

function unavailableFreshness(): LegalDatabaseFreshness {
  return {
    status: "unavailable",
    asOf: "unavailable",
    ageDays: null,
    maxAgeDays: MAX_FRESHNESS_AGE_DAYS,
  };
}

function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function legalDatabaseFreshnessFromAsOf(
  asOf: string,
  now = new Date(),
): LegalDatabaseFreshness {
  const asOfTime = validTime(asOf);
  if (asOfTime === null || asOfTime > now.getTime() + MAX_CLOCK_SKEW_MS) {
    return unavailableFreshness();
  }
  const ageMs = Math.max(0, now.getTime() - asOfTime);
  return {
    status: ageMs > MAX_FRESHNESS_AGE_DAYS * DAY_MS ? "stale" : "fresh",
    asOf: new Date(asOfTime).toISOString(),
    ageDays: Math.floor(ageMs / DAY_MS),
    maxAgeDays: MAX_FRESHNESS_AGE_DAYS,
  };
}

export function legalDatabaseFreshnessFromCorpusRuns(
  rows: readonly CorpusSyncRow[],
  now = new Date(),
): LegalDatabaseFreshness {
  const latest = new Map<"lex", string>();
  for (const row of rows) {
    if (row.sourceKind !== "lex") continue;
    const timestamp = validTime(row.finishedAt);
    if (timestamp === null || timestamp > now.getTime() + MAX_CLOCK_SKEW_MS) continue;
    const existing = latest.get(row.sourceKind);
    if (!existing || timestamp > Date.parse(existing)) {
      latest.set(row.sourceKind, new Date(timestamp).toISOString());
    }
  }
  const lex = latest.get("lex");
  return lex ? legalDatabaseFreshnessFromAsOf(lex, now) : unavailableFreshness();
}

export function legalSearchKeywords(
  value: string,
  locale: "ru" | "uz",
  limit = MAX_RETRIEVAL_LEXICAL_KEYWORDS,
): string[] {
  return [...new Set(
    normalizeLegalSearchQuery(value, locale)
      .slice(0, 80_000)
      .toLocaleLowerCase(locale === "ru" ? "ru" : "uz")
      // Act, article, and clause identifiers can be short numbers. Keep them
      // for exact official-metadata matching while bounding their length.
      .match(/[\p{L}\p{N}]{5,}|\p{N}{1,10}/gu) ?? [],
  )].slice(0, Math.max(1, Math.min(12, limit)));
}

/**
 * SQLite's built-in lower()/NOCASE handling is ASCII-only. Source titles and
 * headings are official RU/UZ text, so bind a small set of Unicode case
 * variants instead of treating lower(column) as a case-folding guarantee.
 */
export function legalSearchPatterns(
  keyword: string,
  locale: "ru" | "uz",
): string[] {
  const language = locale === "ru" ? "ru" : "uz";
  const characters = Array.from(keyword);
  const titleCase = characters.length
    ? `${characters[0]!.toLocaleUpperCase(language)}${characters.slice(1).join("")}`
    : keyword;
  return [...new Set([
    keyword,
    titleCase,
    keyword.toLocaleUpperCase(language),
  ])];
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function validateReadingRows(
  row: VerifiedLegalSourceEvidenceRow,
  readingRows: readonly PublishedReadingEvidenceRow[],
): Promise<boolean> {
  if (
    readingRows.length !== row.sectionCount
    || row.sectionCount !== row.chunkCount
    || readingRows.length < 1
    || readingRows.length > 300
  ) return false;
  const sectionIds = new Set<string>();
  const sequences = new Set<number>();
  let matchedSection = false;
  for (const reading of readingRows) {
    if (
      !reading.sectionId
      || !reading.chunkId
      || !reading.canonicalRef
      || reading.bodyText.length < 1
      || reading.bodyText.length > 8_000
      || reading.chunkContentText !== reading.bodyText
      || reading.chunkContentSha256 !== reading.sectionContentSha256
      || reading.chunkIndex !== reading.sequence
      || reading.chunkLanguage !== row.locale
      || sectionIds.has(reading.sectionId)
      || sequences.has(reading.sequence)
      || await sha256Text(reading.bodyText) !== reading.sectionContentSha256
    ) return false;
    sectionIds.add(reading.sectionId);
    sequences.add(reading.sequence);
    matchedSection ||= reading.sectionId === row.sectionId
      && reading.sectionContentSha256 === row.sectionContentSha256;
  }
  return matchedSection;
}

export async function validateVerifiedLegalSourceEvidence(
  row: VerifiedLegalSourceEvidenceRow,
  readingRows: readonly PublishedReadingEvidenceRow[],
  now = new Date(),
  applicability: "current" | "historical" = "current",
): Promise<{ source: LegalSourceContext; evidence: VerifiedLegalSourceEvidence } | null> {
  const publication = legalSourcePublicationEvidenceSchema.safeParse(
    parseJson(row.publicationEvidenceJson),
  );
  const lifecycle = legalSourceLifecycleEvidenceSchema.safeParse(
    parseJson(row.lifecycleEvidenceJson),
  );
  const applicabilityEvidence = row.applicabilityEvidenceJson
    ? legalSourceApplicabilityEvidenceSchema.safeParse(parseJson(row.applicabilityEvidenceJson))
    : null;
  const supersedingApplicabilityEvidence = row.supersedingApplicabilityEvidenceJson
    ? legalSourceApplicabilityEvidenceSchema.safeParse(
      parseJson(row.supersedingApplicabilityEvidenceJson),
    )
    : null;
  const supersessionLifecycleEvidence = row.supersessionLifecycleEvidenceJson
    ? legalSourceLifecycleEvidenceSchema.safeParse(
      parseJson(row.supersessionLifecycleEvidenceJson),
    )
    : null;
  const supersessionIsVerified = Boolean(
    supersedingApplicabilityEvidence?.success
    && supersessionLifecycleEvidence?.success
    && row.supersedingApplicabilityEvidenceJson
    && row.supersedingApplicabilityEvidenceSha256
    && row.supersessionLifecycleEvidenceJson
    && row.supersessionLifecycleEvidenceSha256
    && await sha256Text(row.supersedingApplicabilityEvidenceJson)
      === row.supersedingApplicabilityEvidenceSha256
    && await sha256Text(row.supersessionLifecycleEvidenceJson)
      === row.supersessionLifecycleEvidenceSha256
    && supersessionLifecycleEvidence.data.eventType === "activated_replacement"
    && supersessionLifecycleEvidence.data.sourceId === row.id
    && supersessionLifecycleEvidence.data.previousPublicationId === row.publicationId
    && supersessionLifecycleEvidence.data.previousVersionId === row.versionId
    && supersedingApplicabilityEvidence.data.sourceId === row.id
    && supersedingApplicabilityEvidence.data.versionId
      === supersessionLifecycleEvidence.data.versionId
    && supersedingApplicabilityEvidence.data.effectiveAt
      === row.supersedingApplicabilityEffectiveAt
  );
  const effectiveAt = row.applicabilityEffectiveAt
    ?? (applicability === "historical" ? row.versionEffectiveAt : row.versionEffectiveAt ?? row.sourceEffectiveAt);
  const reviewedExpiryTime = validTime(row.applicabilityExpiresAt);
  const supersededTime = supersessionIsVerified
    ? validTime(row.supersedingApplicabilityEffectiveAt)
    : null;
  const expiresAt = reviewedExpiryTime !== null && supersededTime !== null
    ? (reviewedExpiryTime <= supersededTime
      ? row.applicabilityExpiresAt
      : row.supersedingApplicabilityEffectiveAt)
    : reviewedExpiryTime !== null
      ? row.applicabilityExpiresAt
      : supersededTime !== null
        ? row.supersedingApplicabilityEffectiveAt
        : row.applicabilityId
          ? null
          : row.versionExpiresAt ?? row.sourceExpiresAt;
  const effectiveTime = effectiveAt ? validTime(effectiveAt) : null;
  const expiresTime = expiresAt ? validTime(expiresAt) : null;
  if (
    !publication.success
    || !lifecycle.success
    || (applicability === "historical" && !applicabilityEvidence?.success)
    || (row.applicabilityId !== null && !applicabilityEvidence?.success)
    || (row.versionStatus === "archived"
      && row.applicabilityExpiresAt === null
      && !supersessionIsVerified)
    || row.status !== "verified"
    || row.verificationState !== "verified"
    || (applicability === "current"
      ? row.versionStatus !== "verified"
      : row.versionStatus !== "verified" && row.versionStatus !== "archived")
    || row.versionLanguage !== row.locale
    || !row.canonicalId
    || !row.sourceVerifiedAt
    || !row.sourceVerifiedByUserId
    || row.versionContentSha256 !== row.publicationRawContentSha256
    || (applicability === "current" && row.sourceContentSha256 !== row.versionContentSha256)
    || (applicability === "current" && row.sourceVerifiedAt !== row.publicationPublishedAt)
    || row.versionVerifiedAt !== row.publicationPublishedAt
    || (applicability === "current" && row.sourceVerifiedByUserId !== row.publishedByUserId)
    || row.versionVerifiedByUserId !== row.publishedByUserId
    || (applicability === "current" && row.sourceVerificationNotes !== `publication:${row.publicationId}`)
    || await sha256Text(row.publicationEvidenceJson) !== row.publicationEvidenceSha256
    || await sha256Text(row.lifecycleEvidenceJson) !== row.lifecycleEvidenceSha256
    || (effectiveAt !== null && effectiveTime === null)
    || (expiresAt !== null && expiresTime === null)
    || (effectiveTime !== null && effectiveTime > now.getTime())
    || (expiresTime !== null && expiresTime <= now.getTime())
    || !await validateReadingRows(row, readingRows)
  ) return null;

  const p = publication.data;
  const l = lifecycle.data;
  if (applicabilityEvidence?.success) {
    const a = applicabilityEvidence.data;
    if (
      a.recordId !== row.applicabilityId
      || a.reviewId !== row.reviewId
      || a.sourceId !== row.id
      || a.versionId !== row.versionId
      || a.effectiveAt !== row.applicabilityEffectiveAt
      || a.expiresAt !== row.applicabilityExpiresAt
      || a.reviewedByUserId !== row.applicabilityReviewedByUserId
      || a.reviewerSessionId !== row.applicabilityReviewerSessionId
      || a.mfaVerifiedAt !== row.applicabilityMfaVerifiedAt
      || a.createdAt !== row.applicabilityCreatedAt
      || !row.applicabilityEvidenceJson
      || !row.applicabilityEvidenceSha256
      || await sha256Text(row.applicabilityEvidenceJson) !== row.applicabilityEvidenceSha256
      || row.versionEffectiveAt !== row.applicabilityEffectiveAt
      || row.versionExpiresAt !== expiresAt
    ) return null;
  }
  if (
    p.publicationId !== row.publicationId
    || p.reviewId !== row.reviewId
    || p.sourceId !== row.id
    || p.versionId !== row.versionId
    || p.sourceKind !== row.sourceType
    || p.locale !== row.locale
    || p.canonicalId !== row.canonicalId
    || p.canonicalUrl !== row.officialUrl
    || p.reviewEvidenceSha256 !== row.reviewEvidenceSha256
    || p.rawContentSha256 !== row.publicationRawContentSha256
    || p.parsedContentSha256 !== row.publicationParsedContentSha256
    || p.publishedByUserId !== row.publishedByUserId
    || p.publishedAt !== row.publicationPublishedAt
    || p.sectionCount !== row.sectionCount
    || p.chunkCount !== row.chunkCount
    || l.eventId !== row.lifecycleEventId
    || l.eventType !== row.lifecycleEventType
    || (l.eventType !== "activated_initial" && l.eventType !== "activated_replacement")
    || l.sourceId !== row.id
    || l.publicationId !== row.publicationId
    || l.versionId !== row.versionId
    || l.previousPublicationId !== row.lifecyclePreviousPublicationId
    || l.previousVersionId !== row.lifecyclePreviousVersionId
    || l.reasonNotes !== row.lifecycleReasonNotes
    || l.actedByUserId !== row.lifecycleActedByUserId
    || l.actorSessionId !== row.lifecycleActorSessionId
    || JSON.stringify(l.actorAssignmentIds) !== row.lifecycleActorAssignmentIdsJson
    || l.mfaVerifiedAt !== row.lifecycleMfaVerifiedAt
    || l.occurredAt !== row.lifecycleOccurredAt
    || row.activationActivatedByUserId !== row.lifecycleActedByUserId
    || row.activationActivatedAt !== row.lifecycleOccurredAt
    || (l.eventType === "activated_initial"
      && (l.previousPublicationId !== null || l.previousVersionId !== null))
    || (l.eventType === "activated_replacement"
      && (!l.previousPublicationId || !l.previousVersionId))
  ) return null;

  const source: LegalSourceContext = {
    id: row.id,
    actTitle: row.actTitle,
    actIdentifier: row.actIdentifier,
    officialUrl: row.officialUrl,
    revisionDate: row.revisionDate,
    lastCheckedAt: row.lastCheckedAt,
    locale: row.locale,
    publishedAt: row.publishedAt,
    sourceType: row.sourceType,
    status: row.status,
    verificationState: row.verificationState,
    verifiedAt: row.versionVerifiedAt,
    contentSha256: row.versionContentSha256,
    article: row.article,
    excerpt: row.bodyText.slice(0, 1_200),
    effectiveDate: effectiveAt,
    applicabilityStatus: applicability,
  };
  if (filterVerifiedLexSources([source]).length !== 1) return null;
  return {
    source,
    evidence: {
      sourceId: row.id,
      versionId: row.versionId,
      publicationId: row.publicationId,
      publicationEvidenceSha256: row.publicationEvidenceSha256,
      lifecycleEventId: row.lifecycleEventId,
      lifecycleEvidenceSha256: row.lifecycleEvidenceSha256,
      sectionId: row.sectionId,
      sectionContentSha256: row.sectionContentSha256,
    },
  };
}

async function retrieveCorpusFreshness(
  db: D1Database,
  now: Date,
): Promise<LegalDatabaseFreshness> {
  const runs = await db.prepare(`
    SELECT source_kind AS sourceKind,finished_at AS finishedAt
    FROM source_sync_runs
    WHERE status='success' AND finished_at IS NOT NULL
      AND source_kind='lex'
      AND run_type IN ('initial_corpus','scheduled_corpus','manual_corpus')
      AND discovered_count>0
      AND fetched_count=discovered_count
      AND verified_count=discovered_count
      AND changed_count=0
      AND error_count=0
    ORDER BY finished_at DESC
  `).all<CorpusSyncRow>();
  return legalDatabaseFreshnessFromCorpusRuns(runs.results, now);
}

async function loadPublishedReadingRows(
  db: D1Database,
  versionId: string,
): Promise<PublishedReadingEvidenceRow[]> {
  const rows = await db.prepare(`
    SELECT section.id AS sectionId,section.canonical_ref AS canonicalRef,
      section.article,section.heading,section.body_text AS bodyText,
      section.sequence,section.content_sha256 AS sectionContentSha256,
      chunk.id AS chunkId,chunk.chunk_index AS chunkIndex,
      chunk.language AS chunkLanguage,chunk.content_text AS chunkContentText,
      chunk.content_sha256 AS chunkContentSha256,chunk.vector_id AS vectorId,
      chunk.indexed_at AS indexedAt
    FROM legal_source_sections section
    INNER JOIN legal_source_chunks chunk
      ON chunk.section_id=section.id AND chunk.version_id=section.version_id
    WHERE section.version_id=?
    ORDER BY section.sequence,chunk.chunk_index
  `).bind(versionId).all<PublishedReadingEvidenceRow>();
  return rows.results;
}

async function hasIndexedVerifiedSource(
  db: D1Database,
  locale: "ru" | "uz",
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 AS found
    FROM legal_source_current_activations activation
    INNER JOIN legal_sources source ON source.id=activation.source_id
    INNER JOIN legal_source_versions version
      ON version.id=activation.version_id AND version.source_id=source.id
    INNER JOIN legal_source_chunks chunk ON chunk.version_id=version.id
    WHERE source.status='verified' AND source.verification_state='verified'
      AND source.source_type='lex'
      AND version.status='verified' AND source.locale=?
      AND chunk.vector_id IS NOT NULL AND chunk.indexed_at IS NOT NULL
    LIMIT 1
  `).bind(locale).first<{ found: number }>();
  return Boolean(row?.found);
}
/**
 * Hybrid lexical/semantic retrieval over only current, activated official
 * publications. Semantic matches are only deterministic Vectorize ids: every
 * result is reloaded and revalidated against publication/lifecycle evidence and
 * the complete immutable section/chunk set before any text enters an AI prompt.
 */
export async function retrieveVerifiedLegalSources(
  db: D1Database,
  query: string,
  locale: "ru" | "uz",
  limit = 8,
  options: { now?: Date; applicableAt?: Date; semantic?: LegalSemanticSearchEnv } = {},
): Promise<VerifiedLegalRetrieval> {
  const now = options.now ?? new Date();
  const applicableAt = options.applicableAt ?? now;
  const historical = uzbekistanCalendarDate(applicableAt) < uzbekistanCalendarDate(now);
  const freshness = await retrieveCorpusFreshness(db, now);
  const keywords = legalSearchKeywords(query, locale);
  const semantic = !historical && await hasIndexedVerifiedSource(db, locale)
    ? await semanticLegalChunkRanks(options.semantic, query, locale)
    : { status: "unavailable" as const, vectorRanks: new Map<string, number>() };
  const semanticVectorIds = [...semantic.vectorRanks.keys()]
    .slice(0, MAX_RETRIEVAL_SEMANTIC_VECTOR_IDS);
  if (!keywords.length && !semanticVectorIds.length) {
    return {
      sources: [],
      evidence: [],
      freshness,
      legalDatabaseAsOf: freshness.asOf,
      retrievalMode: "lexical",
      semanticStatus: semantic.status,
      applicableAt: applicableAt.toISOString(),
    };
  }

  const lexicalFields = [
    "source.act_title",
    "COALESCE(source.act_identifier,'')",
    "COALESCE(section.canonical_ref,'')",
    "COALESCE(section.article,'')",
    "COALESCE(section.heading,'')",
    "section.body_text",
  ];
  const lexicalConditions = keywords.flatMap((keyword) => {
    const patterns = legalSearchPatterns(keyword, locale);
    return lexicalFields.map((field) =>
      `(${patterns.map(() => `${field} LIKE ?`).join(" OR ")})`,
    );
  });
  const lexicalBindings = keywords.flatMap((keyword) => {
    const patterns = legalSearchPatterns(keyword, locale);
    return lexicalFields.flatMap(() => patterns.map((pattern) => `%${pattern}%`));
  });
  const semanticCondition = semanticVectorIds.length
    ? `chunk.vector_id IN (${semanticVectorIds.map(() => "?").join(",")})`
    : null;
  const conditions = [...lexicalConditions, semanticCondition].filter(Boolean).join(" OR ");
  const rows = await db.prepare(`
    SELECT source.id,source.official_url AS officialUrl,
      source.canonical_id AS canonicalId,source.act_title AS actTitle,
      source.act_identifier AS actIdentifier,source.published_at AS publishedAt,
      source.revision_date AS revisionDate,source.last_checked_at AS lastCheckedAt,
      source.locale,source.source_type AS sourceType,source.status,
      source.verification_state AS verificationState,
      source.verified_at AS sourceVerifiedAt,
      source.content_sha256 AS sourceContentSha256,
      source.verified_by_user_id AS sourceVerifiedByUserId,
      source.verification_notes AS sourceVerificationNotes,
      source.effective_at AS sourceEffectiveAt,source.expires_at AS sourceExpiresAt,
      version.id AS versionId,version.language AS versionLanguage,
      version.status AS versionStatus,version.content_sha256 AS versionContentSha256,
      version.verified_at AS versionVerifiedAt,
      version.verified_by_user_id AS versionVerifiedByUserId,
      version.effective_at AS versionEffectiveAt,version.expires_at AS versionExpiresAt,
      publication.id AS publicationId,publication.review_id AS reviewId,
      publication.review_evidence_sha256 AS reviewEvidenceSha256,
      publication.raw_content_sha256 AS publicationRawContentSha256,
      publication.parsed_content_sha256 AS publicationParsedContentSha256,
      publication.published_by_user_id AS publishedByUserId,
      publication.publication_evidence_json AS publicationEvidenceJson,
      publication.publication_evidence_sha256 AS publicationEvidenceSha256,
      publication.published_at AS publicationPublishedAt,
      ${historical ? "lifecycle.acted_by_user_id" : "activation.activated_by_user_id"} AS activationActivatedByUserId,
      ${historical ? "lifecycle.occurred_at" : "activation.activated_at"} AS activationActivatedAt,
      lifecycle.id AS lifecycleEventId,lifecycle.event_type AS lifecycleEventType,
      lifecycle.previous_publication_id AS lifecyclePreviousPublicationId,
      lifecycle.previous_version_id AS lifecyclePreviousVersionId,
      lifecycle.reason_notes AS lifecycleReasonNotes,
      lifecycle.acted_by_user_id AS lifecycleActedByUserId,
      lifecycle.actor_session_id AS lifecycleActorSessionId,
      lifecycle.actor_assignment_ids_json AS lifecycleActorAssignmentIdsJson,
      lifecycle.mfa_verified_at AS lifecycleMfaVerifiedAt,
      lifecycle.evidence_json AS lifecycleEvidenceJson,
      lifecycle.evidence_sha256 AS lifecycleEvidenceSha256,
      lifecycle.occurred_at AS lifecycleOccurredAt,
      section.id AS sectionId,section.canonical_ref AS canonicalRef,
      section.article,section.heading,section.body_text AS bodyText,
      section.sequence,section.content_sha256 AS sectionContentSha256,
      chunk.id AS chunkId,chunk.chunk_index AS chunkIndex,
      chunk.language AS chunkLanguage,chunk.content_text AS chunkContentText,
      chunk.content_sha256 AS chunkContentSha256,chunk.vector_id AS vectorId,
      chunk.indexed_at AS indexedAt,
      applicability.id AS applicabilityId,
      applicability.effective_at AS applicabilityEffectiveAt,
      applicability.expires_at AS applicabilityExpiresAt,
      applicability.reviewed_by_user_id AS applicabilityReviewedByUserId,
      applicability.reviewer_session_id AS applicabilityReviewerSessionId,
      applicability.mfa_verified_at AS applicabilityMfaVerifiedAt,
      applicability.evidence_json AS applicabilityEvidenceJson,
      applicability.evidence_sha256 AS applicabilityEvidenceSha256,
      applicability.created_at AS applicabilityCreatedAt,
      superseding_applicability.effective_at AS supersedingApplicabilityEffectiveAt,
      superseding_applicability.evidence_json AS supersedingApplicabilityEvidenceJson,
      superseding_applicability.evidence_sha256 AS supersedingApplicabilityEvidenceSha256,
      supersession.evidence_json AS supersessionLifecycleEvidenceJson,
      supersession.evidence_sha256 AS supersessionLifecycleEvidenceSha256,
      (SELECT count(*) FROM legal_source_sections counted_section
        WHERE counted_section.version_id=version.id) AS sectionCount,
      (SELECT count(*) FROM legal_source_chunks counted_chunk
        WHERE counted_chunk.version_id=version.id) AS chunkCount
    FROM legal_sources source
    ${historical ? "" : "INNER JOIN legal_source_current_activations activation ON activation.source_id=source.id"}
    INNER JOIN legal_source_versions version
      ON version.source_id=source.id
     ${historical ? "" : "AND version.id=activation.version_id"}
    INNER JOIN legal_source_publications publication
      ON publication.version_id=version.id AND publication.source_id=source.id
     ${historical ? "" : "AND publication.id=activation.publication_id"}
    INNER JOIN legal_source_lifecycle_events lifecycle
      ON lifecycle.publication_id=publication.id
     AND lifecycle.version_id=version.id AND lifecycle.source_id=source.id
     AND lifecycle.event_type IN ('activated_initial','activated_replacement')
    INNER JOIN legal_source_sections section ON section.version_id=version.id
    INNER JOIN legal_source_chunks chunk
      ON chunk.section_id=section.id AND chunk.version_id=version.id
    LEFT JOIN legal_source_applicability_records applicability
      ON applicability.review_id=publication.review_id
     AND applicability.source_id=source.id AND applicability.version_id=version.id
    LEFT JOIN legal_source_lifecycle_events supersession
      ON supersession.source_id=source.id
     AND supersession.previous_publication_id=publication.id
     AND supersession.previous_version_id=version.id
     AND supersession.event_type='activated_replacement'
    LEFT JOIN legal_source_applicability_records superseding_applicability
      ON superseding_applicability.source_id=source.id
     AND superseding_applicability.version_id=supersession.version_id
    WHERE source.status='verified' AND source.verification_state='verified'
      AND version.status ${historical ? "IN ('verified','archived')" : "='verified'"}
      AND source.locale=?
      AND ${historical
        ? `applicability.id IS NOT NULL AND applicability.effective_at<=?
          AND (CASE
            WHEN applicability.expires_at IS NULL THEN superseding_applicability.effective_at
            WHEN superseding_applicability.effective_at IS NULL THEN applicability.expires_at
            WHEN applicability.expires_at<=superseding_applicability.effective_at THEN applicability.expires_at
            ELSE superseding_applicability.effective_at
          END IS NULL OR CASE
            WHEN applicability.expires_at IS NULL THEN superseding_applicability.effective_at
            WHEN superseding_applicability.effective_at IS NULL THEN applicability.expires_at
            WHEN applicability.expires_at<=superseding_applicability.effective_at THEN applicability.expires_at
            ELSE superseding_applicability.effective_at
          END>?)`
        : "1=1"}
      AND (${conditions})
    ORDER BY ${historical ? "applicability.effective_at DESC," : ""}
      source.last_checked_at DESC,section.sequence ASC
    LIMIT 48
  `).bind(
    locale,
    ...(historical ? [applicableAt.toISOString(), applicableAt.toISOString()] : []),
    ...lexicalBindings,
    ...semanticVectorIds,
  ).all<VerifiedLegalSourceEvidenceRow>();

  // Sparse BM25 gives exact title/article and lexical evidence an independent
  // rank. Dense Vectorize results remain source ids only, then RRF merges both
  // bounded lists before validation reloads the full source evidence.
  const candidateId = (row: VerifiedLegalSourceEvidenceRow) => `${row.versionId}:${row.chunkId}`;
  const sparseRanking = rankSparseBm25(query, rows.results.map((row) => ({
    id: candidateId(row),
    value: row,
    title: `${row.actTitle} ${row.heading ?? ""}`,
    body: row.bodyText,
    identifiers: [
      row.actIdentifier,
      row.canonicalRef,
      row.article,
      row.heading,
    ].filter(Boolean).join(" "),
  })));
  const denseRanking = rows.results
    .filter((row) => row.vectorId && semantic.vectorRanks.has(row.vectorId))
    .sort((left, right) =>
      semantic.vectorRanks.get(left.vectorId!)! - semantic.vectorRanks.get(right.vectorId!)!
    )
    .map((row, index) => ({
      id: candidateId(row),
      value: row,
      // The score is intentionally rank-derived: Vectorize scores are not
      // comparable with BM25 scores.
      score: 1 / (index + 1),
    }));
  const fusedRanks = reciprocalRankFusion([sparseRanking, denseRanking], {
    limit: rows.results.length,
  });
  const fusedPosition = new Map(fusedRanks.map((candidate, index) => [candidate.id, index]));
  rows.results.sort((left, right) => (
    (fusedPosition.get(candidateId(left)) ?? Number.MAX_SAFE_INTEGER)
      - (fusedPosition.get(candidateId(right)) ?? Number.MAX_SAFE_INTEGER)
  ));

  const maxResults = Math.max(1, Math.min(12, limit));
  const attempted = new Set<string>();
  const validated: Array<{
    source: LegalSourceContext;
    evidence: VerifiedLegalSourceEvidence;
  }> = [];
  for (const row of rows.results) {
    if (attempted.has(row.id)) continue;
    attempted.add(row.id);
    const readingRows = await loadPublishedReadingRows(db, row.versionId);
    const result = await validateVerifiedLegalSourceEvidence(
      row,
      readingRows,
      applicableAt,
      historical ? "historical" : "current",
    );
    if (result) validated.push(result);
    if (validated.length >= maxResults) break;
  }
  return {
    sources: validated.map(({ source }) => source),
    evidence: validated.map(({ evidence }) => evidence),
    freshness,
    legalDatabaseAsOf: freshness.asOf,
    retrievalMode: semantic.status === "used" ? "hybrid" : "lexical",
    semanticStatus: semantic.status,
    applicableAt: applicableAt.toISOString(),
  };
}
