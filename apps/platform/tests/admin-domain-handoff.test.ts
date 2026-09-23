import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { issueAdminDomainHandoff } from "../lib/auth/admin-domain-handoff";
import {
  adminRoleAllows,
  consumeAdminDomainHandoff,
  revokeAdminDomainSession,
  requireAdminDomainSession,
} from "../lib/auth/admin-domain-session";
import { sha256 } from "../lib/auth/crypto";
import { LawyerReviewModerationServiceError, moderateLawyerReview } from "../lib/platform/lawyer-review-moderation-service";
import { moderateLawyerProfile } from "../lib/platform/lawyer-profile-moderation-service";
import { designateLawyerProfile, LawyerProfileDesignationError } from "../lib/platform/lawyer-profile-designation-service";
import { transitionLawyerProfileLifecycle } from "../lib/platform/lawyer-profile-lifecycle-service";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const NOW = new Date("2026-08-07T08:00:00.000Z");
const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "50000000-0000-4000-8000-000000000001";
const LAWYER_ID = "60000000-0000-4000-8000-000000000001";

function seed() {
  const value = sqliteD1Fixture();
  const now = NOW.toISOString();
  value.sqlite.prepare(
    `INSERT INTO user_profiles (id,email,locale,account_type,timezone,created_at,updated_at)
     VALUES (?,'admin-fixture@example.test','ru','individual','Asia/Tashkent',?,?)`,
  ).run(USER_ID, now, now);
  value.sqlite.prepare(
    `INSERT INTO auth_sessions (
       id,user_id,token_hash,auth_method,assurance_level,authenticated_at,
       mfa_verified_at,expires_at,idle_expires_at,created_at,last_seen_at
     ) VALUES (?,?,?,'email_otp+totp','mfa',?,?,?,?,?,?)`,
  ).run(
    SESSION_ID,
    USER_ID,
    "a".repeat(64),
    now,
    now,
    "2026-08-08T08:00:00.000Z",
    "2026-08-08T08:00:00.000Z",
    now,
    now,
  );
  value.sqlite.prepare(
    `INSERT INTO auth_totp_credentials (
       id,user_id,status,secret_ciphertext,secret_iv,key_version,
       enrollment_expires_at,created_at,updated_at,verified_at
     ) VALUES ('30000000-0000-4000-8000-000000000001',?,'active','fixture','abcdefghijklmnop','v1',?,?,?,?)`,
  ).run(USER_ID, "2026-08-08T08:00:00.000Z", now, now, now);
  value.sqlite.prepare(
    `INSERT INTO platform_staff_assignments (
       id,user_id,role,grant_source,grant_reason,granted_at,expires_at,created_at,updated_at
     ) VALUES ('40000000-0000-4000-8000-000000000001',?,'administrator','operator_bootstrap','Synthetic admin handoff test',?,?,?,?)`,
  ).run(USER_ID, "2026-08-07T07:00:00.000Z", "2026-08-08T08:00:00.000Z", now, now);
  return value;
}

function staff() {
  return {
    userId: USER_ID,
    sessionId: SESSION_ID,
    capability: "staff.console.view" as const,
    roles: ["administrator" as const],
    assignmentIds: ["assignment"],
    mfaVerifiedAt: NOW.toISOString(),
  };
}

