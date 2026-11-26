import { parseJson } from "../document-builder/storage/db";
import { getPrivateObject } from "../document-builder/storage/files";
import { filterVerifiedLexSources } from "../legal/source-trust";
import type { ComparisonChange, ComparisonSummary, ExtractedDocument, WordDiffPart } from "./types";

export type VerifiedLegalSource = {
  id: string;
  officialUrl: string;
  actTitle: string;
  actIdentifier: string | null;
  publishedAt: string | null;
  revisionDate: string | null;
  locale: string;
  sourceType: string;
  status: string;
  verificationState: string;
  verifiedAt: string;
  contentSha256: string;
  lastCheckedAt: string;
};

export type ComparisonAccessRow = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  versionOneFileId: string;
  versionTwoFileId: string;
  caseId: string | null;
  status: string;
  stage: string;
  locale: string;
  summaryJson: string | null;
  versionOneJsonKey: string | null;
  versionTwoJsonKey: string | null;
  similarityPercent: number | null;
  overallRisk: string | null;
  aiStatus: string | null;
  modelName: string | null;
  modelVersion: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  versionOneName: string;
  versionOneMimeType: string;
  versionOneSizeBytes: number;
  versionOneSha256: string | null;
  versionTwoName: string;
  versionTwoMimeType: string;
  versionTwoSizeBytes: number;
  versionTwoSha256: string | null;
};

export async function comparisonForUser(
  db: D1Database,
  comparisonId: string,
  workspaceId: string,
  userId: string,
): Promise<ComparisonAccessRow | null> {
  return db.prepare(
    `SELECT c.id,c.workspace_id AS workspaceId,c.owner_user_id AS ownerUserId,
      c.version_one_file_id AS versionOneFileId,c.version_two_file_id AS versionTwoFileId,
      c.case_id AS caseId,c.status,c.stage,c.locale,c.summary_json AS summaryJson,
      c.version_one_json_key AS versionOneJsonKey,c.version_two_json_key AS versionTwoJsonKey,
      c.similarity_percent AS similarityPercent,c.overall_risk AS overallRisk,c.ai_status AS aiStatus,
      c.model_name AS modelName,c.model_version AS modelVersion,c.error_code AS errorCode,
      c.created_at AS createdAt,c.updated_at AS updatedAt,
      one.file_name AS versionOneName,one.mime_type AS versionOneMimeType,
      one.size_bytes AS versionOneSizeBytes,one.sha256 AS versionOneSha256,
      two.file_name AS versionTwoName,two.mime_type AS versionTwoMimeType,
      two.size_bytes AS versionTwoSizeBytes,two.sha256 AS versionTwoSha256
     FROM document_comparisons c
     JOIN document_files one ON one.id=c.version_one_file_id
     JOIN document_files two ON two.id=c.version_two_file_id
     WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.deleted_at IS NULL LIMIT 1`,
  ).bind(comparisonId, workspaceId, userId).first<ComparisonAccessRow>();
}

export async function loadExtractedDocument(
  key: string | null,
): Promise<ExtractedDocument | null> {
  if (!key) return null;
  const object = await getPrivateObject(key);
  if (!object) return null;
  return object.json<ExtractedDocument>();
}

export async function comparisonChanges(
  db: D1Database,
  comparisonId: string,
): Promise<ComparisonChange[]> {
  const rows = await db.prepare(
    `SELECT id,ordinal,change_type AS changeType,before_section_id AS beforeSectionId,
      after_section_id AS afterSectionId,before_label AS beforeLabel,after_label AS afterLabel,
      before_heading AS beforeHeading,after_heading AS afterHeading,before_text AS beforeText,
      after_text AS afterText,word_diff_json AS wordDiffJson,summary,legal_effect AS legalEffect,
      affected_party AS affectedParty,risk_effect AS riskEffect,risk_level AS riskLevel,
      recommendation,source_ids_json AS sourceIdsJson,confidence_percent AS confidencePercent,
      reviewed_at AS reviewedAt,review_decision AS reviewDecision,decided_at AS decidedAt,
      review_decision_version AS reviewDecisionVersion,extraction_warning AS extractionWarning
     FROM comparison_changes WHERE comparison_id=? ORDER BY ordinal`,
  ).bind(comparisonId).all();
  return rows.results.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      ordinal: Number(row.ordinal),
      changeType: String(row.changeType) as ComparisonChange["changeType"],
      beforeSectionId: row.beforeSectionId ? String(row.beforeSectionId) : null,
      afterSectionId: row.afterSectionId ? String(row.afterSectionId) : null,
      beforeLabel: row.beforeLabel ? String(row.beforeLabel) : null,
      afterLabel: row.afterLabel ? String(row.afterLabel) : null,
      beforeHeading: row.beforeHeading ? String(row.beforeHeading) : null,
      afterHeading: row.afterHeading ? String(row.afterHeading) : null,
      beforeText: row.beforeText ? String(row.beforeText) : null,
      afterText: row.afterText ? String(row.afterText) : null,
      wordDiff: parseJson<WordDiffPart[]>(String(row.wordDiffJson || "[]"), []),
      summary: String(row.summary),
      legalEffect: String(row.legalEffect),
      affectedParty: String(row.affectedParty),
      riskEffect: String(row.riskEffect) as ComparisonChange["riskEffect"],
      riskLevel: String(row.riskLevel) as ComparisonChange["riskLevel"],
      recommendation: String(row.recommendation),
      sourceIds: parseJson<string[]>(String(row.sourceIdsJson || "[]"), []),
      confidencePercent: row.confidencePercent === null ? null : Number(row.confidencePercent),
      reviewedAt: row.reviewedAt ? String(row.reviewedAt) : null,
      reviewDecision: row.reviewDecision
        ? String(row.reviewDecision) as ComparisonChange["reviewDecision"]
        : null,
      decidedAt: row.decidedAt ? String(row.decidedAt) : null,
      reviewDecisionVersion: Number(row.reviewDecisionVersion ?? 0),
      extractionWarning: Boolean(row.extractionWarning),
    };
  });
}

export async function verifiedSourcesForChanges(
  db: D1Database,
  changes: ComparisonChange[],
  stored: VerifiedLegalSource[] = [],
): Promise<VerifiedLegalSource[]> {
  const ids = Array.from(new Set(changes.flatMap((change) => change.sourceIds))).slice(0, 100);
  if (!ids.length) return [];
  const current = filterVerifiedLexSources(stored).filter(source => ids.includes(source.id));
  const legacyIds = ids.filter(id => !current.some(source => source.id === id));
  if (!legacyIds.length) return current;
  const placeholders = legacyIds.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT id,official_url AS officialUrl,act_title AS actTitle,act_identifier AS actIdentifier,
      published_at AS publishedAt,revision_date AS revisionDate,locale,source_type AS sourceType,
      status,verification_state AS verificationState,verified_at AS verifiedAt,
      content_sha256 AS contentSha256,last_checked_at AS lastCheckedAt
     FROM legal_sources WHERE status='verified' AND verification_state='verified'
       AND verified_at IS NOT NULL AND content_sha256 IS NOT NULL AND id IN (${placeholders})`,
  ).bind(...legacyIds).all();
  return [...current, ...filterVerifiedLexSources(rows.results as unknown as VerifiedLegalSource[])];
}

export function parsedSummary(value: string | null): ComparisonSummary | null {
  return value ? parseJson<ComparisonSummary | null>(value, null) : null;
}
