import { publishedSiteContent } from "../control-center/site-content";
import { collectProductEvent } from "../control-center/events";
import { queueDecisionEmail } from "../control-center/delivery";
import { controlPrincipal, controlAudit, requestAdminCode, verifyAdminCode, revokeControlSession } from "./control-admin-auth";
import { handleControlCenter } from "../control-center/api";
import { z } from "zod";

import {
  adminRoleAllows,
  appendAdminDomainAudit,
  consumeAdminDomainHandoff,
  revokeAdminDomainSession,
  requireAdminDomainSession,
  type AdminDomainEnvironment,
} from "./admin-domain-session";
import { moderateLawyerProfile } from "../platform/lawyer-profile-moderation-service";
import { LawyerProfileLifecycleError, transitionLawyerProfileLifecycle } from "../platform/lawyer-profile-lifecycle-service";
import { lawyerReviewModerationInputSchema, lawyerReviewModerationListSchema } from "../platform/lawyer-review-moderation";
import { LawyerReviewModerationServiceError, listLawyerReviews, moderateLawyerReview } from "../platform/lawyer-review-moderation-service";

const SESSION_HEADER = "x-juro-admin-session";
const INTERNAL_TOKEN_HEADER = "x-juro-admin-internal-token";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const profileIdSchema = z.string().uuid();
const reviewIdSchema = z.string().uuid();
const consumeSchema = z.object({ ticket: z.string().regex(TOKEN_PATTERN) }).strict();
const moderationSchema = z.object({
  decision: z.enum(["approved", "changes_requested", "rejected"]),
  reason: z.string().trim().min(1).max(2_000),
}).strict();
const lifecycleSchema = z.object({
  action: z.enum(["suspend", "block", "archive", "restore"]),
  reason: z.string().trim().min(1).max(2_000),
}).strict();

type AdminInternalEnv = {
  DB?: D1Database;
  APP_ENV?: string;
  ADMIN_INTERNAL_TOKEN?: string;
  // Production's isolated admin Worker uses a separately provisioned token.
  // Keep the existing token accepted during the rollout so the pre-isolation
  // admin path remains a valid rollback target.
  ADMIN_CONSOLE_TOKEN?: string;
  WORKER_VERSION?: WorkerVersionMetadata;
};

