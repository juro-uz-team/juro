import assert from "node:assert/strict";
import test from "node:test";
import {
  filterTrustedVerifiedLegalSources,
  isTrustedVerifiedLegalSource,
  trustedLegalSourceKind,
} from "../lib/legal/source-trust";
import {
  documentAnalysisResultSchema,
  enforceDocumentAnalysisFreshness,
} from "../lib/document-analysis/schema";
import {
  legalDatabaseFreshnessFromAsOf,
  legalDatabaseFreshnessFromCorpusRuns,
  legalSearchKeywords,
  legalSearchPatterns,
  validateVerifiedLegalSourceEvidence,
  type VerifiedLegalSourceEvidenceRow,
} from "../lib/legal/verified-retrieval";


const VERIFIED_AT = "2026-07-28T12:00:00.000Z";
const CONTENT_SHA256 = "a".repeat(64);
const verifiedEvidence = {
  status: "verified",
  verificationState: "verified",
  verifiedAt: VERIFIED_AT,
  contentSha256: CONTENT_SHA256,
};

test("only exact official Lex HTTPS hosts are trusted", () => {
  assert.equal(trustedLegalSourceKind("https://lex.uz/docs/123"), "lex");
  assert.equal(trustedLegalSourceKind("https://www.lex.uz/acts/123"), "lex");
  assert.equal(trustedLegalSourceKind("https://advice.uz/ru/document/1"), null);
  assert.equal(trustedLegalSourceKind("https://www.advice.uz/uz/document/1"), null);
  assert.equal(trustedLegalSourceKind("http://lex.uz/docs/123"), null);
  assert.equal(trustedLegalSourceKind("https://lex.uz.example.com/docs/123"), null);
  assert.equal(trustedLegalSourceKind("https://example.com/?next=https://lex.uz"), null);
  assert.equal(trustedLegalSourceKind("https://user:secret@lex.uz/docs/123"), null);
  assert.equal(trustedLegalSourceKind("javascript:alert(1)"), null);
  assert.equal(trustedLegalSourceKind("not a URL"), null);
});

test("database verified status cannot promote an untrusted URL", () => {
  assert.equal(isTrustedVerifiedLegalSource({
    officialUrl: "https://example.com/law",
    sourceType: "lex",
    ...verifiedEvidence,
  }), false);
  assert.equal(isTrustedVerifiedLegalSource({
    officialUrl: "https://lex.uz/docs/123",
    sourceType: "lex",
    status: "pending",
  }), false);
  assert.equal(isTrustedVerifiedLegalSource({
    officialUrl: "https://lex.uz/docs/123",
    sourceType: "lex",
    ...verifiedEvidence,
  }), true);
  assert.equal(isTrustedVerifiedLegalSource({
    officialUrl: "https://lex.uz/docs/123",
    sourceType: "advice",
    ...verifiedEvidence,
  }), false);
  assert.equal(isTrustedVerifiedLegalSource({
    officialUrl: "https://lex.uz/docs/123",
    sourceType: "lex",
    status: "verified",
    verificationState: "verified",
    verifiedAt: VERIFIED_AT,
    contentSha256: null,
  }), false);
});

test("trusted-source filtering preserves only allowlisted verified records", () => {
  const sources = filterTrustedVerifiedLegalSources([
    { id: "lex", officialUrl: "https://lex.uz/docs/1", sourceType: "lex", ...verifiedEvidence },
    { id: "advice", officialUrl: "https://advice.uz/ru/1", sourceType: "advice", ...verifiedEvidence },
    { id: "fake", officialUrl: "https://laws.example/1", sourceType: "lex", ...verifiedEvidence },
    { id: "legacy", officialUrl: "https://lex.uz/docs/legacy", sourceType: "lex", status: "verified" },
    { id: "draft", officialUrl: "https://lex.uz/docs/2", sourceType: "lex", status: "pending" },
  ]);
  assert.deepEqual(sources.map(({ id }) => id), ["lex"]);
});

