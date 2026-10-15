import { z } from "zod";
import { assertSafeWrite } from "../../../../../lib/auth/safe-write";
import { requirePlatformStaffRequest, withPlatformStaffErrors } from "../../../../../lib/auth/staff-http";
import { transaction } from "../../../../../lib/practice/access";
import { initializePractice } from "../../../../../lib/practice/crm";
import { sanitizeHtml } from "../../../../../lib/practice/content";
import { hash } from "../../../../../lib/practice/domain";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("access"), workspaceId: z.string().max(100), enabled: z.boolean(), pilotUntil: z.iso.datetime({ offset: true }).nullable(), features: z.object({ practice: z.boolean() }).strict(), seatLimit: z.number().int().positive().nullable(), reason: z.string().trim().min(10).max(500) }).strict(),
  z.object({ action: z.literal("commission"), source: z.string().min(1).max(100), planCode: z.enum(["free", "individual", "business", "legal_team"]), serviceType: z.string().min(1).max(100), rateBps: z.number().int().min(0).max(10000), active: z.boolean(), reason: z.string().trim().min(10).max(500) }).strict(),
  z.object({ action: z.literal("publish-template"), templateId: z.string().max(100), reason: z.string().trim().min(10).max(500) }).strict(),
]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
export const GET = withPlatformStaffErrors(async (request: Request) => {
  await requirePlatformStaffRequest(request, "staff.operations.manage", { freshMfaWithinMs: 900000 });
  return transaction(async client => json({
    access: (await client.query(`SELECT p.workspace_id,w.name,p.enabled,p.pilot_until,p.features,p.seat_limit FROM practice_workspaces p JOIN workspaces w ON w.id=p.workspace_id ORDER BY w.name`)).rows,
    commissionRules: (await client.query(`SELECT * FROM practice_commission_rules ORDER BY source,plan_code,service_type,version DESC LIMIT 500`)).rows,
  }));
});
export const POST = withPlatformStaffErrors(async (request: Request) => {
  assertSafeWrite(request);
  const staff = await requirePlatformStaffRequest(request, "staff.operations.manage", { freshMfaWithinMs: 900000 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ code: "INVALID_INPUT" }, 400);
  const input = parsed.data;
  return transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('practice-administration',0))`);
    const id = crypto.randomUUID();
    if (input.action === "access") {
      const workspace = (await client.query(`SELECT id,locale FROM workspaces WHERE id=$1`, [input.workspaceId])).rows[0];
      if (!workspace) return json({ code: "NOT_FOUND" }, 404);
      await client.query(`INSERT INTO practice_workspaces(workspace_id,enabled,pilot_until,features,seat_limit,granted_by) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled,pilot_until=excluded.pilot_until,features=excluded.features,seat_limit=excluded.seat_limit,granted_by=excluded.granted_by,updated_at=now()`, [workspace.id, input.enabled, input.pilotUntil, JSON.stringify(input.features), input.seatLimit, staff.userId]);
      await initializePractice(client, workspace.id, ["ru", "uz", "en"].includes(workspace.locale) ? workspace.locale : "ru");
      await client.query(`INSERT INTO workspace_audit_events(id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES($1,$2,$3,'practice_access',$2,'practice.access_changed',$4,$5)`, [id, workspace.id, staff.userId, JSON.stringify({ enabled: input.enabled, pilotUntil: input.pilotUntil, reason: input.reason }), new Date().toISOString()]);
    } else if (input.action === "commission") {
      const next = (await client.query(`SELECT coalesce(max(version),0)+1 AS version FROM practice_commission_rules WHERE source=$1 AND plan_code=$2 AND service_type=$3`, [input.source, input.planCode, input.serviceType])).rows[0].version;
      await client.query(`INSERT INTO practice_commission_rules(id,version,source,plan_code,service_type,rate_bps,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, next, input.source, input.planCode, input.serviceType, input.rateBps, input.active, staff.userId]);
    } else {
      // Publishing is an explicit staff action; private templates are copied only
      // when the operator has reviewed the selected template for public release.
      const source = (await client.query(`SELECT * FROM practice_document_templates WHERE id=$1`, [input.templateId])).rows[0];
      if (!source) return json({ code: "NOT_FOUND" }, 404);
      if (source.workspace_id) {
        const request = (await client.query(`SELECT metadata_json FROM workspace_audit_events WHERE workspace_id=$1 AND entity_type='template' AND entity_id=$2 AND action='template.publication_requested' ORDER BY created_at DESC,id DESC LIMIT 1`, [source.workspace_id, source.id])).rows[0];
        const evidence = request ? JSON.parse(request.metadata_json) : null;
        const contentHash = hash(JSON.stringify({ name: source.name, kind: source.kind, language: source.language, content: source.content, fields: source.fields }));
        if (!evidence?.requested || evidence.contentHash !== contentHash) return json({ code: "FIRM_PUBLICATION_PERMISSION_REQUIRED" }, 403);
      }
      await client.query(`INSERT INTO practice_document_templates(id,workspace_id,name,kind,language,content,fields,is_draft,created_by) VALUES($1,NULL,$2,$3,$4,$5,$6,true,$7)`, [id, source.name, source.kind, source.language, JSON.stringify({ html: sanitizeHtml(source.content.html) }), JSON.stringify(source.fields), staff.userId]);
    }
    return json({ ok: true, id }, 201);
  });
});
