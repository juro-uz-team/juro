import { z } from "zod";
import { assertSafeWrite } from "../../../../../lib/auth/safe-write";
import { requirePlatformStaffRequest, withPlatformStaffErrors } from "../../../../../lib/auth/staff-http";
import { transaction } from "../../../../../lib/practice/access";
import { initializePractice } from "../../../../../lib/practice/crm";
import { sanitizeHtml } from "../../../../../lib/practice/content";
import { hash } from "../../../../../lib/practice/domain";
import { subscriptionPlans } from "../../../../../config/pricing";
import { subscriptionPeriod } from "../../../../../lib/billing/entitlements";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("access"), workspaceId: z.string().max(100), enabled: z.boolean(), pilotUntil: z.iso.datetime({ offset: true }).nullable(), features: z.object({ practice: z.boolean() }).strict(), seatLimit: z.number().int().positive().nullable(), reason: z.string().trim().min(10).max(500) }).strict(),
  z.object({ action: z.literal("commission"), source: z.string().min(1).max(100), planCode: z.enum(["free", "individual", "business", "legal_team"]), serviceType: z.string().min(1).max(100), rateBps: z.number().int().min(0).max(10000), active: z.boolean(), reason: z.string().trim().min(10).max(500) }).strict(),
  z.object({ action: z.literal("publish-template"), templateId: z.string().max(100), reason: z.string().trim().min(10).max(500) }).strict(),
  z.object({ action: z.literal("grant-subscription"), requestId: z.uuid(), workspaceId: z.string().max(100),
    planCode: z.enum(["starter", "advanced", "company", "lawyer"]), reason: z.string().trim().min(10).max(500) }).strict(),
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
    if (input.action === "grant-subscription") {
      const signature = hash(JSON.stringify(input));
      const replay = (await client.query(`SELECT metadata_json FROM workspace_audit_events
        WHERE id=$1 AND action='subscription_granted' AND workspace_id=$2 AND actor_user_id=$3`,
        [input.requestId,input.workspaceId,staff.userId])).rows[0];
      if (replay) {
        const grant = JSON.parse(replay.metadata_json);
        return grant.signature === signature
          ? json({ ok: true, id: input.requestId, plan: grant.plan, periodEnd: grant.periodEnd })
          : json({ code: "IDEMPOTENCY_CONFLICT" }, 409);
      }
      const plan = subscriptionPlans.find(candidate => candidate.code === input.planCode)!;
      const workspace = (await client.query(`SELECT w.id,w.type,w.locale,
        (SELECT count(*) FROM workspace_members WHERE workspace_id=w.id AND status='active')::int AS members,
        EXISTS(SELECT 1 FROM workspace_members m JOIN user_profiles u ON u.id=m.user_id
          WHERE m.workspace_id=w.id AND m.status='active' AND m.role='owner' AND u.account_type='lawyer') AS lawyer
        FROM workspaces w WHERE w.id=$1 FOR UPDATE`, [input.workspaceId])).rows[0];
      if (!workspace) return json({ code: "NOT_FOUND" }, 404);
      if ((workspace.type === "business") !== (plan.code === "company") ||
        (plan.code === "lawyer" && (!workspace.lawyer || workspace.members !== 1))) {
        return json({ code: "PLAN_WORKSPACE_MISMATCH" }, 409);
      }
      const existing = (await client.query(`SELECT id,provider,plan_code,status,started_at,current_period_ends_at
        FROM subscriptions WHERE workspace_id=$1 FOR UPDATE`, [workspace.id])).rows[0];
      const now = new Date();
      const end = new Date(existing?.current_period_ends_at ?? "");
      const active = existing && ["active", "trialing"].includes(existing.status) &&
        (existing.current_period_ends_at === null || end > now);
      const renewal = active && existing.provider === "staff" && existing.plan_code === plan.code &&
        Number.isFinite(end.getTime()) && !!existing.started_at;
      if (active && !renewal) return json({ code: "ACTIVE_SUBSCRIPTION_EXISTS" }, 409);
      const start = renewal ? existing.started_at : now.toISOString();
      const { periodEnd } = subscriptionPeriod(renewal ? end : now, start);
      const at = now.toISOString();
      const planId = (await client.query(`INSERT INTO subscription_plans(id,code,status,created_at,updated_at)
        VALUES($1,$2,'active',$3,$3) ON CONFLICT(code) DO NOTHING RETURNING id`, [id,plan.code,at])).rows[0]?.id
        ?? (await client.query("SELECT id FROM subscription_plans WHERE code=$1", [plan.code])).rows[0].id;
      const versionId = (await client.query(`INSERT INTO subscription_plan_versions
        (id,plan_id,version,name_ru,name_uz,name_en,billing_period,price_minor,currency,entitlements_json,
         effective_from,approval_status,approved_by_user_id,approved_at,created_by_user_id,created_at)
        VALUES($1,$2,$3,$4,$5,$6,'monthly',$7,'UZS',$8,$9,'approved',$10,$9,$10,$9)
        ON CONFLICT(plan_id,version) DO NOTHING RETURNING id`, [crypto.randomUUID(), planId, plan.version,
        plan.name.ru, plan.name.uz, plan.name.en, plan.priceMinor, JSON.stringify({ limits: plan.limits, access: plan.code }), at, staff.userId])).rows[0]?.id
        ?? (await client.query("SELECT id FROM subscription_plan_versions WHERE plan_id=$1 AND version=$2", [planId,plan.version])).rows[0].id;
      await client.query(`INSERT INTO subscriptions
        (id,workspace_id,provider,plan_code,plan_version_id,status,billing_period,started_at,current_period_ends_at,created_at,updated_at)
        VALUES($1,$2,'staff',$3,$4,'active','monthly',$5,$6,$7,$7)
        ON CONFLICT(workspace_id) DO UPDATE SET provider='staff',plan_code=excluded.plan_code,
        plan_version_id=excluded.plan_version_id,status='active',billing_period='monthly',started_at=excluded.started_at,
        current_period_ends_at=excluded.current_period_ends_at,updated_at=excluded.updated_at,version=subscriptions.version+1,
        provider_customer_id=NULL,provider_subscription_id=NULL,order_id=NULL,auto_renew_consent_at=NULL,
        grace_period_ends_at=NULL,cancel_at_period_end=0`, [crypto.randomUUID(),workspace.id,plan.code,versionId,start,periodEnd,at]);
      if (plan.code === "lawyer") {
        await client.query(`INSERT INTO practice_workspaces(workspace_id,enabled,features,seat_limit,granted_by)
          VALUES($1,true,'{"practice":true,"subscriptionWorkspace":true}',1,$2) ON CONFLICT(workspace_id) DO UPDATE SET
          enabled=true,features=practice_workspaces.features || '{"practice":true,"subscriptionWorkspace":true}'::jsonb,seat_limit=1,updated_at=now()`,
          [workspace.id,staff.userId]);
        await initializePractice(client, workspace.id, workspace.locale === "uz" || workspace.locale === "en" ? workspace.locale : "ru");
      }
      await client.query(`INSERT INTO workspace_audit_events
        (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
        VALUES($1,$2,$3,'subscription',$2,'subscription_granted',$4,$5)`, [
        input.requestId,workspace.id,staff.userId,JSON.stringify({ signature, plan: plan.code, versionId, start, periodEnd, reason: input.reason, renewed: !!renewal }),at,
      ]);
      return json({ ok: true, id: input.requestId, plan: plan.code, periodEnd }, 201);
    } else if (input.action === "access") {
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
