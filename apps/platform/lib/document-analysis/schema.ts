import { z } from "zod";
import type { LegalDatabaseFreshness } from "../legal/verified-retrieval";

const sourceIds = z.array(z.string().min(1).max(160)).max(12);

export const documentPartySchema = z.object({
  name: z.string().min(1).max(500),
  role: z.string().min(1).max(240),
  isUserSide: z.boolean(),
}).strict();

export const documentObligationSchema = z.object({
  party: z.string().min(1).max(500),
  obligation: z.string().min(1).max(2_000),
  clause: z.string().max(120).nullable(),
  deadline: z.string().max(240).nullable(),
}).strict();

export const documentDeadlineSchema = z.object({
  title: z.string().min(1).max(500),
  value: z.string().min(1).max(240),
  clause: z.string().max(120).nullable(),
  consequence: z.string().max(1_500).nullable(),
}).strict();

export const riskFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "informational"]),
  riskType: z.enum(["document_internal", "legal_compliance"]),
  title: z.string().min(1).max(500),
  clause: z.string().max(120).nullable(),
  page: z.number().int().min(1).max(500).nullable(),
  exactExcerpt: z.string().max(2_000).nullable(),
  problem: z.string().min(1).max(4_000),
  consequence: z.string().min(1).max(4_000),
  legalBasisSourceIds: sourceIds,
  recommendation: z.string().min(1).max(4_000),
  proposedWording: z.string().max(6_000).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
}).strict();

export const missingClauseSchema = z.object({
  title: z.string().min(1).max(500),
  reason: z.string().min(1).max(3_000),
  proposedWording: z.string().max(6_000).nullable(),
  legalBasisSourceIds: sourceIds,
}).strict();

export const documentAnalysisSourceSchema = z.object({
  sourceId: z.string().min(1).max(160),
  actTitle: z.string().min(1).max(500),
  actIdentifier: z.string().max(240).nullable(),
  article: z.string().max(240).nullable(),
  excerpt: z.string().max(1_200).nullable(),
  originalUrl: z.string().url().max(2_000),
  verifiedAt: z.string().min(1).max(64),
}).strict();

export const documentAnalysisResultSchema = z.object({
  documentType: z.string().min(1).max(300),
  summary: z.string().min(1).max(4_000),
  language: z.enum(["ru", "uz", "en", "mixed", "unknown"]),
  outputLanguage: z.enum(["ru", "uz"]),
  jurisdiction: z.literal("UZ"),
  mode: z.enum(["quick", "full", "expert"]),
  userSide: z.string().max(500).nullable(),
  legalComplianceStatus: z.enum(["verified", "partial", "unverified"]),
  parties: z.array(documentPartySchema).max(30),
  amounts: z.array(z.string().min(1).max(500)).max(50),
  dates: z.array(z.string().min(1).max(500)).max(50),
  obligations: z.array(documentObligationSchema).max(100),
  deadlines: z.array(documentDeadlineSchema).max(50),
  risks: z.array(riskFindingSchema).max(100),
  missingClauses: z.array(missingClauseSchema).max(50),
  contradictions: z.array(z.string().min(1).max(3_000)).max(50),
  questions: z.array(z.string().min(1).max(1_000)).max(30),
  recommendations: z.array(z.string().min(1).max(3_000)).max(50),
  overallQuality: z.object({
    score: z.number().int().min(0).max(100),
    explanation: z.string().min(1).max(3_000),
  }).strict(),
  sources: z.array(documentAnalysisSourceSchema).max(12),
  legalDatabaseAsOf: z.string().max(64),
  extractionWarnings: z.array(z.string().min(1).max(500)).max(20),
}).strict();

export type DocumentAnalysisResult = z.infer<typeof documentAnalysisResultSchema>;

export const documentAnalysisJsonSchema = z.toJSONSchema(documentAnalysisResultSchema, {
  target: "draft-7",
  unrepresentable: "throw",
}) as Record<string, unknown>;

