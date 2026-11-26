import { retrieveDocumentLegalSources } from "../../../../../../lib/document-analysis/corpus-sources";
import { planDocumentAnalysis } from "../../../../../../lib/document-analysis/chunking";
import { runDocumentAnalysis } from "../../../../../../lib/document-analysis/provider";
import { authLocaleFromRequest } from "../../../../../../lib/auth/request-locale";
import { AiUnavailableError } from "../../../../../../lib/document-builder/ai/openai";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../lib/document-builder/storage/db";
import { getPrivateObject, putPrivateObject } from "../../../../../../lib/document-builder/storage/files";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { compareDocuments, summarizeChanges } from "../../../../../../lib/document-comparison/diff";
import { extractDocument } from "../../../../../../lib/document-comparison/extract";
import { enrichComparisonChanges } from "../../../../../../lib/document-comparison/legal-analysis";
import {
  comparisonProcessingErrorMessage,
  comparisonRouteErrorMessage,
} from "../../../../../../lib/document-comparison/localization";
import {
  assertComparisonFileScanEvidence,
  assertComparisonSourceFilesClean,
  type ComparisonFileRecord,
} from "../../../../../../lib/document-comparison/scan-evidence";
import {
  comparisonForUser,
  loadExtractedDocument,
} from "../../../../../../lib/document-comparison/storage";
import { ComparisonProcessingError, type ComparisonChange, type ComparisonLocale } from "../../../../../../lib/document-comparison/types";
import { ArchiveInspectionError, verifyArchiveBytes } from "../../../../../../lib/document-analysis/archive-inspector";
import { workspaceForContentEditor } from "../../../../../../lib/platform/workspace";
import { isLocale } from "../../../../../../lib/platform/routing";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

async function updateStage(db: D1Database, comparisonId: string, workspaceId: string, stage: string) {
  await db.prepare(
    "UPDATE document_comparisons SET status='processing',stage=?,error_code=NULL,updated_at=? WHERE id=? AND workspace_id=?",
  ).bind(stage, isoNow(), comparisonId, workspaceId).run();
}

async function fileBytes(file: ComparisonFileRecord, locale: ComparisonLocale) {
  const object = await getPrivateObject(file.r2Key);
  if (!object) {
    throw new ComparisonProcessingError(
      "CORRUPT_FILE",
      comparisonProcessingErrorMessage("CORRUPT_FILE", locale),
    );
  }
  assertComparisonFileScanEvidence(file, object);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      await verifyArchiveBytes(bytes, file.mimeType, {
        timeoutMs: 8_000,
        maxEntries: 500,
        maxUncompressedBytes: 25 * 1024 * 1024,
        maxExpansionRatio: 40,
      });
    } catch (error) {
      if (error instanceof ArchiveInspectionError) {
        throw new ComparisonProcessingError(
          "CORRUPT_FILE",
          comparisonProcessingErrorMessage("CORRUPT_FILE", locale),
        );
      }
      throw error;
    }
  }
  return { ...file, bytes };
}

