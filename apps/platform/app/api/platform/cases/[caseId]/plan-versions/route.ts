import {
  requireApiUser,
  withApiErrors,
} from "../../../../../../lib/document-builder/auth/api";
import { parseJson } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { workspaceForUser } from "../../../../../../lib/platform/workspace";

export const GET = withApiErrors(async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const user = await requireApiUser();
  const { caseId } = await params;
  const workspace = await workspaceForUser(user);
  const db = requireD1();

  const plan = await db.prepare(
    "SELECT p.id,p.current_revision AS currentRevision FROM action_plans p JOIN cases c ON c.id=p.case_id WHERE c.id=? AND c.workspace_id=? AND case_visible_to(c.id,?) AND c.archived_at IS NULL LIMIT 1",
  ).bind(caseId, workspace.id, user.id).first<{ id: string; currentRevision: number }>();
  if (!plan) {
    return Response.json({ error: "Дело или план недоступны.", code: "CASE_PLAN_UNAVAILABLE" }, {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  }

  const rows = await db.prepare(
    "SELECT id,version,reason,created_at AS createdAt,snapshot_json AS snapshotJson FROM action_plan_versions WHERE plan_id=? ORDER BY version DESC",
  ).bind(plan.id).all<{
    id: string;
    version: number;
    reason: string;
    createdAt: string;
    snapshotJson: string;
  }>();

  return Response.json({
    planId: plan.id,
    currentRevision: plan.currentRevision,
    versions: rows.results.map((row) => ({
      id: row.id,
      version: row.version,
      reason: row.reason,
      createdAt: row.createdAt,
      snapshot: parseJson(row.snapshotJson, null),
    })),
  }, { headers: { "cache-control": "private, no-store" } });
});