function seedPendingReview(sqlite: ReturnType<typeof seed>["sqlite"], input: { requestId: string; reviewId: string; body: string }) {
  const now = NOW.toISOString();
  sqlite.prepare(
    "INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual','Admin review','ru',?,?)",
  ).run(WORKSPACE_ID, now, now);
  sqlite.prepare(
    "INSERT INTO user_profiles(id,email,locale,account_type,created_at,updated_at) VALUES (?,'lawyer-review-fixture@example.test','ru','lawyer',?,?)",
  ).run(LAWYER_ID, now, now);
  sqlite.prepare(
    "INSERT INTO lawyer_profiles(id,user_id,display_name,status,public_approved_at,created_at,updated_at) VALUES ('lawyer-profile',?,'JURO test lawyer','public_approved',?,?,?)",
  ).run(LAWYER_ID, now, now, now);
  sqlite.prepare(
    "INSERT INTO cases(id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,created_at,updated_at) VALUES ('review-case',?,?,'individual','ru','Synthetic review case','contracts','completed',?,?)",
  ).run(WORKSPACE_ID, USER_ID, now, now);
  sqlite.prepare(
    "INSERT INTO lawyer_requests(id,workspace_id,case_id,requester_user_id,lawyer_profile_id,status,anonymized_summary,requested_scope_json,created_at,updated_at) VALUES (?,?,'review-case',?,'lawyer-profile','completed','Synthetic review flow','{}',?,?)",
  ).run(input.requestId, WORKSPACE_ID, USER_ID, now, now);
  sqlite.prepare(
    "INSERT INTO lawyer_reviews(id,lawyer_request_id,workspace_id,lawyer_profile_id,requester_user_id,overall_rating,speed_rating,quality_rating,communication_rating,body,status,created_at,updated_at) VALUES (?,?,?,'lawyer-profile',?,5,5,5,5,?,'pending',?,?)",
  ).run(input.reviewId, input.requestId, WORKSPACE_ID, USER_ID, input.body, now, now);
}

function seedPendingLawyerProfile(sqlite: ReturnType<typeof seed>["sqlite"]) {
  const now = NOW.toISOString();
  sqlite.prepare(
    "INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual','Admin profile','ru',?,?)",
  ).run("profile-workspace", now, now);
  sqlite.prepare("UPDATE user_profiles SET default_workspace_id=?,phone=? WHERE id=?")
    .run("profile-workspace", "+998901234567", USER_ID);
  sqlite.prepare(
    `INSERT INTO lawyer_profiles (
      id,user_id,display_name,specialties_json,languages_json,status,marketplace_status,
      experience_years,price_description,availability_status,advocate_status,firm_name,
      city,region,education,consultation_formats_json,profile_photo_key,created_at,updated_at
    ) VALUES ('pending-lawyer-profile',?,'JURO test lawyer','[\"contracts\"]','[\"ru\"]',
      'pending','pending_review',5,'Synthetic price','available','declared','JURO Legal',
      'Tashkent','Tashkent','JURO Law School','[\"chat\"]','lawyer-profiles/test/photo.webp',?,?)`,
  ).run(USER_ID, now, now);
}

test("JURO approval and Top Lawyer are independent, auditable designations", async () => {
  const { sqlite, d1 } = seed();
  try {
    seedPendingLawyerProfile(sqlite);
    await moderateLawyerProfile(d1, {
      profileId: "pending-lawyer-profile", moderatorUserId: USER_ID, decision: "approved", reason: "Profile completeness confirmed.", now: NOW,
    });
    const juro = await designateLawyerProfile({
      db: d1, profileId: "pending-lawyer-profile", moderatorUserId: USER_ID,
      designation: "juro_approval", decision: "approved", reason: "Independent JURO quality review completed.", now: NOW.toISOString(),
    });
    assert.deepEqual(juro, { juroApprovalStatus: "approved", topLawyerStatus: "not_featured" });
    const top = await designateLawyerProfile({
      db: d1, profileId: "pending-lawyer-profile", moderatorUserId: USER_ID,
      designation: "top_lawyer", decision: "approved", reason: "Published quality signals were reviewed.",
      criteria: "Published moderated reviews, profile quality and reliable availability were reviewed.", now: NOW.toISOString(),
    });
    assert.deepEqual(top, { juroApprovalStatus: "approved", topLawyerStatus: "featured" });
    const profile = sqlite.prepare("SELECT juro_approval_status AS juroApprovalStatus,top_lawyer_status AS topLawyerStatus,top_lawyer_criteria AS criteria FROM lawyer_profiles WHERE id='pending-lawyer-profile'").get() as { juroApprovalStatus: string; topLawyerStatus: string; criteria: string };
    assert.equal(profile.juroApprovalStatus, "approved");
    assert.equal(profile.topLawyerStatus, "featured");
    assert.match(profile.criteria, /Published moderated reviews/);
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM lawyer_profile_trust_designations").get() as { count: number }).count, 2);
    await assert.rejects(
      designateLawyerProfile({ db: d1, profileId: "pending-lawyer-profile", moderatorUserId: USER_ID, designation: "juro_approval", decision: "approved", reason: "Duplicate." }),
      (error: unknown) => error instanceof LawyerProfileDesignationError && error.code === "DESIGNATION_STATE_CONFLICT",
    );
  } finally {
    sqlite.close();
  }
});