/**
 * Anthropic native structured output compiles the JSON Schema into a grammar.
 * The canonical document contract has a number of `string | null` and
 * `number | null` unions. They are semantically useful to JURO, but make the
 * provider grammar unnecessarily complex. The provider-only wire contract
 * encodes an absent nullable string as "" and an absent nullable page as 0,
 * then restores those sentinels before the canonical Zod boundary below.
 *
 * This is deliberately not a product/data-model change: the canonical result
 * seen by the rest of the pipeline still contains `null`, and every output
 * still passes `documentAnalysisResultSchema` plus source/excerpt checks.
 */
export const documentAnalysisAnthropicWireJsonSchema = replaceNullableUnionsWithSentinels(
  documentAnalysisJsonSchema,
) as Record<string, unknown>;

export function parseDocumentAnalysisResult(value: unknown): DocumentAnalysisResult {
  return documentAnalysisResultSchema.parse(value);
}

export function parseAnthropicDocumentAnalysisWireResult(value: unknown): DocumentAnalysisResult {
  return documentAnalysisResultSchema.parse(decodeAnthropicDocumentAnalysisWireResult(value));
}

function replaceNullableUnionsWithSentinels(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceNullableUnionsWithSentinels);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const union = record.anyOf;
  if (Array.isArray(union) && union.length === 2) {
    const concrete = union.find((member) => isSentinelCompatibleSchema(member));
    const nullable = union.find((member) => isNullSchema(member));
    if (concrete && nullable) {
      const rest = { ...record };
      delete rest.anyOf;
      return replaceNullableUnionsWithSentinels({ ...rest, ...(concrete as Record<string, unknown>) });
    }
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, replaceNullableUnionsWithSentinels(nested)]),
  );
}

function isNullSchema(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).type === "null");
}

function isSentinelCompatibleSchema(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const type = (value as Record<string, unknown>).type;
  return type === "string" || type === "number" || type === "integer";
}

function decodeAnthropicDocumentAnalysisWireResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = structuredClone(value) as Record<string, unknown>;

  restoreNullableString(result, "userSide");
  forEachRecord(result.obligations, (obligation) => {
    restoreNullableString(obligation, "clause");
    restoreNullableString(obligation, "deadline");
  });
  forEachRecord(result.deadlines, (deadline) => {
    restoreNullableString(deadline, "clause");
    restoreNullableString(deadline, "consequence");
  });
  forEachRecord(result.risks, (risk) => {
    restoreNullableString(risk, "clause");
    restoreNullableNumber(risk, "page");
    restoreNullableString(risk, "exactExcerpt");
    restoreNullableString(risk, "proposedWording");
  });
  forEachRecord(result.missingClauses, (clause) => restoreNullableString(clause, "proposedWording"));
  forEachRecord(result.sources, (source) => {
    restoreNullableString(source, "actIdentifier");
    restoreNullableString(source, "article");
    restoreNullableString(source, "excerpt");
  });
  return result;
}

function forEachRecord(value: unknown, callback: (record: Record<string, unknown>) => void): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) callback(item as Record<string, unknown>);
  }
}

function restoreNullableString(record: Record<string, unknown>, key: string): void {
  if (record[key] === "") record[key] = null;
}

function restoreNullableNumber(record: Record<string, unknown>, key: string): void {
  if (record[key] === 0) record[key] = null;
}

export function enforceDocumentAnalysisFreshness(
  result: DocumentAnalysisResult,
  freshness: LegalDatabaseFreshness,
): DocumentAnalysisResult {
  if (freshness.status === "fresh") {
    return { ...result, legalDatabaseAsOf: freshness.asOf };
  }
  const unavailable = freshness.status === "unavailable";
  const warningCode = unavailable
    ? "DOCUMENT_LEGAL_RESEARCH_UNAVAILABLE"
    : `LEGAL_DATABASE_STALE:${freshness.asOf}`;
  return {
    ...result,
    legalComplianceStatus: unavailable
      ? "unverified"
      : result.legalComplianceStatus === "verified"
        ? "partial"
        : result.legalComplianceStatus,
    risks: unavailable
      ? result.risks
        .filter((risk) => risk.riskType === "document_internal")
        .map((risk) => ({ ...risk, legalBasisSourceIds: [] }))
      : result.risks.map((risk) => risk.riskType === "legal_compliance"
        ? { ...risk, confidence: "low" as const }
        : risk),
    missingClauses: unavailable ? [] : result.missingClauses,
    sources: unavailable ? [] : result.sources,
    recommendations: unavailable ? [] : result.recommendations,
    legalDatabaseAsOf: freshness.asOf,
    extractionWarnings: [
      warningCode,
      ...result.extractionWarnings,
    ].slice(0, 20),
  };
}