const NOW = new Date("2026-07-31T12:00:00.000Z");

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function evidenceFixture(): Promise<VerifiedLegalSourceEvidenceRow> {
  const bodyText = "Трудовой договор прекращается в порядке, установленном законом.";
  const rawContentSha256 = "b".repeat(64);
  const parsedContentSha256 = "c".repeat(64);
  const reviewEvidenceSha256 = "d".repeat(64);
  const sectionContentSha256 = await sha256Text(bodyText);
  const publishedAt = "2026-07-30T10:00:00.000Z";
  const publicationEvidenceJson = JSON.stringify({
    schemaVersion: 1,
    publicationId: "publication_1",
    reviewId: "review_1",
    sourceId: "source_1",
    versionId: "version_1",
    sourceKind: "lex",
    locale: "ru",
    canonicalId: "lex_123",
    canonicalUrl: "https://lex.uz/docs/123",
    reviewEvidenceSha256,
    rawContentSha256,
    parsedContentSha256,
    parserProfile: "lex-fixture-v1",
    publishedByUserId: "publisher_1",
    publisherSessionId: "session_1",
    publisherAssignmentIds: ["assignment_1"],
    mfaVerifiedAt: "2026-07-30T09:55:00.000Z",
    sectionCount: 1,
    chunkCount: 1,
    publishedAt,
  });
  const lifecycleEvidenceJson = JSON.stringify({
    schemaVersion: 1,
    eventId: "lifecycle_1",
    eventType: "activated_initial",
    sourceId: "source_1",
    publicationId: "publication_1",
    versionId: "version_1",
    previousPublicationId: null,
    previousVersionId: null,
    reasonNotes: null,
    actedByUserId: "publisher_1",
    actorSessionId: "session_1",
    actorAssignmentIds: ["assignment_1"],
    mfaVerifiedAt: "2026-07-30T09:55:00.000Z",
    occurredAt: publishedAt,
  });
  return {
    id: "source_1",
    officialUrl: "https://lex.uz/docs/123",
    canonicalId: "lex_123",
    actTitle: "Трудовой кодекс Республики Узбекистан",
    actIdentifier: "ЗРУ-798",
    publishedAt: "2022-10-28T00:00:00.000Z",
    revisionDate: "2026-07-01T00:00:00.000Z",
    lastCheckedAt: publishedAt,
    locale: "ru",
    sourceType: "lex",
    status: "verified",
    verificationState: "verified",
    sourceVerifiedAt: publishedAt,
    sourceContentSha256: rawContentSha256,
    sourceVerifiedByUserId: "publisher_1",
    sourceVerificationNotes: "publication:publication_1",
    sourceEffectiveAt: "2023-04-30T00:00:00.000Z",
    sourceExpiresAt: null,
    versionId: "version_1",
    versionLanguage: "ru",
    versionStatus: "verified",
    versionContentSha256: rawContentSha256,
    versionVerifiedAt: publishedAt,
    versionVerifiedByUserId: "publisher_1",
    versionEffectiveAt: "2023-04-30T00:00:00.000Z",
    versionExpiresAt: null,
    publicationId: "publication_1",
    reviewId: "review_1",
    reviewEvidenceSha256,
    publicationRawContentSha256: rawContentSha256,
    publicationParsedContentSha256: parsedContentSha256,
    publishedByUserId: "publisher_1",
    publicationEvidenceJson,
    publicationEvidenceSha256: await sha256Text(publicationEvidenceJson),
    publicationPublishedAt: publishedAt,
    activationActivatedByUserId: "publisher_1",
    activationActivatedAt: publishedAt,
    lifecycleEventId: "lifecycle_1",
    lifecycleEventType: "activated_initial",
    lifecyclePreviousPublicationId: null,
    lifecyclePreviousVersionId: null,
    lifecycleReasonNotes: null,
    lifecycleActedByUserId: "publisher_1",
    lifecycleActorSessionId: "session_1",
    lifecycleActorAssignmentIdsJson: JSON.stringify(["assignment_1"]),
    lifecycleMfaVerifiedAt: "2026-07-30T09:55:00.000Z",
    lifecycleEvidenceJson,
    lifecycleEvidenceSha256: await sha256Text(lifecycleEvidenceJson),
    lifecycleOccurredAt: publishedAt,
    sectionId: "section_1",
    canonicalRef: "article:100",
    article: "100",
    heading: "Прекращение трудового договора",
    bodyText,
    sequence: 0,
    sectionContentSha256,
    chunkId: "chunk_1",
    chunkIndex: 0,
    chunkLanguage: "ru",
    chunkContentText: bodyText,
    chunkContentSha256: sectionContentSha256,
    vectorId: null,
    indexedAt: null,
    sectionCount: 1,
    chunkCount: 1,
    applicabilityId: null,
    applicabilityEffectiveAt: null,
    applicabilityExpiresAt: null,
    applicabilityReviewedByUserId: null,
    applicabilityReviewerSessionId: null,
    applicabilityMfaVerifiedAt: null,
    applicabilityEvidenceJson: null,
    applicabilityEvidenceSha256: null,
    applicabilityCreatedAt: null,
    supersedingApplicabilityEffectiveAt: null,
    supersedingApplicabilityEvidenceJson: null,
    supersedingApplicabilityEvidenceSha256: null,
    supersessionLifecycleEvidenceJson: null,
    supersessionLifecycleEvidenceSha256: null,
  };
}