test("admin-domain ticket persists only a hash and creates an append-only audit event", async () => {
  const { sqlite, d1 } = seed();
  try {
    const result = await issueAdminDomainHandoff(d1, {
      staff: staff(),
      appEnvironment: "staging",
      destinationOrigin: "https://admin.staging.juro.uz",
      now: NOW,
    });
    assert.match(result.ticket, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(result.expiresAt, "2026-08-07T08:02:00.000Z");
    const ticket = sqlite.prepare(
      "SELECT environment,token_hash,staff_user_id,source_session_id,destination_origin,expires_at FROM admin_handoff_tickets",
    ).get() as { environment: string; token_hash: string; staff_user_id: string; source_session_id: string; destination_origin: string; expires_at: string };
    assert.deepEqual({ ...ticket }, {
      environment: "staging",
      token_hash: await sha256(result.ticket),
      staff_user_id: USER_ID,
      source_session_id: SESSION_ID,
      destination_origin: "https://admin.staging.juro.uz",
      expires_at: result.expiresAt,
    });
    const event = sqlite.prepare("SELECT action,metadata_json FROM admin_domain_audit_events").get() as { action: string; metadata_json: string };
    assert.equal(event.action, "handoff_issued");
    assert.doesNotMatch(event.metadata_json, /[A-Za-z0-9_-]{43}/u);
    assert.throws(() => sqlite.prepare("UPDATE admin_domain_audit_events SET action='tampered'").run(), /append-only/u);
    assert.throws(() => sqlite.prepare("DELETE FROM admin_domain_audit_events").run(), /append-only/u);
  } finally {
    sqlite.close();
  }
});

test("admin-domain handoff fails closed for non-canonical origins and invalid environment", async () => {
  const { sqlite, d1 } = seed();
  try {
    for (const [appEnvironment, destinationOrigin] of [
      ["staging", "http://admin.staging.juro.uz"],
      ["staging", "https://admin.staging.juro.uz/path"],
      ["preview", "https://admin.staging.juro.uz"],
    ] as const) {
      await assert.rejects(
        issueAdminDomainHandoff(d1, { staff: staff(), appEnvironment, destinationOrigin, now: NOW }),
        /ADMIN_HANDOFF_CONFIGURATION_INVALID/u,
      );
    }
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM admin_handoff_tickets").get()?.total, 0);
  } finally {
    sqlite.close();
  }
});

test("admin-domain handoff is one use and every admin request rechecks source MFA and roles", async () => {
  const { sqlite, d1 } = seed();
  try {
    const issued = await issueAdminDomainHandoff(d1, {
      staff: staff(), appEnvironment: "staging", destinationOrigin: "https://admin.staging.juro.uz", now: NOW,
    });
    const consumed = await consumeAdminDomainHandoff(d1, {
      ticket: issued.ticket, environment: "staging", destinationOrigin: "https://admin.staging.juro.uz", now: NOW,
    });
    assert.match(consumed.token, /^[A-Za-z0-9_-]{43}$/u);
    assert.match(consumed.csrfToken, /^[A-Za-z0-9_-]{43}$/u);
    assert.deepEqual(consumed.roles, ["super_admin"]);
    const principal = await requireAdminDomainSession(d1, {
      token: consumed.token, environment: "staging", now: new Date("2026-08-07T08:01:00.000Z"),
    });
    assert.equal(principal.userId, USER_ID);
    assert.deepEqual(principal.roles, ["super_admin"]);
    await assert.rejects(
      consumeAdminDomainHandoff(d1, {
        ticket: issued.ticket, environment: "staging", destinationOrigin: "https://admin.staging.juro.uz", now: NOW,
      }),
      /TICKET_DENIED/u,
    );
    sqlite.prepare("UPDATE auth_sessions SET revoked_at=? WHERE id=?").run("2026-08-07T08:01:30.000Z", SESSION_ID);
    await assert.rejects(
      requireAdminDomainSession(d1, {
        token: consumed.token, environment: "staging", now: new Date("2026-08-07T08:01:31.000Z"),
      }),
      /SESSION_DENIED/u,
    );
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM admin_domain_audit_events WHERE action='handoff_consumed'").get()?.total, 1);
  } finally {
    sqlite.close();
  }
});

test("admin-domain logout revokes the server session before its browser cookie expires", async () => {
  const { sqlite, d1 } = seed();
  try {
    const issued = await issueAdminDomainHandoff(d1, {
      staff: staff(), appEnvironment: "staging", destinationOrigin: "https://admin.staging.juro.uz", now: NOW,
    });
    const consumed = await consumeAdminDomainHandoff(d1, {
      ticket: issued.ticket, environment: "staging", destinationOrigin: "https://admin.staging.juro.uz", now: NOW,
    });
    await revokeAdminDomainSession(d1, {
      token: consumed.token, environment: "staging", now: new Date("2026-08-07T08:01:00.000Z"),
    });
    await assert.rejects(
      requireAdminDomainSession(d1, {
        token: consumed.token, environment: "staging", now: new Date("2026-08-07T08:01:01.000Z"),
      }),
      /SESSION_DENIED/u,
    );
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM admin_domain_audit_events WHERE action='admin_session_revoked'").get()?.total, 1);
  } finally {
    sqlite.close();
  }
});

test("lawyer moderator may moderate only the review surface and its decisions remain audited", async () => {
  const { sqlite, d1 } = seed();
  try {
    seedPendingReview(sqlite, { requestId: "review-request-1", reviewId: "70000000-0000-4000-8000-000000000001", body: "Хорошая консультация без контактов" });
    assert.equal(adminRoleAllows(["lawyer_moderator"], "lawyer.reviews.moderate"), true);
    assert.equal(adminRoleAllows(["lawyer_moderator"], "dashboard.view"), false);
    const moderated = await moderateLawyerReview(d1, {
      reviewId: "70000000-0000-4000-8000-000000000001",
      moderatorUserId: USER_ID,
      decision: "approved",
      reason: "Synthetic review has no personal data.",
      now: NOW,
    });
    assert.deepEqual(moderated, { status: "approved" });
    assert.equal(sqlite.prepare("SELECT status FROM lawyer_reviews WHERE id=?").get("70000000-0000-4000-8000-000000000001")?.status, "approved");
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM lawyer_review_moderation").get()?.total, 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM workspace_audit_events WHERE action='lawyer_review_moderated'").get()?.total, 1);
  } finally {
    sqlite.close();
  }
});

