import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("legacy document review POST cannot buffer a file or invoke an AI provider", () => {
  const route = source("app/api/platform/document-review/route.ts");
  assert.match(route, /SECURE_UPLOAD_REQUIRED/);
  assert.match(route, /document-analysis\/uploads/);
  assert.doesNotMatch(route, /request\.formData\(|arrayBuffer\(|callOpenAiJson|callAnthropic/);
});

test("secure upload routes enforce streaming, checksum, tenant, quarantine, and malware-scan boundaries", () => {
  const init = source("app/api/platform/document-analysis/uploads/route.ts");
  const upload = source("app/api/platform/document-analysis/uploads/[analysisId]/route.ts");
  const finalize = source("app/api/platform/document-analysis/uploads/[analysisId]/finalize/route.ts");
  const pipeline = source("lib/document-analysis/upload-pipeline.ts");
  for (const route of [init, upload, finalize]) {
    assert.match(route, /requireApiUser/);
    assert.match(route, /workspaceForContentEditor/);
  }
  assert.match(init, /idempotency-key/);
  assert.match(upload, /request\.body/);
  assert.match(upload, /sha256: record\.sha256/);
  assert.match(upload, /content-length/);
  assert.match(upload, /status='uploading'/);
  assert.match(upload, /claimed\.meta\?\.changes/);
  assert.match(upload, /finalized\[0\]\?\.meta\?\.changes/);
  assert.match(upload, /finalized\[1\]\?\.meta\?\.changes/);
  assert.match(upload, /await quarantine\.delete\(record\.r2Key\)/);
  assert.match(finalize, /validateUploadMagicBytes/);
  assert.match(finalize, /await verifyArchiveBytes\(/);
  assert.doesNotMatch(finalize, /inspectArchiveBytes\(/);
  assert.match(finalize, /analysis_quarantined/);
  assert.match(finalize, /FILE_SCAN_QUEUED/);
  assert.match(finalize, /INSERT OR IGNORE INTO job_outbox/);
  assert.match(pipeline, /quarantine-v2/);
  assert.match(upload, /requireQuarantineR2\(\)/);
  assert.match(finalize, /requireQuarantineR2\(\)/);
  assert.match(finalize, /MALWARE_SCAN_QUEUE/);
  assert.match(finalize, /malware\.scan/);
  assert.doesNotMatch(`${upload}\n${finalize}`, /quarantine-bypass|analysis-direct|upload_direct_analysis_queued/);
  assert.doesNotMatch(`${upload}\n${finalize}`, /callOpenAiJson|callAnthropic/);
});

test("analysis deletion is owner-scoped, CSRF-protected, vector-aware, and retryable", () => {
  const route = source("app/api/platform/document-analysis/[analysisId]/route.ts");
  const retention = source("lib/document-analysis/resource-retention.ts");
  const review = source("app/_platform/DocumentReviewClient.tsx");
  const reviewCopy = source("app/_platform/document-review-localization.ts");
  assert.match(route, /assertSafeWrite/);
  assert.match(route, /requireApiUser/);
  assert.match(route, /workspaceForUser/);
  assert.match(retention, /analysis\.owner_user_id=\?/);
  assert.match(retention, /legal_corpus_owner_upload_requests/);
  assert.match(retention, /document_comparisons/);
  assert.match(retention, /deleteUserDocumentVectorsForAnalysis/);
  assert.match(retention, /analysis_content_purged/);
  assert.match(retention, /purge_attempt_count=purge_attempt_count\+1/);
  assert.match(reviewCopy, /Удалить анализ, исходный файл, результаты и экспорты/);
  assert.match(review, /x-juro-csrf/);
});

test("archive finalize verifies local identity, bounded expansion, and CRC before direct analysis", () => {
  const archive = source("lib/document-analysis/archive-inspector.ts");
  assert.match(archive, /LOCAL_SIGNATURE/);
  assert.match(archive, /DATA_DESCRIPTOR_SIGNATURE/);
  assert.match(archive, /ARCHIVE_POLYGLOT_REJECTED/);
  assert.match(archive, /DecompressionStream\("deflate-raw"/);
  assert.match(archive, /ARCHIVE_VERIFICATION_TIMEOUT/);
  assert.match(archive, /ARCHIVE_CRC_MISMATCH/);
});

test("dashboard and review surfaces use the secure upload client", () => {
  const dashboard = source("app/_platform/DashboardClient.tsx");
  const review = source("app/_platform/DocumentReviewClient.tsx");
  const uploadClient = source("lib/document-analysis/client-upload.ts");
  assert.match(dashboard, /uploadDocumentForAnalysis\(file, locale, setUploadProgress\)/);
  assert.match(review, /uploadDocumentForAnalysis\(file, locale, setUploadProgress, uploadCaseId \|\| null, analysisLocale\)/);
  assert.match(dashboard, /role="progressbar"/);
  assert.match(review, /role="progressbar"/);
  assert.match(uploadClient, /new XMLHttpRequest\(\)/);
  assert.match(uploadClient, /request\.upload\.addEventListener\("progress"/);
  assert.match(uploadClient, /x-juro-file-sha256/);
  assert.doesNotMatch(`${dashboard}\n${review}`, /new FormData\(\)/);
});

test("review surface polls actual background analysis states and makes retry exhaustion explicit", () => {
  const review = source("app/_platform/DocumentReviewClient.tsx");
  const reviewRoute = source("app/api/platform/document-review/route.ts");
  assert.match(review, /const analysisPending = analyses\.some/);
  for (const status of [
    "ready",
    "processing",
    "persisting",
    "awaiting_ocr",
    "ocr_processing",
    "retrying",
  ]) {
    assert.match(review, new RegExp(`"${status}"`));
  }
  assert.match(reviewRoute, /job\.job_type IN \('document\.analyze','ocr\.process'\)/);
  assert.match(reviewRoute, /job\.workspace_id=a\.workspace_id/);
  assert.match(reviewRoute, /job\.status='dead_lettered'/);
  assert.match(reviewRoute, /retryExhausted: Number\(retryExhausted\) === 1/);
  assert.match(review, /Автоматические попытки остановлены/);
  assert.match(review, /Qayta ishga tushirish kerak/);
  assert.match(review, /window\.setInterval\(\(\) => \{ void load\(\); \}, 5_000\)/);
});

test("analysis revision routes preserve auth, tenant, idempotency, and object-integrity boundaries", () => {
  const collection = source("app/api/platform/document-analysis/[analysisId]/revisions/route.ts");
  const decision = source("app/api/platform/document-analysis/[analysisId]/revisions/[revisionId]/route.ts");
  const download = source("app/api/platform/document-analysis/[analysisId]/versions/[versionId]/file/route.ts");
  for (const route of [collection, decision, download]) {
    assert.match(route, /requireApiUser/);
    assert.doesNotMatch(route, /OPENAI_API_KEY|ANTHROPIC_API_KEY|callOpenAiJson|callAnthropic/);
  }
  for (const route of [collection, decision]) assert.match(route, /workspaceForContentEditor/);
  assert.match(download, /workspaceForUser/);
  assert.match(collection, /idempotency-key/);
  assert.match(collection, /applySuggestedRevisions/);
  assert.match(decision, /decideSuggestedRevision/);
  assert.match(download, /verifiedAnalysisVersionObject/);
  assert.match(download, /analysisVersionForDownload/);
  assert.match(download, /content-disposition/);
});

test("comparison change decisions are validated, tenant-scoped, audited, and do not merge documents", () => {
  const route = source("app/api/platform/document-comparisons/[comparisonId]/changes/[changeId]/route.ts");
  const service = source("lib/document-comparison/review-decision.ts");
  const localization = source("lib/document-comparison/localization.ts");
  const client = source("app/_platform/ComparisonResultClient.tsx");
  assert.match(route, /decisionSchema/);
  assert.match(route, /locale: z\.enum\(\["ru", "uz", "en"\]\)/);
  assert.match(route, /The change could not be found/);
  assert.match(route, /comparisonProcessingErrorMessage/);
  assert.match(localization, /en: "File security validation has not completed\."/);
  assert.match(route, /assertSafeWrite/);
  assert.match(route, /requireApiUser/);
  assert.match(route, /workspaceForContentEditor/);
  assert.match(route, /decideComparisonChange/);
  assert.match(service, /comparison\.workspace_id=\?/);
  assert.match(service, /comparison\.owner_user_id=\?/);
  assert.match(service, /comparison_change_accepted/);
  assert.match(service, /comparison_change_rejected/);
  assert.match(service, /comparison_change_decision_cleared/);
  assert.doesNotMatch(`${route}\n${service}`, /INSERT INTO document_versions|callOpenAiJson|callAnthropic/);
  assert.match(client, /aria-pressed/);
  assert.match(client, /decisionSaving/);
  assert.match(client, /decision \?\? "pending"/);
  assert.doesNotMatch(client, /const\s+ru\s*=\s*locale\s*===\s*["']ru["']/u);
  assert.match(client, /en: "The file is corrupted or was deleted during processing\."/u);
});

test("scanner promotion requires strict evidence and never trusts document instructions", () => {
  const scanner = source("lib/document-analysis/malware-scanner.ts");
  assert.match(scanner, /malwareScannerResponseSchema/);
  assert.match(scanner, /sourceSha256 !== sourceSha256/);
  assert.match(scanner, /checksums\.sha256/);
  assert.match(scanner, /analysis_quarantined/);
  assert.match(scanner, /analysis_safe/);
  assert.match(scanner, /analysis_rejected/);
  assert.match(scanner, /FILE_UNSAFE/);
  assert.match(scanner, /DOCUMENT_ANALYSIS_QUEUE/);
  assert.match(scanner, /UPDATE document_analyses SET status='ready'/);
  assert.match(scanner, /AND status='quarantined'/);
  assert.doesNotMatch(scanner, /UPDATE document_analyses SET status='safe'/);
});

test("AI and document processors revalidate provider citations before persistence", () => {
  const aiRoute = source("app/api/platform/ai/route.ts");
  const gateway = source("lib/ai/legal-ai-gateway.ts");
  const processor = source("lib/document-analysis/processor.ts");
  assert.match(aiRoute, /gateway\.generateGroundedAnswer\(/);
  assert.match(gateway, /validateLegalGatewayAnswer\(/);
  assert.match(gateway, /sourceSpanId/);
  const validationFailure = aiRoute.slice(aiRoute.indexOf("validationStage.fail()"),aiRoute.indexOf("// A disconnected caller"));
  assert.match(validationFailure, /"FINAL_SOURCE_OBSERVATION_UNAVAILABLE"\s*\? "SOURCE_OBSERVATION_UNAVAILABLE" : "INVALID_AI_OUTPUT"/);
  assert.match(validationFailure, /await failAiRun\(\{[\s\S]*errorCode: code/);
  assert.match(validationFailure, /return response\(\{\s*code,[\s\S]*code === "SOURCE_OBSERVATION_UNAVAILABLE" \? 503 : 422\)/);
  assert.match(aiRoute, /originalUrl: source\.officialUrl/);
  assert.match(processor, /enforceDocumentAnalysisSourceBoundary\(/);
  assert.match(processor, /enforceDocumentExcerptBoundary\(/);
  const provider = source("lib/document-analysis/provider.ts");
  assert.match(provider, /untrustedDocument\.documentText/);
  assert.match(processor, /originalUrl: source\.officialUrl/);
  assert.doesNotMatch(processor, /publishPendingOwnerCorpusUpload/);
  assert.match(
    processor,
    /setAnalysisState\(env\.DB, row, "failed", "DOCUMENT_ANALYSIS_INVALID_OUTPUT"\)/,
  );
});

test("ZIP analysis uses the verified package extractor and never sends an opaque archive to OCR", () => {
  const processor = source("lib/document-analysis/processor.ts");
  const extractor = source("lib/document-analysis/package-extractor.ts");
  assert.match(processor, /extract:\s*extractAnalysisDocument/);
  assert.match(processor, /row\.mimeType === "application\/zip"/);
  assert.match(processor, /DOCUMENT_ANALYSIS_PACKAGE_OCR_REQUIRED/);
  assert.match(extractor, /await verifyArchiveBytes\(input\.bytes, input\.mimeType\)/);
  assert.match(extractor, /MAX_PACKAGE_PAGES = 500/);
  assert.match(extractor, /MAX_INLINE_MEMBER_BYTES = 20 \* 1024 \* 1024/);
  assert.match(extractor, /MAX_INLINE_PACKAGE_BYTES = 50 \* 1024 \* 1024/);
  assert.match(extractor, /PACKAGE_MULTI_DOCUMENT/);
});
