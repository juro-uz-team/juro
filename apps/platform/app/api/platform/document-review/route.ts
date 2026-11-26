import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { parseJson } from "../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { requireSelectedWorkspace } from "../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  const requestedId = new URL(request.url).searchParams.get("analysisId");
  const [analysisRows, caseRows] = await db.batch([
    db.prepare(
    `SELECT a.id,a.status,a.progress_stage AS progressStage,a.case_id AS caseId,a.summary_json AS summaryJson,a.error_code AS errorCode,a.created_at AS createdAt,a.updated_at AS updatedAt,
      q.pages AS quotePages,q.selectable AS quoteSelectable,
      CASE WHEN a.status <> 'completed' AND EXISTS (
        SELECT 1 FROM job_runs AS job
        WHERE job.job_type IN ('document.analyze','ocr.process')
          AND job.subject_id=a.id
          AND job.workspace_id=a.workspace_id
          AND job.status='dead_lettered'
      ) THEN 1 ELSE 0 END AS retryExhausted,
      f.id AS fileId,f.file_name AS fileName,f.kind AS fileKind,f.mime_type AS mimeType,f.size_bytes AS sizeBytes,
      (SELECT json_group_array(json_object('id',r.id,'level',r.level,'title',r.title,'description',r.description,'excerpt',r.excerpt,'confidencePercent',r.confidence_percent,'riskType',r.risk_type,'clause',r.clause,'page',r.page,'recommendation',r.recommendation,'proposedWording',r.proposed_wording,'legalBasisSourceIds',json(r.legal_basis_source_ids_json)))
       FROM document_risks r WHERE r.analysis_id=a.id) AS risksJson,
       (SELECT json_group_array(json_object('id',e.id,'status',e.status,'format',e.format,'variant',e.variant,'sourceVersionId',e.sourceVersionId,'fileName',e.fileName,'sizeBytes',e.sizeBytes,'errorCode',e.errorCode,'completedAt',e.completedAt,'createdAt',e.createdAt))
       FROM (
         SELECT id,status,format,'analysis_report' AS variant,NULL AS sourceVersionId,file_name AS fileName,
           size_bytes AS sizeBytes,error_code AS errorCode,completed_at AS completedAt,created_at AS createdAt
         FROM analysis_exports WHERE analysis_id=a.id AND workspace_id=a.workspace_id AND owner_user_id=a.owner_user_id
         UNION ALL
         SELECT id,status,format,variant,source_version_id AS sourceVersionId,file_name AS fileName,
           size_bytes AS sizeBytes,error_code AS errorCode,completed_at AS completedAt,created_at AS createdAt
         FROM analysis_report_exports WHERE analysis_id=a.id AND workspace_id=a.workspace_id AND owner_user_id=a.owner_user_id
        ) e) AS exportsJson,
       (SELECT json_group_array(json_object('id',v.id,'documentVersionId',v.document_version_id,'lawyerUserId',v.lawyer_user_id,'status',v.status,'comment',v.comment,'verifiedAt',v.verified_at,'invalidatedAt',v.invalidated_at))
          FROM document_analysis_lawyer_verifications v WHERE v.analysis_id=a.id) AS lawyerVerificationsJson
     FROM document_analyses a JOIN document_files f ON f.id=a.uploaded_file_id
     LEFT JOIN document_analysis_quotes q ON q.analysis_id=a.id
     WHERE a.workspace_id=? AND a.owner_user_id=? AND a.deletion_requested_at IS NULL
     ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END,a.created_at DESC LIMIT 50`,
    ).bind(workspace.id, user.id, requestedId),
    db.prepare(
      `SELECT id,title,status,updated_at AS updatedAt
       FROM cases WHERE workspace_id=? AND case_visible_to(id,?) AND archived_at IS NULL
       ORDER BY updated_at DESC,id LIMIT 100`,
    ).bind(workspace.id, user.id),
  ]);
  return response({
    analyses: analysisRows.results.map(row => {
      const item = row as Record<string, unknown>;
       const { summaryJson, risksJson, exportsJson, lawyerVerificationsJson, retryExhausted, fileKind, ...publicItem } = item;
       return { ...publicItem, sourceAvailable: fileKind === "analysis_safe" || fileKind === "review_upload", retryExhausted: Number(retryExhausted) === 1, summary: parseJson(String(summaryJson || "{}"), null), risks: parseJson(String(risksJson || "[]"), []), exports: parseJson(String(exportsJson || "[]"), []), lawyerVerifications: parseJson(String(lawyerVerificationsJson || "[]"), []) };
    }),
    cases: caseRows.results,
  });
});

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  await requireApiUser();
  return response({
    code: "SECURE_UPLOAD_REQUIRED",
    error: "Multipart endpoint отключён. Используйте потоковый /api/platform/document-analysis/uploads с SHA-256 и проверкой целостности.",
  }, 426);
});
