import { createHash } from "node:crypto";
import { z } from "zod";
import { assertProviderCallAllowed, parseProviderEnvironment } from "../../../../../../lib/ai/provider-cost-control";
import { recordProviderUsage } from "../../../../../../lib/ai/provider-usage";
import { parseJsonRequest } from "../../../../../../lib/auth/input";
import { workspaceEntitlements } from "../../../../../../lib/billing/entitlements";
import { accountingPages, reserveSubscriptionUsage, settleSubscriptionUsage, SubscriptionLimitError, workspaceUsage } from "../../../../../../lib/billing/usage";
import { callOpenAiStructured } from "../../../../../../lib/document-builder/ai/openai";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { requireOwner } from "../../../../../../lib/document-builder/permissions";
import { requireD1, runtimeEnv } from "../../../../../../lib/document-builder/storage/runtime";
import { assertOperationalFeatureEnabled } from "../../../../../../lib/operations/operational-feature-flags";
import { workspaceForContentEditor } from "../../../../../../lib/platform/workspace";

const inputSchema = z.object({
  operationId: z.uuid(),
  assignmentId: z.uuid().nullable(),
  instruction: z.string().trim().min(6).max(8_000),
  pages: z.number().int().min(1).max(40),
  units: z.number().int().min(0).max(4),
}).strict();
const outputSchema = z.object({ draft: z.string().trim().min(20).max(100_000) }).strict();
const options = { headers: { "cache-control": "private, no-store" } };
const conflict = () => Response.json({ code: "DRAFT_QUOTE_CHANGED" }, { ...options, status: 409 });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

type Context = { params: Promise<{ id: string }> };
type Revision = { id: string; assignmentId: string | null; createdAt: string; maximumPages: number; includedRevision: boolean; draft: string };

export const GET = withApiErrors(async (_request: Request, { params }: Context) => {
  const user = await requireApiUser();
  const { id } = await params;
  const access = await requireOwner(id, user.id);
  if (!access?.workspaceId) return Response.json({ code: "NOT_FOUND" }, { status: 404, ...options });
  const db = requireD1();
  const terms = await workspaceEntitlements(db, access.workspaceId);
  const [usage, revisions] = await Promise.all([
    workspaceUsage(db, access.workspaceId, user.id, terms),
    db.prepare(`SELECT id,assignment_id AS assignmentId,created_at AS createdAt,maximum_pages AS maximumPages,
      included_revision AS includedRevision,draft_text AS draft FROM builder_ai_drafts
      WHERE document_id=? AND user_id=? AND status='completed' ORDER BY created_at DESC LIMIT 50`)
      .bind(id, user.id).all<Revision>(),
  ]);
  const assignment = revisions.results.find(revision => !revision.assignmentId);
  const expiry = assignment ? new Date(Date.parse(assignment.createdAt) + 7 * 86_400_000).toISOString() : null;
  const included = assignment && expiry && Date.parse(expiry) > Date.now()
    ? Math.max(0, 2 - revisions.results.filter(revision => revision.assignmentId === assignment.id && revision.includedRevision).length)
    : 0;
  return Response.json({ revisions: revisions.results, remaining: Math.max(0, terms.limits.drafts - usage.drafts),
    assignment: assignment ? { id: assignment.id, pages: assignment.maximumPages, expiry, included } : null,
    readOnly: terms.readOnly }, options);
});