test("review approval blocks likely personal data before any terminal transition", async () => {
  const { sqlite, d1 } = seed();
  try {
    seedPendingReview(sqlite, { requestId: "review-request-2", reviewId: "70000000-0000-4000-8000-000000000002", body: "Позвоните мне по +998 90 123 45 67" });
    await assert.rejects(
      moderateLawyerReview(d1, {
        reviewId: "70000000-0000-4000-8000-000000000002",
        moderatorUserId: USER_ID,
        decision: "approved",
        reason: "Synthetic check.",
        now: NOW,
      }),
      (error: unknown) => error instanceof LawyerReviewModerationServiceError && error.code === "LIKELY_PERSONAL_DATA",
    );
    assert.equal(sqlite.prepare("SELECT status FROM lawyer_reviews WHERE id=?").get("70000000-0000-4000-8000-000000000002")?.status, "pending");
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM lawyer_review_moderation").get()?.total, 0);
  } finally {
    sqlite.close();
  }
});

test("lawyer moderator may request corrections without publishing or booking the profile", async () => {
  const { sqlite, d1 } = seed();
  try {
    seedPendingLawyerProfile(sqlite);
    assert.equal(adminRoleAllows(["lawyer_moderator"], "lawyer.profiles.moderate"), true);
    const moderated = await moderateLawyerProfile(d1, {
      profileId: "pending-lawyer-profile",
      moderatorUserId: USER_ID,
      decision: "changes_requested",
      reason: "Synthetic request: clarify the listed consultation format.",
      now: NOW,
    });
    assert.deepEqual(moderated, { status: "changes_requested" });
    const profileAfterCorrectionRequest = sqlite.prepare("SELECT status,marketplace_status AS marketplaceStatus,public_approved_at AS publicApprovedAt FROM lawyer_profiles WHERE id='pending-lawyer-profile'").get() as {
      status: string;
      marketplaceStatus: string;
      publicApprovedAt: string | null;
    };
    assert.equal(profileAfterCorrectionRequest.status, "pending");
    assert.equal(profileAfterCorrectionRequest.marketplaceStatus, "changes_requested");
    assert.equal(profileAfterCorrectionRequest.publicApprovedAt, null);
    const moderationRecord = sqlite.prepare("SELECT decision,reason FROM lawyer_profile_moderation WHERE lawyer_profile_id='pending-lawyer-profile'").get() as {
      decision: string;
      reason: string;
    };
    assert.equal(moderationRecord.decision, "changes_requested");
    assert.equal(moderationRecord.reason, "Synthetic request: clarify the listed consultation format.");
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM workspace_audit_events WHERE action='lawyer_profile_moderated'").get()?.total, 1);
    const notification = sqlite.prepare(
      "SELECT workspace_id AS workspaceId,user_id AS userId,type,title,body FROM notifications WHERE type='lawyer_profile_status'",
    ).get() as { workspaceId: string; userId: string; type: string; title: string; body: string };
    assert.equal(notification.workspaceId, "profile-workspace");
    assert.equal(notification.userId, USER_ID);
    assert.equal(notification.type, "lawyer_profile_status");
    assert.equal(notification.title, "Профиль юриста нужно доработать");
    assert.match(notification.body, /Synthetic request: clarify the listed consultation format\./u);
  } finally {
    sqlite.close();
  }
});

