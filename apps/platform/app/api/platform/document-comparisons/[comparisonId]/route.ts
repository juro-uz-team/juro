import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../lib/document-builder/auth/api";
import { authLocaleFromRequest } from "../../../../../lib/auth/request-locale";
import { isoNow } from "../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../lib/document-builder/storage/runtime";
import {
  comparisonChanges,
  comparisonForUser,
  loadExtractedDocument,
  parsedSummary,
  verifiedSourcesForChanges,
} from "../../../../../lib/document-comparison/storage";
import { assertComparisonSourceFilesClean } from "../../../../../lib/document-comparison/scan-evidence";
import { ComparisonProcessingError } from "../../../../../lib/document-comparison/types";
import {
  comparisonProcessingErrorMessage,
  comparisonRouteErrorMessage,
} from "../../../../../lib/document-comparison/localization";
import { requireSelectedWorkspace, workspaceForContentEditor } from "../../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

export const GET = withApiErrors(async function GET(
  request: Request,
  context: { params: Promise<{ comparisonId: string }> },
) {
  const locale = authLocaleFromRequest(request);
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const { comparisonId } = await context.params;
  const db = requireD1();
  const comparison = await comparisonForUser(db, comparisonId, workspace.id, user.id);
  if (!comparison) {
    return response({ error: comparisonRouteErrorMessage("COMPARISON_NOT_FOUND", locale) }, 404);
  }
  try {
    await assertComparisonSourceFilesClean(db, {
      versionOneFileId: comparison.versionOneFileId,
      versionTwoFileId: comparison.versionTwoFileId,
      workspaceId: workspace.id,
      ownerUserId: user.id,
    });
  } catch (error) {
    if (error instanceof ComparisonProcessingError) {
      return response({
        code: error.code,
        error: comparisonProcessingErrorMessage(error.code, locale),
      }, 422);
    }
    throw error;
  }
  const changes = await comparisonChanges(db, comparisonId);
  const [versionOne, versionTwo, sources, exportsResult] = await Promise.all([
    loadExtractedDocument(comparison.versionOneJsonKey),
    loadExtractedDocument(comparison.versionTwoJsonKey),
    verifiedSourcesForChanges(db, changes, parsedSummary(comparison.summaryJson)?.sources),
    db.prepare(
      `SELECT id,comparison_id AS comparisonId,format,status,file_name AS fileName,mime_type AS mimeType,
        size_bytes AS sizeBytes,error_code AS errorCode,completed_at AS completedAt,created_at AS createdAt
       FROM comparison_exports WHERE comparison_id=? AND workspace_id=? AND owner_user_id=?
       ORDER BY created_at DESC LIMIT 20`,
    ).bind(comparisonId, workspace.id, user.id).all(),
  ]);
  return response({
    comparison: {
      ...comparison,
      summary: parsedSummary(comparison.summaryJson),
      versionOne: versionOne ?? {
        fileName: comparison.versionOneName,
        mimeType: comparison.versionOneMimeType,
        sizeBytes: comparison.versionOneSizeBytes,
      },
      versionTwo: versionTwo ?? {
        fileName: comparison.versionTwoName,
        mimeType: comparison.versionTwoMimeType,
        sizeBytes: comparison.versionTwoSizeBytes,
      },
      changes,
      sources,
      exports: exportsResult.results,
    },
  });
});

export const PATCH = withApiErrors(async function PATCH(
  request: Request,
  context: { params: Promise<{ comparisonId: string }> },
) {
  assertSafeWrite(request);
  const locale = authLocaleFromRequest(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user);
  const { comparisonId } = await context.params;
  const db = requireD1();
  const comparison = await comparisonForUser(db, comparisonId, workspace.id, user.id);
  if (!comparison) {
    return response({ error: comparisonRouteErrorMessage("COMPARISON_NOT_FOUND", locale) }, 404);
  }
  try {
    await assertComparisonSourceFilesClean(db, {
      versionOneFileId: comparison.versionOneFileId,
      versionTwoFileId: comparison.versionTwoFileId,
      workspaceId: workspace.id,
      ownerUserId: user.id,
    });
  } catch (error) {
    if (error instanceof ComparisonProcessingError) {
      return response({
        code: error.code,
        error: comparisonProcessingErrorMessage(error.code, locale),
      }, 422);
    }
    throw error;
  }
  const body = await request.json() as { changeId?: string; reviewed?: boolean; caseId?: string | null };
  if (body.changeId) {
    const result = await db.prepare(
      `UPDATE comparison_changes SET reviewed_at=?
       WHERE id=? AND comparison_id=? AND EXISTS (
         SELECT 1 FROM document_comparisons c
         WHERE c.id=comparison_changes.comparison_id AND c.workspace_id=? AND c.owner_user_id=? AND c.deleted_at IS NULL
       )`,
    ).bind(body.reviewed === false ? null : isoNow(), body.changeId, comparisonId, workspace.id, user.id).run();
    if (!result.meta.changes) {
      return response({
        error: comparisonRouteErrorMessage("COMPARISON_CHANGE_NOT_FOUND", locale),
      }, 404);
    }
    return response({ ok: true });
  }
  if (Object.prototype.hasOwnProperty.call(body, "caseId")) {
    if (body.caseId) {
      const accessibleCase = await db.prepare(
        "SELECT id FROM cases WHERE id=? AND workspace_id=? AND archived_at IS NULL LIMIT 1",
      ).bind(body.caseId, workspace.id).first();
      if (!accessibleCase) {
        return response({
          error: comparisonRouteErrorMessage("COMPARISON_CASE_UNAVAILABLE", locale),
        }, 403);
      }
    }
    await db.prepare(
      "UPDATE document_comparisons SET case_id=?,updated_at=? WHERE id=? AND workspace_id=? AND owner_user_id=?",
    ).bind(body.caseId || null, isoNow(), comparisonId, workspace.id, user.id).run();
    return response({ ok: true });
  }
  return response({
    error: comparisonRouteErrorMessage("COMPARISON_UNSUPPORTED_CHANGE", locale),
  }, 400);
});

export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  context: { params: Promise<{ comparisonId: string }> },
) {
  assertSafeWrite(request);
  const locale = authLocaleFromRequest(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user);
  const { comparisonId } = await context.params;
  const db = requireD1();
  const comparison = await comparisonForUser(db, comparisonId, workspace.id, user.id);
  if (!comparison) {
    return response({ error: comparisonRouteErrorMessage("COMPARISON_NOT_FOUND", locale) }, 404);
  }
  const now = isoNow();
  await db.batch([
    db.prepare(
      "UPDATE document_comparisons SET status='deleted',deleted_at=?,updated_at=? WHERE id=? AND workspace_id=? AND owner_user_id=?",
    ).bind(now, now, comparisonId, workspace.id, user.id),
    db.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'document_comparison',?,'comparison_deleted',?,?)`,
    ).bind(crypto.randomUUID(), workspace.id, user.id, comparisonId, JSON.stringify({
      retention: "soft_delete_pending_policy_cleanup",
    }), now),
  ]);
  return response({ ok: true, retention: "soft_delete_pending_policy_cleanup" });
});
