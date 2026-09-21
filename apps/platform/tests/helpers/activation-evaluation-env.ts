import {createHash} from "node:crypto";
import type {TargetRetrievalRuntimeEnv} from "../../lib/legal-corpus/target-runtime";

const activationEvaluationReport = {
  releaseId: "release:staging:history:evaluation-v1",
  corpusSnapshotId: "snapshot:staging:evaluation-v1", chunkCount: 20,
  materializationComplete: true, sparseReductionComplete: true,
  vectorizeFullListReconciled: true, regularApiOnly: true, batchApiUsed: false,
};
export const activationEvaluationReportSha256 = createHash("sha256")
  .update(`${JSON.stringify(activationEvaluationReport, null, 2)}\n`).digest("hex");

export function activationSetEvaluationEnv(plans: Record<string, unknown> = {}): TargetRetrievalRuntimeEnv {
  const currentId = "release:staging:current:evaluation-v1";
  const historyId = "release:staging:history:evaluation-v1";
  const snapshotId = "snapshot:staging:evaluation-v1";
  const report = activationEvaluationReport;
  const db = { prepare(sql: string) { return { bind() {
    if (sql.includes("FROM legal_activation_sets candidate")) return { first: async () => ({
      id: "activation:staging:evaluation-v1", environment: "staging",
      currentReleaseId: currentId, asOfReleaseId: historyId,
      comparisonCurrentReleaseId: currentId, comparisonHistoryReleaseId: historyId,
      previousActivationSetId: "activation:staging:current-v1",
      activeActivationSetId: "activation:staging:current-v1",
    }) };
    if (sql.includes("FROM legal_search_releases release")) return { all: async () => ({ results: [
      { id: currentId, environment: "staging", capability: "current", corpusSnapshotId: snapshotId,
        status: "sealed", itemCount: 10, retrievalPolicyVersion: "custom-hybrid-temporal-v1",
        configurationIdentity: "custom-hybrid-staging-pair-v1", snapshotStatus: "frozen",
        chunkCount: 10, mappingCount: 10, configurationSha256: "a".repeat(64) },
      { id: historyId, environment: "staging", capability: "history", corpusSnapshotId: snapshotId,
        status: "draft", itemCount: 20, retrievalPolicyVersion: "custom-hybrid-temporal-v1",
        configurationIdentity: "custom-hybrid-staging-pair-v1", snapshotStatus: "frozen",
        chunkCount: 20, mappingCount: 20, configurationSha256: "a".repeat(64) },
    ] }) };
    if (sql.includes("FROM legal_search_release_governance")) {
      return { first: async () => ({ id: "governance:staging:current:evaluation-v1" }) };
    }
    if (sql.includes("FROM legal_migration_reconciliation_reports")) return { first: async () => ({
      environment: "staging", releaseId: historyId, capability: "history", status: "clean",
      reportSha256: activationEvaluationReportSha256, reportJson: JSON.stringify(report),
    }) };
    if (sql.includes("legal_custom_search_trusted_titles")) {
      return { all: async () => ({ results: [{ title: "Labor Code" }] }) };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } }; } } as unknown as D1Database;
  const reasoning = { async fetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = new Request(input, init);
    const body = await request.json() as Record<string, unknown>;
    if (new URL(request.url).pathname.endsWith("/interpret")) {
      const question = String(body.question);
      return Response.json({ result: plans[question.replace("Question for ", "")] });
    }
    if (new URL(request.url).pathname.endsWith("/classify-private-names")) {
      return Response.json({ classifierVersion: "juro-local-pii-v1",
        formulationSha256: body.formulationSha256, status: "complete", privateNameSpans: [] });
    }
    return Response.json({ code: "UNEXPECTED" }, { status: 500 });
  } } as Fetcher;
  const unavailable = { async fetch() {
    return Response.json({ code: "INDEX_UNAVAILABLE" }, { status: 503 });
  } } as unknown as Fetcher;
  return { APP_ENV: "staging", LEGAL_CORPUS_SHADOW_MODE: "true", LEGAL_DB: db,
    LEGAL_EVIDENCE_BUCKET: { get: async () => null },
    LEGAL_CUSTOM_ARTIFACT_BUCKET: { get: async () => null } as unknown as R2Bucket,
    LEGAL_CORPUS_REASONING_SERVICE: reasoning,
    LEGAL_CUSTOM_SEARCH_SERVICE: unavailable,
    LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE: unavailable,
    LEGAL_AI_GATEWAY_ID: "juro-ai-search-staging",
    LEGAL_AI_PROVIDER_PROJECT_ID: "juro-openai-staging" };
}