test("restricted lawyer lifecycle is append-only, blocks work, and restores only to review", async () => {
  const { sqlite, d1 } = seed();
  try {
    seedPendingLawyerProfile(sqlite);
    assert.equal(adminRoleAllows(["lawyer_moderator"], "lawyer.profiles.block"), false);
    assert.equal(adminRoleAllows(["super_admin"], "lawyer.profiles.block"), true);

    const suspended = await transitionLawyerProfileLifecycle(d1, {
      profileId: "pending-lawyer-profile",
      actorUserId: USER_ID,
      action: "suspend",
      reason: "Synthetic temporary operational restriction.",
      now: NOW,
    });
    assert.deepEqual(suspended, { status: "suspended", profileRevision: 1 });
    const profile = sqlite.prepare(
      "SELECT status,marketplace_status AS marketplaceStatus,profile_revision AS profileRevision,public_approved_at AS publicApprovedAt FROM lawyer_profiles WHERE id='pending-lawyer-profile'",
    ).get() as { status: string; marketplaceStatus: string; profileRevision: number; publicApprovedAt: string | null };
    assert.equal(profile.status, "pending");
    assert.equal(profile.marketplaceStatus, "suspended");
    assert.equal(profile.profileRevision, 1);
    assert.equal(profile.publicApprovedAt, null);
    assert.throws(
      () => sqlite.prepare("UPDATE lawyer_profiles SET status='public_approved',marketplace_status='public_approved' WHERE id='pending-lawyer-profile'").run(),
      /lifecycle evidence required/u,
    );
    assert.throws(
      () => sqlite.prepare("UPDATE lawyer_profile_lifecycle_events SET reason='tampered' WHERE lawyer_profile_id='pending-lawyer-profile'").run(),
      /append-only/u,
    );
    const event = sqlite.prepare(
      "SELECT action,reason,actor_user_id AS actorUserId,from_marketplace_status AS fromStatus,to_marketplace_status AS toStatus FROM lawyer_profile_lifecycle_events",
    ).get() as { action: string; reason: string; actorUserId: string; fromStatus: string; toStatus: string };
    assert.equal(event.action, "suspend");
    assert.equal(event.reason, "Synthetic temporary operational restriction.");
    assert.equal(event.actorUserId, USER_ID);
    assert.equal(event.fromStatus, "pending_review");
    assert.equal(event.toStatus, "suspended");
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM workspace_audit_events WHERE action='lawyer_profile_suspended'").get()?.total, 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM notifications WHERE type='lawyer_profile_status'").get()?.total, 1);

    const restored = await transitionLawyerProfileLifecycle(d1, {
      profileId: "pending-lawyer-profile",
      actorUserId: USER_ID,
      action: "restore",
      reason: "Synthetic review restoration.",
      now: new Date("2026-08-07T08:01:00.000Z"),
    });
    assert.deepEqual(restored, { status: "pending_review", profileRevision: 2 });
    const restoredProfile = sqlite.prepare(
      "SELECT marketplace_status AS marketplaceStatus,profile_revision AS profileRevision FROM lawyer_profiles WHERE id='pending-lawyer-profile'",
    ).get() as { marketplaceStatus: string; profileRevision: number };
    assert.equal(restoredProfile.marketplaceStatus, "pending_review");
    assert.equal(restoredProfile.profileRevision, 2);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM lawyer_profile_lifecycle_events").get()?.total, 2);
  } finally {
    sqlite.close();
  }
});