export function referencedDocumentAnalysisSourceIds(result: DocumentAnalysisResult): Set<string> {
  return new Set([
    ...result.sources.map((source) => source.sourceId),
    ...result.risks.flatMap((risk) => risk.legalBasisSourceIds),
    ...result.missingClauses.flatMap((clause) => clause.legalBasisSourceIds),
  ]);
}

export function enforceDocumentAnalysisSourceBoundary(
  result: DocumentAnalysisResult,
  allowedSourceIds: ReadonlySet<string>,
): DocumentAnalysisResult {
  const declaredSourceIds = new Set<string>();
  for (const source of result.sources) {
    if (declaredSourceIds.has(source.sourceId)) {
      throw new Error(`AI_SOURCE_DUPLICATED:${source.sourceId}`);
    }
    declaredSourceIds.add(source.sourceId);
  }
  for (const sourceId of referencedDocumentAnalysisSourceIds(result)) {
    if (!allowedSourceIds.has(sourceId)) throw new Error(`AI_SOURCE_NOT_ALLOWED:${sourceId}`);
  }
  const citedSourceIds = new Set([
    ...result.risks.flatMap((risk) => risk.legalBasisSourceIds),
    ...result.missingClauses.flatMap((clause) => clause.legalBasisSourceIds),
  ]);
  for (const sourceId of citedSourceIds) {
    if (!declaredSourceIds.has(sourceId)) {
      throw new Error(`AI_CITATION_REFERENCE_MISSING:${sourceId}`);
    }
  }
  if (allowedSourceIds.size === 0) {
    if (result.legalComplianceStatus !== "unverified") throw new Error("LEGAL_COMPLIANCE_REQUIRES_VERIFIED_SOURCE");
    if (result.risks.some((risk) => risk.riskType === "legal_compliance")) {
      throw new Error("LEGAL_COMPLIANCE_RISK_REQUIRES_VERIFIED_SOURCE");
    }
  }
  if (result.legalComplianceStatus === "verified" && declaredSourceIds.size === 0) {
    throw new Error("LEGAL_COMPLIANCE_REQUIRES_CITATION");
  }
  if (result.risks.some((risk) =>
    risk.riskType === "legal_compliance" && risk.legalBasisSourceIds.length === 0
  )) {
    throw new Error("LEGAL_COMPLIANCE_RISK_REQUIRES_CITATION");
  }
  if (result.missingClauses.some((clause) => clause.legalBasisSourceIds.length === 0)) {
    throw new Error("LEGAL_MISSING_CLAUSE_REQUIRES_CITATION");
  }
  return result;
}

export function groundDocumentAnalysisExcerpts(
  result: DocumentAnalysisResult,
  documentText: string,
): DocumentAnalysisResult {
  const risks = result.risks.flatMap(risk => {
    const quote = risk.exactExcerpt;
    if (quote === null || (quote.trim() && documentText.includes(quote))) return [risk];
    if (!quote.trim()) return [];
    const pattern = quote.trim().split(/\s+/u)
      .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const original = new RegExp(pattern, "u").exec(documentText)?.[0];
    return original && original.length <= 2_000 ? [{ ...risk, exactExcerpt: original }] : [];
  });
  if (risks.length === result.risks.length && risks.every((risk, index) => risk === result.risks[index])) return result;
  return {
    ...result,
    risks,
    extractionWarnings: risks.length === result.risks.length ? result.extractionWarnings
      : [...new Set(["DOCUMENT_FINDINGS_WITHOUT_VERIFIED_QUOTES", ...result.extractionWarnings])].slice(0, 20),
  };
}

export function enforceDocumentExcerptBoundary(
  result: DocumentAnalysisResult,
  documentText: string,
): DocumentAnalysisResult {
  if (result.risks.some((risk) => risk.exactExcerpt && !documentText.includes(risk.exactExcerpt))) {
    throw new Error("AI_DOCUMENT_EXCERPT_NOT_FOUND");
  }
  return result;
}