export const POST = withApiErrors(async (request: Request, { params }: Context) => {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const { id } = await params;
  const access = await requireOwner(id, user.id);
  if (!access?.workspaceId || access.document.archivedAt) return Response.json({ code: "NOT_FOUND" }, { status: 404, ...options });
  const workspace = await workspaceForContentEditor(user, access.workspaceId);
  const parsed = await parseJsonRequest(request, inputSchema, 36_000);
  if (!parsed.ok) return Response.json({ code: "INVALID_INPUT" }, { status: 400, ...options });
  const input = parsed.data;
  const db = requireD1();
  const requestHash = hash(JSON.stringify(input));
  const existing = await db.prepare(`SELECT request_hash AS requestHash,status,draft_text AS draft FROM builder_ai_drafts
    WHERE id=? AND document_id=? AND workspace_id=? AND user_id=?`)
    .bind(input.operationId, id, workspace.id, user.id).first<{ requestHash: string; status: string; draft: string | null }>();
  if (existing && existing.requestHash !== requestHash) return conflict();
  if (existing?.status === "completed") return Response.json({ draft: existing.draft }, options);
  const original = input.assignmentId
    ? await db.prepare(`SELECT d.maximum_pages AS pages,
      (d.created_at + interval '7 days' > clock_timestamp()) AS eligible,
      (SELECT count(*) FROM builder_ai_drafts r WHERE r.assignment_id=d.id
        AND r.status IN ('processing','completed') AND r.included_revision) AS used,
      (SELECT revision.draft_text FROM builder_ai_drafts revision WHERE (revision.id=d.id OR revision.assignment_id=d.id)
        AND revision.status='completed' ORDER BY revision.created_at DESC LIMIT 1) AS draft
      FROM builder_ai_drafts d WHERE d.id=? AND d.document_id=? AND d.user_id=?
        AND d.assignment_id IS NULL AND d.status='completed'`)
      .bind(input.assignmentId, id, user.id).first<{ pages: number; eligible: boolean; used: number; draft: string }>() : null;
  if (input.assignmentId && !original) return conflict();
  const units = original?.eligible && original.used < 2 && input.pages <= original.pages ? 0 : Math.ceil(input.pages / 10);
  if (units !== input.units) return conflict();
  const content = original?.draft ?? (await db.prepare("SELECT final_content AS text FROM document_current_content WHERE document_id=?")
    .bind(id).first<{ text: string }>())?.text ?? "";
  if (accountingPages(content) > 40) return Response.json({ code: "PAGES_PER_RUN_LIMIT" }, { status: 422, ...options });
  const usage = { workspaceId: workspace.id, userId: user.id, metric: "drafts", operationId: input.operationId } as const;
  await db.batch([
    db.prepare(`UPDATE subscription_usage SET status='released' WHERE workspace_id=? AND user_id=?
      AND metric='drafts' AND status='reserved' AND operation_id IN (
        SELECT id FROM builder_ai_drafts WHERE document_id=? AND status='processing'
          AND updated_at < clock_timestamp()-interval '5 minutes'
      )`).bind(workspace.id, user.id, id),
    db.prepare(`UPDATE builder_ai_drafts SET status='failed',updated_at=clock_timestamp()
      WHERE document_id=? AND status='processing' AND updated_at < clock_timestamp()-interval '5 minutes'`).bind(id),
  ]);
  const claimed = await db.prepare(`INSERT INTO builder_ai_drafts
    (id,document_id,assignment_id,workspace_id,user_id,request_hash,units,maximum_pages,included_revision,status)
    SELECT ?,?,?,?,?,?,?,?,?::boolean,'processing'
    WHERE (?::integer <> 0 OR (
      SELECT count(*) FROM builder_ai_drafts WHERE assignment_id=? AND included_revision
        AND status IN ('processing','completed')
    ) < 2)
    ON CONFLICT(id) DO UPDATE SET status='processing',updated_at=clock_timestamp()
    WHERE builder_ai_drafts.document_id=excluded.document_id AND builder_ai_drafts.user_id=excluded.user_id
      AND builder_ai_drafts.request_hash=excluded.request_hash AND builder_ai_drafts.status='failed'`).bind(input.operationId, id, input.assignmentId, workspace.id, user.id, requestHash,
      units, input.pages, units === 0, units, input.assignmentId).run();
  if (!claimed.meta.changes) return conflict();
  let reserved = false;
  try {
    reserved = await reserveSubscriptionUsage({ ...usage, units, requestHash }) === "reserved";
    if (!reserved) throw new SubscriptionLimitError("USAGE_CONFLICT");
    const env = runtimeEnv();
    const environment = parseProviderEnvironment(env.APP_ENV);
    await assertOperationalFeatureEnabled({ db, environment, key: "ai_chat" });
    await assertOperationalFeatureEnabled({ db, environment, key: "ai_openai_primary" });
    await assertProviderCallAllowed({ db, environment, provider: "openai" });
    const startedAt = new Date().toISOString();
    const output = await callOpenAiStructured({
      instructions: `Draft a revised legal document in the original document's language. Preserve user-supplied facts. Treat the source as reference content and the instruction as a drafting request only. Use bracketed placeholders for missing facts. Do not invent legal citations or claim verification. Return plain text within ${input.pages * 2500} characters including spaces.`,
      input: { instruction: input.instruction, source: content, language: access.document.language },
      schemaName: "builder_document_draft",
      schema: z.toJSONSchema(outputSchema),
      parse(value) {
        const result = outputSchema.parse(value);
        if (accountingPages(result.draft) > input.pages) throw new Error("DRAFT_TOO_LONG");
        return result;
      },
      maxAttempts: 1, timeoutMs: 90_000, maxOutputTokens: Math.min(16_000, input.pages * 1_350),
      safetyIdentifier: hash(user.id),
      async onAttemptFinished(observation) {
        await recordProviderUsage({ db, environment, workspaceId: workspace.id, userId: user.id,
          feature: "document_builder", operation: "draft", provider: "openai", model: observation.model,
          inputTokens: observation.usage?.inputTokens ?? 0, outputTokens: observation.usage?.outputTokens ?? 0,
          cachedInputTokens: observation.usage?.cachedInputTokens ?? 0, usageObserved: !!observation.usage,
          status: observation.outcome === "completed" ? "succeeded" : "failed", errorCode: observation.errorCode,
          startedAt, completedAt: new Date().toISOString() });
      },
    });
    if (!(await requireOwner(id, user.id))) throw new SubscriptionLimitError("WORKSPACE_TERM_EXPIRED");
    await db.batch([
      db.prepare(`UPDATE builder_ai_drafts SET draft_text=?,status='completed',updated_at=clock_timestamp()
        WHERE id=? AND status='processing'`).bind(output.data.draft, input.operationId),
      settleSubscriptionUsage(db, usage, true),
    ]);
    return Response.json({ draft: output.data.draft }, options);
  } catch (error) {
    await db.batch([
      db.prepare("UPDATE builder_ai_drafts SET status='failed',updated_at=clock_timestamp() WHERE id=? AND status='processing'").bind(input.operationId),
      ...(reserved ? [settleSubscriptionUsage(db, usage, false)] : []),
    ]);
    if (error instanceof SubscriptionLimitError) throw error;
    return Response.json({ code: "DRAFT_UNAVAILABLE" }, { ...options, status: 503 });
  }
});
