import { z } from "zod";
import { parseJsonRequest } from "../../../../../../lib/auth/input";
import { workspaceEntitlements } from "../../../../../../lib/billing/entitlements";
import { SubscriptionLimitError, workspaceUsage } from "../../../../../../lib/billing/usage";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { workspaceForContentEditor } from "../../../../../../lib/platform/workspace";

export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  const { analysisId } = await params;
  const db = requireD1();
  const input = await parseJsonRequest(request, z.object({
    pages: z.number().int().positive(),
    first: z.number().int().positive().optional(),
    last: z.number().int().positive().optional(),
  }).strict(), 512);
  if (!input.ok) return Response.json({ code: "QUOTE_INVALID" }, { status: 400 });
  const quote = await db.prepare(`SELECT q.pages,q.selectable,q.confirmed_at AS confirmedAt,q.first_page AS first,q.last_page AS last
    FROM document_analysis_quotes q JOIN document_analyses a ON a.id=q.analysis_id
    WHERE a.id=? AND a.workspace_id=? AND a.owner_user_id=? AND a.deletion_requested_at IS NULL`)
    .bind(analysisId, workspace.id, user.id).first<{ pages: number; selectable: boolean;
      confirmedAt: string | null; first: number | null; last: number | null }>();
  if (!quote || Number(quote.pages) !== input.data.pages) {
    return Response.json({ code: "QUOTE_CHANGED" }, { status: 409 });
  }
  const first = input.data.first ?? 1, last = input.data.last ?? quote.pages;
  if (last < first || last > quote.pages || (!quote.selectable && (first !== 1 || last !== quote.pages))) {
    return Response.json({ code: "QUOTE_INVALID" }, { status: 400 });
  }
  if (quote.confirmedAt) return first === (quote.first ?? 1) && last === (quote.last ?? quote.pages)
    ? Response.json({ accepted: true }) : Response.json({ code: "QUOTE_CHANGED" }, { status: 409 });
  const units = last - first + 1;
  const terms = await workspaceEntitlements(db, workspace.id);
  if (terms.version !== null) {
    const usage = await workspaceUsage(db, workspace.id, user.id, terms);
    if (units > terms.limits.pagesPerRun) throw new SubscriptionLimitError("PAGES_PER_RUN_LIMIT");
    if (units > terms.limits.pages - usage.pages) throw new SubscriptionLimitError("PLAN_LIMIT");
  }
  const now = new Date().toISOString();
  const job = `confirmed-document-analysis:${analysisId}`;
  await db.batch([
    db.prepare(`UPDATE document_analysis_quotes SET confirmed_at=?,first_page=?,last_page=?
      WHERE analysis_id=? AND confirmed_at IS NULL AND EXISTS (
        SELECT 1 FROM document_analyses WHERE id=? AND workspace_id=? AND owner_user_id=?
          AND status='awaiting_confirmation' AND deletion_requested_at IS NULL
      )`).bind(now, first, last, analysisId, analysisId, workspace.id, user.id),
    db.prepare(`UPDATE document_analyses SET status='ready',progress_stage=NULL,updated_at=?
      WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='awaiting_confirmation' AND changes()=1`)
      .bind(now, analysisId, workspace.id, user.id),
    db.prepare(`INSERT OR IGNORE INTO job_outbox
      (id,queue_binding,job_type,schema_version,idempotency_key,subject_id,workspace_id,
       correlation_id,enqueued_at,available_at,status,dispatch_attempts,created_at,updated_at)
       SELECT ?,'DOCUMENT_ANALYSIS_QUEUE','document.analyze',1,?,?,?,?,?,?,'pending',0,?,? WHERE changes()=1`)
      .bind(job, job, analysisId, workspace.id, job, now, now, now, now),
  ]);
  return Response.json({ accepted: true }, { status: 202 });
});