test("legal keywords are bounded and locale-aware", () => {
  assert.deepEqual(
    legalSearchKeywords("Договор договор Увольнение срок", "ru", 3),
    ["договор", "увольнение"],
  );
  assert.deepEqual(
    legalSearchKeywords("Закон 205, статья 1", "ru", 8),
    ["закон", "205", "статья", "1"],
  );
  assert.deepEqual(
    legalSearchKeywords("договор увольнение налог недвижимость труд семья банк".repeat(2), "ru"),
    ["договор", "увольнение", "налог", "недвижимость"],
  );
  assert.deepEqual(
    legalSearchPatterns("договор", "ru"),
    ["договор", "Договор", "ДОГОВОР"],
  );
  assert.deepEqual(legalSearchPatterns("205", "uz"), ["205"]);
});

test("a complete Lex corpus run establishes database freshness", () => {
  const onlyLex = legalDatabaseFreshnessFromCorpusRuns([
    { sourceKind: "lex", finishedAt: "2026-07-31T10:00:00.000Z" },
  ], NOW);
  assert.equal(onlyLex.status, "fresh");
  assert.equal(onlyLex.asOf, "2026-07-31T10:00:00.000Z");

  const fresh = legalDatabaseFreshnessFromCorpusRuns([
    { sourceKind: "lex", finishedAt: "2026-07-31T10:00:00.000Z" },
    { sourceKind: "advice", finishedAt: "2026-07-31T09:00:00.000Z" },
  ], NOW);
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.asOf, "2026-07-31T10:00:00.000Z");

  const stale = legalDatabaseFreshnessFromAsOf(
    "2026-07-20T09:00:00.000Z",
    NOW,
  );
  assert.equal(stale.status, "stale");
  assert.equal(stale.ageDays, 11);
  assert.equal(
    legalDatabaseFreshnessFromAsOf("not-a-date", NOW).status,
    "unavailable",
  );
});

test("retrieval accepts complete publication evidence and rejects tampering", async () => {
  const row = await evidenceFixture();
  const verified = await validateVerifiedLegalSourceEvidence(row, [row], NOW);
  assert.equal(verified?.source.id, "source_1");
  const indexedRow = {
    ...row,
    vectorId: "lex-source-1-section-1",
    indexedAt: "2026-07-31T10:00:00.000Z",
  };
  assert.ok(await validateVerifiedLegalSourceEvidence(indexedRow, [indexedRow], NOW));

  assert.equal(verified?.evidence.publicationId, "publication_1");

  const tamperedSection = { ...row, bodyText: `${row.bodyText} Подмена.` };
  assert.equal(
    await validateVerifiedLegalSourceEvidence(tamperedSection, [tamperedSection], NOW),
    null,
  );
  const tamperedPublication = {
    ...row,
    publicationEvidenceJson: row.publicationEvidenceJson.replace(
      '"parserProfile":"lex-fixture-v1"',
      '"parserProfile":"tampered"',
    ),
  };
  assert.equal(
    await validateVerifiedLegalSourceEvidence(tamperedPublication, [row], NOW),
    null,
  );
  const tamperedLifecycle = {
    ...row,
    lifecycleEvidenceJson: row.lifecycleEvidenceJson.replace(
      '"actorSessionId":"session_1"',
      '"actorSessionId":"session_attacker"',
    ),
  };
  assert.equal(
    await validateVerifiedLegalSourceEvidence(tamperedLifecycle, [row], NOW),
    null,
  );
  const futureVersion = { ...row, versionEffectiveAt: "2026-08-01T00:00:00.000Z" };
  assert.equal(
    await validateVerifiedLegalSourceEvidence(futureVersion, [futureVersion], NOW),
    null,
  );
  const expiredVersion = { ...row, versionExpiresAt: "2026-07-31T11:59:59.000Z" };
  assert.equal(
    await validateVerifiedLegalSourceEvidence(expiredVersion, [expiredVersion], NOW),
    null,
  );
});