async function storeChanges(db: D1Database, comparisonId: string, changes: ComparisonChange[]) {
  await db.prepare("DELETE FROM comparison_changes WHERE comparison_id=?").bind(comparisonId).run();
  for (let offset = 0; offset < changes.length; offset += 60) {
    const batch = changes.slice(offset, offset + 60).map((change) => db.prepare(
      `INSERT INTO comparison_changes
       (id,comparison_id,ordinal,change_type,before_section_id,after_section_id,before_label,after_label,
        before_heading,after_heading,before_text,after_text,word_diff_json,summary,legal_effect,
        affected_party,risk_effect,risk_level,recommendation,source_ids_json,confidence_percent,
        reviewed_at,extraction_warning,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      change.id, comparisonId, change.ordinal, change.changeType,
      change.beforeSectionId, change.afterSectionId, change.beforeLabel, change.afterLabel,
      change.beforeHeading, change.afterHeading, change.beforeText, change.afterText,
      JSON.stringify(change.wordDiff), change.summary, change.legalEffect, change.affectedParty,
      change.riskEffect, change.riskLevel, change.recommendation, JSON.stringify(change.sourceIds),
      change.confidencePercent, change.reviewedAt, change.extractionWarning ? 1 : 0, isoNow(),
    ));
    if (batch.length) await db.batch(batch);
  }
}

export const POST = withApiErrors(async function POST(
  request: Request,
  context: { params: Promise<{ comparisonId: string }> },
) {
  assertSafeWrite(request);
  const requestedLocale = authLocaleFromRequest(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user);
  const { comparisonId } = await context.params;
  const db = requireD1();
  const comparison = await comparisonForUser(db, comparisonId, workspace.id, user.id);
  if (!comparison) {
    return response({
      error: comparisonRouteErrorMessage("COMPARISON_NOT_FOUND", requestedLocale),
    }, 404);
  }
  const locale = isLocale(comparison.locale) ? comparison.locale : requestedLocale;
  let sourceFiles: [ComparisonFileRecord, ComparisonFileRecord];
  try {
    sourceFiles = await assertComparisonSourceFilesClean(db, {
      versionOneFileId: comparison.versionOneFileId,
      versionTwoFileId: comparison.versionTwoFileId,
      workspaceId: workspace.id,
      ownerUserId: user.id,
    });
  } catch (error) {
    const code = error instanceof ComparisonProcessingError ? error.code : "COMPARISON_PROCESSING_FAILED";
    await db.prepare(
      "UPDATE document_comparisons SET status='failed',error_code=?,updated_at=? WHERE id=? AND workspace_id=? AND owner_user_id=?",
    ).bind(code, isoNow(), comparisonId, workspace.id, user.id).run();
    return response({
      error: error instanceof ComparisonProcessingError
        ? comparisonProcessingErrorMessage(error.code, locale)
        : comparisonRouteErrorMessage("COMPARISON_UNAVAILABLE", locale),
      code,
      comparison: { id: comparisonId, status: "failed", stage: comparison.stage },
    }, 422);
  }
  if (comparison.status === "completed") return response({ comparison: { id: comparisonId, status: comparison.status, stage: comparison.stage } });
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const lock = await db.prepare(
    `UPDATE document_comparisons SET status='processing',error_code=NULL,updated_at=?
     WHERE id=? AND workspace_id=? AND owner_user_id=? AND deleted_at IS NULL
       AND (status!='processing' OR updated_at<?)`,
  ).bind(isoNow(), comparisonId, workspace.id, user.id, staleBefore).run();
  if (!lock.meta.changes) {
    return response({
      error: comparisonRouteErrorMessage("COMPARISON_ALREADY_PROCESSING", locale),
    }, 409);
  }

  try {
    const [versionOneFile, versionTwoFile] = sourceFiles;
    let versionOne = await loadExtractedDocument(comparison.versionOneJsonKey);
    if (!versionOne) {
      await updateStage(db, comparisonId, workspace.id, "extracting_version_one");
      const firstFile = await fileBytes(versionOneFile, locale);
      versionOne = await extractDocument(firstFile);
      const versionOneJsonKey = `workspaces/${workspace.id}/comparisons/${comparisonId}/version-one.json`;
      await putPrivateObject(versionOneJsonKey, new TextEncoder().encode(JSON.stringify(versionOne)), "application/json", {
        comparisonId, version: "one", workspaceId: workspace.id,
      });
      await db.prepare(
        "UPDATE document_comparisons SET version_one_json_key=?,updated_at=? WHERE id=? AND workspace_id=?",
      ).bind(versionOneJsonKey, isoNow(), comparisonId, workspace.id).run();
    }

    let versionTwo = await loadExtractedDocument(comparison.versionTwoJsonKey);
    if (!versionTwo) {
      await updateStage(db, comparisonId, workspace.id, "extracting_version_two");
      const secondFile = await fileBytes(versionTwoFile, locale);
      versionTwo = await extractDocument(secondFile);
      const versionTwoJsonKey = `workspaces/${workspace.id}/comparisons/${comparisonId}/version-two.json`;
      await putPrivateObject(versionTwoJsonKey, new TextEncoder().encode(JSON.stringify(versionTwo)), "application/json", {
        comparisonId, version: "two", workspaceId: workspace.id,
      });
      await db.prepare(
        "UPDATE document_comparisons SET version_two_json_key=?,updated_at=? WHERE id=? AND workspace_id=?",
      ).bind(versionTwoJsonKey, isoNow(), comparisonId, workspace.id).run();
    }

    await updateStage(db, comparisonId, workspace.id, "structuring");
    await updateStage(db, comparisonId, workspace.id, "diffing");
    let result = compareDocuments(versionOne, versionTwo, locale);
    result = {
      ...result,
      changes: result.changes.map((change) => ({
        ...change,
        id: `${comparisonId}-change-${change.ordinal}`,
        extractionWarning: versionOne.textQuality !== "good" || versionTwo.textQuality !== "good",
      })),
    };

    const changed = result.changes.filter(change => !["unchanged", "formatting"].includes(change.changeType));
    let aiStatus: "completed" | "unavailable" | "not_required" | "failed" = "not_required";
    let model: string | null = null;
    const citedIds = new Set<string>();
    await updateStage(db, comparisonId, workspace.id, "legal_analysis");
    const research = await retrieveDocumentLegalSources(
      db,
      changed.length
        ? changed.slice(0, 12).map(change => [change.beforeText, change.afterText].filter(Boolean).join("\n")).join("\n\n")
        : versionTwo.text,
      locale, changed.length ? 8 : 5,
      { id: comparisonId, workspaceId: workspace.id, userId: user.id },
    );
    const legalSources = research.freshness.status === "fresh" ? research.sources : [];
    try {
      if (changed.length) {
        const enriched = await enrichComparisonChanges({ changes: result.changes, locale, sources: legalSources });
        result = { ...result, changes: enriched.changes };
        model = enriched.model;
        aiStatus = "completed";
        for (const change of result.changes) for (const sourceId of change.sourceIds) citedIds.add(sourceId);
      } else if (legalSources.length) {
        const plan = planDocumentAnalysis(versionTwo.text, "quick");
        const context = await runDocumentAnalysis({
          fileName: versionTwo.fileName, mimeType: versionTwo.mimeType, extractedText: plan.chunks[0].text,
          detectedLanguage: versionTwo.detectedLanguage,
          extractionWarnings: plan.representativeSample ? ["DOCUMENT_QUICK_REPRESENTATIVE_SAMPLE"] : [],
          packageContext: null, locale: ({ ru: "ru", uz: "uz", en: "ru" } as const)[locale], mode: "quick", userSide: null,
          sources: legalSources, legalDatabaseAsOf: research.legalDatabaseAsOf,
          requestId: `comparison-legal-context-${comparisonId}`,
        });
        for (const source of context.data.sources) citedIds.add(source.sourceId);
        model = context.model;
        aiStatus = "completed";
      } else if (research.freshness.status !== "fresh") {
        aiStatus = "unavailable";
      }
    } catch (error) {
      aiStatus = error instanceof AiUnavailableError ? "unavailable" : "failed";
    }

    const summary = summarizeChanges(result.changes, result.summary.similarityPercent, isoNow());
    summary.aiStatus = aiStatus;
    summary.model = model;
    summary.legalResearchScope = changed.length ? "changes" : "document";
    summary.sources = legalSources.filter(source => citedIds.has(source.id));
    summary.sourceStatus = summary.sources.length
      ? (changed.length && result.changes.every((change) => change.riskLevel === "information" || change.sourceIds.length) ? "verified" : "partial")
      : "unverified";
    result = { ...result, summary };
    await storeChanges(db, comparisonId, result.changes);
    const completedStatus = aiStatus === "completed" || aiStatus === "not_required" ? "completed" : "completed_partial";
    await db.batch([
      db.prepare(
        `UPDATE document_comparisons
         SET status=?,stage='completed',summary_json=?,similarity_percent=?,overall_risk=?,
           ai_status=?,model_name=?,model_version=?,error_code=NULL,updated_at=?
         WHERE id=? AND workspace_id=?`,
      ).bind(
        completedStatus, JSON.stringify(summary), summary.similarityPercent, summary.overallRisk,
        aiStatus, model ? "openai" : null, model, isoNow(), comparisonId, workspace.id,
      ),
      db.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'document_comparison',?,'comparison_completed',?,?)`,
      ).bind(crypto.randomUUID(), workspace.id, user.id, comparisonId, JSON.stringify({
        totalChanges: summary.totalChanges,
        materialChanges: summary.materialChanges,
        similarityPercent: summary.similarityPercent,
        aiStatus,
      }), isoNow()),
    ]);
    return response({ comparison: { id: comparisonId, status: completedStatus, stage: "completed", summary } });
  } catch (error) {
    const code = error instanceof ComparisonProcessingError ? error.code : "COMPARISON_PROCESSING_FAILED";
    await db.prepare(
      "UPDATE document_comparisons SET status='failed',error_code=?,updated_at=? WHERE id=? AND workspace_id=?",
    ).bind(code, isoNow(), comparisonId, workspace.id).run();
    const failedState = await db.prepare(
      "SELECT stage FROM document_comparisons WHERE id=? AND workspace_id=? LIMIT 1",
    ).bind(comparisonId, workspace.id).first<{ stage: string }>();
    return response({
      error: comparisonProcessingErrorMessage(code, locale),
      code,
      comparison: { id: comparisonId, status: "failed", stage: failedState?.stage || comparison.stage },
    }, 422);
  }
});