function environment(value: unknown): AdminDomainEnvironment | null {
  return value === "development" || value === "staging" || value === "production"
    ? value
    : null;
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

async function fixedTimeTokenMatch(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

async function parseJson(request: Request, maxBytes = 4_096): Promise<unknown | null> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function requireInternal(env: AdminInternalEnv): Promise<{ db: D1Database; environment: AdminDomainEnvironment }> {
  const appEnvironment = environment(env.APP_ENV);
  if (!env.DB || !appEnvironment || (!env.ADMIN_INTERNAL_TOKEN && !env.ADMIN_CONSOLE_TOKEN)) {
    throw new Error("ADMIN_INTERNAL_UNAVAILABLE");
  }
  return { db: env.DB, environment: appEnvironment };
}

async function hasInternalToken(request: Request, env: AdminInternalEnv): Promise<boolean> {
  const provided = request.headers.get(INTERNAL_TOKEN_HEADER);
  const [legacy, console] = await Promise.all([
    fixedTimeTokenMatch(provided, env.ADMIN_INTERNAL_TOKEN),
    fixedTimeTokenMatch(provided, env.ADMIN_CONSOLE_TOKEN),
  ]);
  return legacy || console;
}

async function requirePrincipal(request: Request, env: AdminInternalEnv) {
  const internal = await hasInternalToken(request, env);
  if (!internal) return null;
  try {
    const runtime = await requireInternal(env);
    const control = await controlPrincipal(request.headers.get(SESSION_HEADER));
    if (!control) return null;
    const principal = {sessionId:control.sessionId, userId:control.userId ?? "", sourceSessionId:"", sourceMfaVerifiedAt:"", roles:["super_admin"] as ("super_admin")[], expiresAt:control.expiresAt};
    return { ...runtime, principal };
  } catch {
    return null;
  }
}

async function dashboard(request: Request, env: AdminInternalEnv): Promise<Response> {
  const authenticated = await requirePrincipal(request, env);
  if (!authenticated || !adminRoleAllows(authenticated.principal.roles, "dashboard.view")) return noStore({ code: "ACCESS_DENIED" }, 403);
  const [pending, approved, requests, audit] = await Promise.all([
    authenticated.db.prepare("SELECT count(*) AS total FROM lawyer_profiles WHERE marketplace_status='pending_review'").first<{ total: number }>(),
    authenticated.db.prepare("SELECT count(*) AS total FROM lawyer_profiles WHERE marketplace_status='public_approved'").first<{ total: number }>(),
    authenticated.db.prepare("SELECT count(*) AS total FROM lawyer_requests WHERE status NOT IN ('completed','cancelled','rejected')").first<{ total: number }>(),
    authenticated.db.prepare("SELECT count(*) AS total FROM admin_domain_audit_events WHERE environment=?").bind(authenticated.environment).first<{ total: number }>(),
  ]);
  await controlAuditEvent(authenticated.db, {
    environment: authenticated.environment,
    principal: authenticated.principal,
    action: "dashboard_viewed",
    metadata: {},
  });
  return noStore({
    roles: authenticated.principal.roles,
    counts: {
      pendingLawyerProfiles: pending?.total ?? 0,
      approvedLawyerProfiles: approved?.total ?? 0,
      activeLawyerRequests: requests?.total ?? 0,
      adminAuditEvents: audit?.total ?? 0,
    },
    expiresAt: authenticated.principal.expiresAt,
  });
}

async function lawyerProfiles(request: Request, env: AdminInternalEnv): Promise<Response> {
  const authenticated = await requirePrincipal(request, env);
  if (!authenticated || !adminRoleAllows(authenticated.principal.roles, "lawyer.profiles.moderate")) return noStore({ code: "ACCESS_DENIED" }, 403);
  const url=new URL(request.url);const page=Math.max(1,Math.floor(Number(url.searchParams.get("page"))||1));
  const status = url.searchParams.get("status") ?? "pending_review";
  if (!["profile_incomplete", "pending_review", "changes_requested", "public_approved", "rejected", "suspended", "blocked", "archived"].includes(status)) return noStore({ code: "INVALID_INPUT" }, 400);
  const rows = await authenticated.db.prepare(
    `SELECT p.id,p.display_name AS displayName,p.status,p.marketplace_status AS marketplaceStatus,
       p.profile_revision AS profileRevision,p.city,p.region,p.experience_years AS experienceYears,
       p.price_description AS priceDescription,p.availability_status AS availabilityStatus,
       p.updated_at AS updatedAt,coalesce(d.professional_type,CASE WHEN p.advocate_status='declared' THEN 'advocate' ELSE 'lawyer' END) AS professionalType,
       (SELECT count(*) FROM control_professional_documents f WHERE f.profile_id=p.id) AS documentCount,
       EXISTS(SELECT 1 FROM lawyer_profile_moderation m WHERE m.lawyer_profile_id=p.id) AS resubmitted
     FROM lawyer_profiles p LEFT JOIN control_professional_details d ON d.profile_id=p.id
     WHERE p.marketplace_status=? ORDER BY p.updated_at ASC,p.id ASC LIMIT 25 OFFSET ?`,
  ).bind(status,(page-1)*25).all();
  await controlAuditEvent(authenticated.db, {
    environment: authenticated.environment,
    principal: authenticated.principal,
    action: "lawyer_profiles_viewed",
    entityType: "lawyer_profile_list",
    metadata: { status, count: rows.results.length },
  });
  return noStore({ profiles: rows.results,page });
}

async function moderateProfile(request: Request, env: AdminInternalEnv, profileId: string): Promise<Response> {
  const authenticated = await requirePrincipal(request, env);
  if (!authenticated || !adminRoleAllows(authenticated.principal.roles, "lawyer.profiles.moderate")) return noStore({ code: "ACCESS_DENIED" }, 403);
  const payload = moderationSchema.safeParse(await parseJson(request));
  if (!payload.success) return noStore({ code: "INVALID_INPUT" }, 400);
  try {
    await authenticated.db.prepare("INSERT INTO control_professional_flow_events(id,profile_id,revision,event) SELECT ?,id,profile_revision,'reviewed' FROM lawyer_profiles WHERE id=? ON CONFLICT DO NOTHING").bind(crypto.randomUUID(),profileId).run();
    const result = await moderateLawyerProfile(authenticated.db, {
      profileId,
      moderatorUserId: authenticated.principal.userId || null,
      adminSessionId:authenticated.principal.sessionId,
      decision: payload.data.decision,
      reason: payload.data.reason,
    });
    await controlAuditEvent(authenticated.db, {
      environment: authenticated.environment,
      principal: authenticated.principal,
      action: "lawyer_profile_moderated",
      entityType: "lawyer_profile",
      entityId: profileId,
      metadata: { decision: payload.data.decision },
    });
    const owner = await authenticated.db.prepare("SELECT user_id AS userId FROM lawyer_profiles WHERE id=?").bind(profileId).first<{userId:string}>();
    if(owner) await queueDecisionEmail(owner.userId,{approved:"Профиль подтверждён JURO",rejected:"Заявка отклонена",changes_requested:"Требуется дополнительная информация"}[payload.data.decision],payload.data.reason+" Откройте профессиональный профиль в JURO для следующего действия.").catch(()=>console.error("control.delivery_queue_failed"));
    return noStore({ ok: true, status: result.status });
  } catch {
    return noStore({ code: "PROFILE_UNAVAILABLE" }, 409);
  }
}

async function transitionProfileLifecycle(request: Request, env: AdminInternalEnv, profileId: string): Promise<Response> {
  const authenticated = await requirePrincipal(request, env);
  if (!authenticated) return noStore({ code: "ACCESS_DENIED" }, 403);
  const payload = lifecycleSchema.safeParse(await parseJson(request));
  if (!payload.success) return noStore({ code: "INVALID_INPUT" }, 400);
  const capability = payload.data.action === "block" ? "lawyer.profiles.block" : "lawyer.profiles.moderate";
  if (!adminRoleAllows(authenticated.principal.roles, capability)) return noStore({ code: "ACCESS_DENIED" }, 403);
  const auditAction = {
    suspend: "lawyer_profile_suspended",
    block: "lawyer_profile_blocked",
    archive: "lawyer_profile_archived",
    restore: "lawyer_profile_restored",
  } as const;
  try {
    const result = await transitionLawyerProfileLifecycle(authenticated.db, {
      profileId,
      actorUserId: authenticated.principal.userId || null,
      adminSessionId:authenticated.principal.sessionId,
      action: payload.data.action,
      reason: payload.data.reason,
    });
    await controlAuditEvent(authenticated.db, {
      environment: authenticated.environment,
      principal: authenticated.principal,
      action: auditAction[payload.data.action],
      entityType: "lawyer_profile",
      entityId: profileId,
      metadata: { status: result.status, profileRevision: result.profileRevision },
    });
    return noStore({ ok: true, status: result.status, profileRevision: result.profileRevision });
  } catch (error) {
    if (error instanceof LawyerProfileLifecycleError) return noStore({ code: error.code }, 409);
    return noStore({ code: "PROFILE_UNAVAILABLE" }, 409);
  }
}

async function reviews(request: Request, env: AdminInternalEnv): Promise<Response> {
  const authenticated = await requirePrincipal(request, env);
  if (!authenticated || !adminRoleAllows(authenticated.principal.roles, "lawyer.reviews.moderate")) return noStore({ code: "ACCESS_DENIED" }, 403);
  const url = new URL(request.url);
  const parsed = lawyerReviewModerationListSchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return noStore({ code: "INVALID_INPUT" }, 400);
  const reviews = await listLawyerReviews(authenticated.db, parsed.data);
  await controlAuditEvent(authenticated.db, {
    environment: authenticated.environment,
    principal: authenticated.principal,
    action: "lawyer_reviews_viewed",
    entityType: "lawyer_review_list",
    metadata: { status: parsed.data.status, count: reviews.results.length },
  });
  return noStore({ reviews: reviews.results });
}

async function moderateReview(request: Request, env: AdminInternalEnv, reviewId: string): Promise<Response> {
  const authenticated = await requirePrincipal(request, env);
  if (!authenticated || !adminRoleAllows(authenticated.principal.roles, "lawyer.reviews.moderate")) return noStore({ code: "ACCESS_DENIED" }, 403);
  const payload = lawyerReviewModerationInputSchema.safeParse(await parseJson(request, 8_192));
  if (!payload.success) return noStore({ code: "INVALID_INPUT" }, 400);
  try {
    const result = await moderateLawyerReview(authenticated.db, {
      reviewId,
      moderatorUserId: authenticated.principal.userId,
      decision: payload.data.decision,
      moderatedBody: payload.data.moderatedBody,
      reason: payload.data.reason,
    });
    await controlAuditEvent(authenticated.db, {
      environment: authenticated.environment,
      principal: authenticated.principal,
      action: "lawyer_review_moderated",
      entityType: "lawyer_review",
      entityId: reviewId,
      metadata: { decision: payload.data.decision },
    });
    return noStore({ ok: true, status: result.status });
  } catch (error) {
    if (error instanceof LawyerReviewModerationServiceError && error.code === "LIKELY_PERSONAL_DATA") {
      return noStore({ code: error.code }, 400);
    }
    return noStore({ code: "REVIEW_UNAVAILABLE" }, 409);
  }
}

async function consume(request: Request, env: AdminInternalEnv): Promise<Response> {
  const internal = await hasInternalToken(request, env);
  if (!internal) return noStore({ code: "ACCESS_DENIED" }, 403);
  const runtime = await requireInternal(env);
  const payload = consumeSchema.safeParse(await parseJson(request, 1_024));
  if (!payload.success) return noStore({ code: "INVALID_INPUT" }, 400);
  const origin = request.headers.get("x-juro-admin-origin");
  if (!origin) return noStore({ code: "INVALID_INPUT" }, 400);
  try {
    const session = await consumeAdminDomainHandoff(runtime.db, {
      ticket: payload.data.ticket,
      environment: runtime.environment,
      destinationOrigin: origin,
    });
    return noStore(session);
  } catch {
    return noStore({ code: "TICKET_DENIED" }, 401);
  }
}

async function logout(request: Request, env: AdminInternalEnv): Promise<Response> {
  const internal = await hasInternalToken(request, env);
  if (!internal) return noStore({ code: "ACCESS_DENIED" }, 403);
  try {
    const runtime = await requireInternal(env);
    await revokeControlSession(request.headers.get(SESSION_HEADER) ?? "");
    return noStore({ ok: true });
  } catch {
    return noStore({ code: "ACCESS_DENIED" }, 403);
  }
}

export async function handleInternalAdminRequest(request: Request, env: AdminInternalEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/internal/admin/")) return null;
  if (!await hasInternalToken(request, env)) return noStore({code:"ACCESS_DENIED"},403);
  if (url.pathname === "/api/internal/admin/auth/request" && request.method === "POST") {
    const input = z.object({email:z.string().email().max(254),ip:z.string().max(200)}).strict().safeParse(await parseJson(request));
    if (!input.success) return noStore({code:"INVALID_INPUT"},400);
    return noStore(await requestAdminCode(input.data.email,input.data.ip,{apiKey:process.env.RESEND_API_KEY ?? "",from:process.env.EMAIL_FROM ?? ""}));
  }
  if (url.pathname === "/api/internal/admin/auth/verify" && request.method === "POST") {
    const input = z.object({challengeId:z.string().uuid(),code:z.string().max(20),ip:z.string().max(200)}).strict().safeParse(await parseJson(request));
    if (!input.success) return noStore({code:"INVALID_INPUT"},400);
    const session = await verifyAdminCode(input.data.challengeId,input.data.code,input.data.ip);
    return session ? noStore(session) : noStore({code:"CODE_DENIED"},401);
  }
  if(url.pathname==="/api/internal/admin/analytics/collect"&&request.method==="POST") {
   try {await collectProductEvent(await parseJson(request),request.headers.get("x-juro-client-ip")??"unknown");return noStore({ok:true});}catch(error){return noStore({code:error instanceof Error&&error.message==="RATE_LIMITED"?"RATE_LIMITED":"INVALID_INPUT"},error instanceof Error&&error.message==="RATE_LIMITED"?429:400);}
  }
  if(url.pathname==="/api/internal/admin/site-content/published"&&request.method==="GET"){
    try{return noStore(await publishedSiteContent(url.searchParams.get("locale")??"ru",url.searchParams.get("kind")??"faq"));}catch{return noStore({code:"CONTENT_UNAVAILABLE"},503);}
  }
  const control = await handleControlCenter(request);
  if (control) return control;
  if (url.pathname === "/api/internal/admin/session/logout" && request.method === "POST") return logout(request, env);
  if (url.pathname === "/api/internal/admin/dashboard" && request.method === "GET") return dashboard(request, env);
  if (url.pathname === "/api/internal/admin/lawyers" && request.method === "GET") return lawyerProfiles(request, env);
  if (url.pathname === "/api/internal/admin/reviews" && request.method === "GET") return reviews(request, env);
  const moderation = /^\/api\/internal\/admin\/lawyers\/([0-9a-f-]{36})\/moderate$/.exec(url.pathname);
  if (moderation && request.method === "POST") {
    const profileId = profileIdSchema.safeParse(moderation[1]);
    if (!profileId.success) return noStore({ code: "NOT_FOUND" }, 404);
    return moderateProfile(request, env, profileId.data);
  }
  const lifecycle = /^\/api\/internal\/admin\/lawyers\/([0-9a-f-]{36})\/lifecycle$/.exec(url.pathname);
  if (lifecycle && request.method === "POST") {
    const profileId = profileIdSchema.safeParse(lifecycle[1]);
    if (!profileId.success) return noStore({ code: "NOT_FOUND" }, 404);
    return transitionProfileLifecycle(request, env, profileId.data);
  }
  const reviewModeration = /^\/api\/internal\/admin\/reviews\/([0-9a-f-]{36})\/moderate$/.exec(url.pathname);
  if (reviewModeration && request.method === "POST") {
    const reviewId = reviewIdSchema.safeParse(reviewModeration[1]);
    if (!reviewId.success) return noStore({ code: "NOT_FOUND" }, 404);
    return moderateReview(request, env, reviewId.data);
  }
  return noStore({ code: "NOT_FOUND" }, 404);
}

async function controlAuditEvent(_db: D1Database, input: {principal:{userId:string};action:string;entityType?:string;entityId?:string;metadata?:object;environment:string}) {
 await controlAudit(process.env.ADMIN_ALLOWED_EMAIL ?? "muzaffarbekmurodov@gmail.com",input.action,input.entityType,input.entityId,input.metadata);
}