test("document analysis removes legal-compliance claims when corpus freshness is unavailable", () => {
  const analysis = documentAnalysisResultSchema.parse({
    documentType: "Договор",
    summary: "Документ содержит договорные условия.",
    language: "ru",
    outputLanguage: "ru",
    jurisdiction: "UZ",
    mode: "full",
    userSide: null,
    legalComplianceStatus: "verified",
    parties: [],
    amounts: [],
    dates: [],
    obligations: [],
    deadlines: [],
    risks: [{
      severity: "high",
      riskType: "legal_compliance",
      title: "Правовой риск",
      clause: null,
      page: null,
      exactExcerpt: null,
      problem: "Условие может не соответствовать норме.",
      consequence: "Условие может быть оспорено.",
      legalBasisSourceIds: ["source_1"],
      recommendation: "Проверить редакцию нормы.",
      proposedWording: null,
      confidence: "high",
    }, {
      severity: "medium",
      riskType: "document_internal",
      title: "Внутреннее противоречие",
      clause: null,
      page: null,
      exactExcerpt: null,
      problem: "Два условия противоречат друг другу.",
      consequence: "Неясность исполнения.",
      legalBasisSourceIds: ["source_1"],
      recommendation: "Согласовать формулировки.",
      proposedWording: null,
      confidence: "high",
    }],
    missingClauses: [{
      title: "Порядок уведомления",
      reason: "Порядок не описан.",
      proposedWording: null,
      legalBasisSourceIds: ["source_1"],
    }],
    contradictions: [],
    questions: [],
    recommendations: [],
    overallQuality: { score: 70, explanation: "Требуется уточнение." },
    sources: [{
      sourceId: "source_1",
      actTitle: "Трудовой кодекс",
      actIdentifier: "ЗРУ-798",
      article: "100",
      excerpt: "Фрагмент нормы",
      originalUrl: "https://lex.uz/docs/123",
      verifiedAt: "2026-07-30T10:00:00.000Z",
    }],
    legalDatabaseAsOf: "2026-07-30T10:00:00.000Z",
    extractionWarnings: [],
  });
  const unavailable = enforceDocumentAnalysisFreshness(analysis, {
    status: "unavailable",
    asOf: "unavailable",
    ageDays: null,
    maxAgeDays: 7,
  });
  assert.equal(unavailable.legalComplianceStatus, "unverified");
  assert.deepEqual(unavailable.sources, []);
  assert.deepEqual(unavailable.risks.map((risk) => risk.riskType), ["document_internal"]);
  assert.deepEqual(unavailable.risks[0]?.legalBasisSourceIds, []);
  assert.equal(unavailable.missingClauses.length, 0);
  assert.equal(unavailable.recommendations.length, 1);
  assert.match(unavailable.recommendations[0] || "", /не подтверждена/);
  assert.ok(unavailable.extractionWarnings.includes("LEGAL_DATABASE_UNAVAILABLE"));

  const stale = enforceDocumentAnalysisFreshness(analysis, {
    status: "stale",
    asOf: "2026-07-20T09:00:00.000Z",
    ageDays: 11,
    maxAgeDays: 7,
  });
  assert.equal(stale.legalComplianceStatus, "partial");
  assert.equal(stale.risks[0]?.confidence, "low");
  assert.equal(stale.sources.length, 1);
  assert.match(stale.extractionWarnings[0] ?? "", /^LEGAL_DATABASE_STALE:/);
});