test("admin handoff route requires same-origin write protection and current MFA", async () => {
  const [route, launchPage, accessPage, authPage, localizedLogin, migration, internal, adminWorker, reviewService, platformWorker, adminConfig] = await Promise.all([
    readFile(new URL("../app/api/platform/admin/handoff/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/admin/console/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_staff/AdminConsoleAccess.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_auth/AuthPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/auth/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0109_admin_domain_handoff_sessions.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/admin-internal-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../admin/src/worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/lawyer-review-moderation-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../admin/src/server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /assertSafeWrite\(request\)/u);
  assert.match(route, /requirePlatformStaffRequest\(request, "staff\.console\.view"/u);
  assert.match(route, /freshMfaWithinMs: 15 \* 60 \* 1_000/u);
  assert.match(route, /ADMIN_CONSOLE_ORIGIN/u);
  assert.match(route, /referrer-policy.*no-referrer/u);
  assert.match(launchPage, /freshMfaWithinMs: 15 \* 60 \* 1_000/u);
  assert.match(launchPage, /AdminConsoleAccess/u);
  assert.match(launchPage, /runtime\.APP_ENV === "production"/u);
  assert.doesNotMatch(launchPage, /catch\s*\{\s*notFound\(\)/u);
  assert.match(accessPage, /15 минут/u);
  assert.match(accessPage, /auth\/login\?reauth=1&returnTo=/u);
  assert.match(authPage, /authenticatedAuthRedirect/u);
  assert.match(authPage, /mode,\s*reauth,/u);
  assert.match(localizedLogin, /reauth=\{query\.reauth === "1"\}/u);
  assert.match(accessPage, /environment === "production" \? "JURO · ADMIN" : "JURO · STAGING ADMIN"/u);
  assert.match(migration, /admin_handoff_tickets/u);
  assert.match(migration, /admin_domain_sessions/u);
  assert.match(migration, /admin_domain_audit_events_no_(?:update|delete)/u);
  assert.doesNotMatch(migration, /DROP\s+TABLE/iu);
  assert.match(internal, /x-juro-admin-internal-token/u);
  assert.match(internal, /ADMIN_CONSOLE_TOKEN/u);
  assert.match(internal, /session\/logout/u);
  assert.match(adminWorker, /PLATFORM_ADMIN_API\.fetch/u);
  assert.match(adminWorker, /platformTokenSecretName/u);
  assert.match(adminWorker, /juro_admin_session/u);
  assert.match(adminWorker, /\/reviews/u);
  assert.match(adminWorker, /changes_requested/u);
  assert.match(adminWorker, /\/lifecycle/u);
  assert.match(adminWorker, /RESTRICTED_LAWYER_MARKETPLACE_STATUSES/u);
  assert.match(adminWorker, /action !== "suspend"/u);
  assert.match(internal, /lawyer\.profiles\.block/u);
  assert.match(internal, /lawyer\.reviews\.moderate/u);
  assert.match(internal, /changes_requested/u);
  assert.match(internal, /api\/internal\/admin\/reviews/u);
  assert.match(reviewService, /LIKELY_PERSONAL_DATA/u);
  assert.match(reviewService, /lawyer_review_moderated/u);
  assert.doesNotMatch(adminWorker, /D1Database|d1_databases/u);
  assert.match(platformWorker, /handleInternalAdminRequest/);
  assert.match(adminConfig, /127\.0\.0\.1/);
  assert.match(adminConfig, /ADMIN_INTERNAL_TOKEN/);

});
