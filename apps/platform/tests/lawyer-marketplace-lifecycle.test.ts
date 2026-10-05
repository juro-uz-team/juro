import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isLawyerMarketplaceProfileComplete,
  isRestrictedLawyerMarketplaceStatus,
  marketplaceStatusAfterProfileEdit,
  mayReceiveLawyerRequests,
  missingLawyerMarketplaceFields,
  type LawyerMarketplaceCompletionInput,
} from "../lib/platform/lawyer-marketplace";
import { projectPublicLawyerDirectory } from "../lib/platform/lawyer-directory-reviews";
import { localizedLawyerProfileStatusNotification } from "../lib/platform/lawyer-profile-notifications";
import { moderateLawyerProfile } from "../lib/platform/lawyer-profile-moderation-service";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const completeProfile: LawyerMarketplaceCompletionInput = {
  displayName: "Юрист JURO",
  specialties: ["Договоры"],
  languages: ["ru", "uz"],
  experienceYears: 5,
  education: "Ташкентский государственный юридический университет",
  firmName: "JURO Legal",
  city: "Ташкент",
  region: "Ташкент",
  priceDescription: "По договорённости",
  consultationFormats: ["чат", "телефон"],
  availabilityStatus: "available",
  profilePhotoKey: "lawyer-profiles/user/photo.webp",
  hasPhone: true,
};

test("a lawyer profile is reviewable only after every required professional field is present", () => {
  assert.equal(isLawyerMarketplaceProfileComplete(completeProfile), true);
  assert.equal(marketplaceStatusAfterProfileEdit(completeProfile), "pending_review");

  const incomplete = { ...completeProfile, profilePhotoKey: null, hasPhone: false };
  assert.deepEqual(missingLawyerMarketplaceFields(incomplete), ["profilePhoto", "phone"]);
  assert.equal(isLawyerMarketplaceProfileComplete(incomplete), false);
  assert.equal(marketplaceStatusAfterProfileEdit(incomplete), "profile_incomplete");
});

test("only an approved profile may receive a client request", () => {
  assert.equal(mayReceiveLawyerRequests("profile_incomplete"), false);
  assert.equal(mayReceiveLawyerRequests("pending_review"), false);
  assert.equal(mayReceiveLawyerRequests("changes_requested"), false);
  assert.equal(mayReceiveLawyerRequests("rejected"), false);
  assert.equal(mayReceiveLawyerRequests("suspended"), false);
  assert.equal(mayReceiveLawyerRequests("blocked"), false);
  assert.equal(mayReceiveLawyerRequests("archived"), false);
  assert.equal(mayReceiveLawyerRequests("public_approved"), true);
  assert.equal(isRestrictedLawyerMarketplaceStatus("suspended"), true);
  assert.equal(isRestrictedLawyerMarketplaceStatus("blocked"), true);
  assert.equal(isRestrictedLawyerMarketplaceStatus("archived"), true);
  assert.equal(isRestrictedLawyerMarketplaceStatus("pending_review"), true);
});

test("restricted profiles are locked for edits and excluded from new handoff work", () => {
  const profileRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/route.ts", import.meta.url), "utf8");
  const photoRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/photo/route.ts", import.meta.url), "utf8");
  const handoffRoute = readFileSync(new URL("../app/api/platform/lawyer-requests/route.ts", import.meta.url), "utf8");
  const lifecycleRoute = readFileSync(new URL("../app/api/platform/admin/lawyer-profiles/[profileId]/lifecycle/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../drizzle/0110_lawyer_profile_lifecycle_controls.sql", import.meta.url), "utf8");
  assert.match(profileRoute, /PROFILE_LOCKED/);
  assert.match(photoRoute, /PROFILE_LOCKED/);
  assert.match(handoffRoute, /marketplace_status='public_approved'/);
  assert.match(lifecycleRoute, /staff\.operations\.manage/);
  assert.match(lifecycleRoute, /freshMfaWithinMs: 15 \* 60 \* 1_000/);
  assert.match(migration, /lawyer_profile_lifecycle_events/);
  assert.match(migration, /append-only/);
  assert.match(migration, /lifecycle evidence required/);
  assert.doesNotMatch(migration, /DROP\s+TABLE|DELETE\s+FROM/iu);
});

test("restricting a lawyer revokes stale grants and operational routes recheck profile state", () => {
  const lifecycle = readFileSync(new URL("../lib/platform/lawyer-profile-lifecycle-service.ts", import.meta.url), "utf8");
  const verification = readFileSync(new URL("../app/api/platform/document-analysis/[analysisId]/lawyer-verification/route.ts", import.meta.url), "utf8");
  const consultations = readFileSync(new URL("../app/api/platform/lawyer-consultations/route.ts", import.meta.url), "utf8");
  const proposals = readFileSync(new URL("../app/api/cases/[caseId]/proposals/route.ts", import.meta.url), "utf8");
  const accessGrant = readFileSync(new URL("../app/api/platform/lawyer-requests/[requestId]/access-grant/route.ts", import.meta.url), "utf8");
  assert.match(lifecycle, /UPDATE lawyer_access_grants[\s\S]*revoked_at=\?,revoke_reason=\?/);
  assert.match(lifecycle, /profile_\$\{input\.action\}/);
  for (const route of [verification, consultations, proposals]) {
    assert.match(route, /status='public_approved'/);
    assert.match(route, /marketplace_status='public_approved'/);
  }
  assert.match(proposals, /g\.expires_at IS NULL OR g\.expires_at>\?/);
  assert.match(consultations, /OPERATIONAL_LAWYER_REQUIRED/);
  assert.match(accessGrant, /INSERT INTO lawyer_access_grants[\s\S]*SELECT \?,r\.id,r\.case_id,p\.user_id/);
  assert.match(accessGrant, /p\.status='public_approved' AND p\.marketplace_status='public_approved'/);
  assert.match(accessGrant, /NOT EXISTS \([\s\S]*lawyer_access_grants existing/);
  assert.match(accessGrant, /Number\(results\[0\]\?\.meta\.changes \?\? 0\) !== 1/);
});

test("profile status notifications are localized and preserve only a bounded review reason", () => {
  const ru = localizedLawyerProfileStatusNotification("ru", "changes_requested", "Уточните формат консультации.");
  assert.equal(ru.title, "Профиль юриста нужно доработать");
  assert.match(ru.body, /Уточните формат консультации\./u);
  const uz = localizedLawyerProfileStatusNotification("uz", "pending_review");
  assert.equal(uz.title, "Yurist profilingiz tekshiruvga yuborildi");
  assert.doesNotMatch(uz.body, /Izoh:/u);
});

test("lawyer scheduling persists recurring hours and bounded unavailability", () => {
  const route = readFileSync(new URL("../app/api/platform/lawyer-schedule/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../drizzle/0142_legal_ecosystem_foundation.sql", import.meta.url), "utf8");
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /requireApiUser\(\)/);
  assert.match(route, /lawyer_unavailability_periods/);
  assert.match(route, /datetime\(\{ offset: true \}\)/);
  assert.match(route, /max\(100\)/);
  assert.match(migration, /CREATE TABLE `lawyer_availability_rules`/);
  assert.match(migration, /CREATE TABLE `lawyer_unavailability_periods`/);
  assert.match(migration, /CHECK \(`starts_at` < `ends_at`\)/);
  assert.doesNotMatch(migration, /DROP\s+TABLE/iu);
});

test("consultation transitions are participant-scoped, audited and return a real result", () => {
  const route = readFileSync(new URL("../app/api/platform/lawyer-consultations/route.ts", import.meta.url), "utf8");
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /!isLawyer && !isClient/);
  assert.match(route, /!isClient \|\| existing\.status !== "proposed"/);
  assert.match(route, /!isLawyer \|\| !\["confirmed", "in_progress"\]\.includes/);
  assert.match(route, /resultNote: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(4_000\)/);
  assert.match(route, /lawyer_consultation_\$\{status\}/);
  assert.match(route, /CASE WHEN \?='completed' THEN \? ELSE result_note END/);
});

test("lawyer application has an explicit submit gate and draft saves do not publish", () => {
  const profileRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/route.ts", import.meta.url), "utf8");
  const submitRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/submit/route.ts", import.meta.url), "utf8");
  assert.match(profileRoute, /lawyer_profile_draft_saved/);
  assert.doesNotMatch(profileRoute, /lawyer_profile_submitted/);
  assert.match(submitRoute, /marketplace_status='pending_review'/);
  assert.match(submitRoute, /missingLawyerMarketplaceFields/);
  assert.match(submitRoute, /lawyer_profile_submitted/);
  assert.match(submitRoute, /profile_revision=\?/);
});

test("lawyer service details and six-step application are persisted and reviewable", () => {
  const migration = readFileSync(new URL("../drizzle/0146_lawyer_profile_services.sql", import.meta.url), "utf8");
  const profileRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/route.ts", import.meta.url), "utf8");
  const application = readFileSync(new URL("../app/_platform/LawyerProfessionalProfile.tsx", import.meta.url), "utf8");
  const adminDetail = readFileSync(new URL("../app/api/platform/admin/lawyer-profiles/[profileId]/route.ts", import.meta.url), "utf8");
  const adminPhoto = readFileSync(new URL("../app/api/platform/admin/lawyer-profiles/[profileId]/photo/route.ts", import.meta.url), "utf8");
  const adminInbox = readFileSync(new URL("../app/_staff/LawyerProfileModerationInbox.tsx", import.meta.url), "utf8");
  assert.match(migration, /consultation_duration_minutes/);
  assert.match(migration, /additional_services_json/);
  assert.match(migration, /BETWEEN 15 AND 480/);
  assert.doesNotMatch(migration, /DROP\s+TABLE|DELETE\s+FROM/iu);
  assert.match(profileRoute, /consultation_duration_minutes/);
  assert.match(profileRoute, /additional_services_json/);
  assert.match(application, /<DurationInput[^>]*value=\{form\.consultationDurationMinutes\}/);
  assert.match(application, /<ChoiceInput[^>]*value=\{form\.additionalServices\}[^>]*multiple/);
  assert.match(application, /Шаг 4 · Расписание/);
  assert.match(application, /Отправить профиль на проверку/);
  assert.match(adminDetail, /lawyer_profile_moderation/);
  assert.match(adminDetail, /lawyer_profile_lifecycle_events/);
  assert.match(adminDetail, /lawyer_availability_rules/);
  assert.match(adminPhoto, /lawyer\.profiles\.moderate/);
  assert.match(adminPhoto, /freshMfaWithinMs: 15 \* 60 \* 1_000/);
  assert.match(adminInbox, /REVIEW VIEW/);
  assert.match(adminInbox, /\/lifecycle/);
});

test("availability-only edits preserve an approved public profile", () => {
  const profileRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/route.ts", import.meta.url), "utf8");
  assert.match(profileRoute, /preservesPublishedProfile/);
  assert.match(profileRoute, /!moderatedFieldsChanged\(current, next\)/);
  assert.match(profileRoute, /availability_status=\?,next_available_at=\?,updated_at=\?/);
  assert.match(profileRoute, /resultingRevision = preservesPublishedProfile/);
  assert.doesNotMatch(
    profileRoute.match(/const updateStatement = preservesPublishedProfile[\s\S]*?\n    : db/)?.[0] ?? "",
    /profile_revision=profile_revision\+1|public_approved_at/u,
  );
  assert.match(profileRoute, /publicationPreserved: preservesPublishedProfile/);
});

test("availability-only updates retain the exact moderated revision at the D1 boundary", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const now = "2026-08-29T22:20:00.000Z";
  const moderatorId = "10000000-0000-4000-8000-000000000001";
  const lawyerId = "10000000-0000-4000-8000-000000000002";
  const workspaceId = "20000000-0000-4000-8000-000000000001";
  const profileId = "30000000-0000-4000-8000-000000000001";
  try {
    sqlite.prepare(
      `INSERT INTO user_profiles (id,email,locale,account_type,created_at,updated_at)
       VALUES (?,'moderator@example.test','ru','individual',?,?),
         (?,'lawyer@example.test','ru','lawyer',?,?)`,
    ).run(moderatorId, now, now, lawyerId, now, now);
    sqlite.prepare(
      "INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual','Lawyer workspace','ru',?,?)",
    ).run(workspaceId, now, now);
    sqlite.prepare(
      "UPDATE user_profiles SET default_workspace_id=?,phone='+998901234567' WHERE id=?",
    ).run(workspaceId, lawyerId);
    sqlite.prepare(
      `INSERT INTO lawyer_profiles (
        id,user_id,display_name,specialties_json,languages_json,status,marketplace_status,
        experience_years,price_description,availability_status,advocate_status,firm_name,
        city,region,education,consultation_formats_json,profile_photo_key,created_at,updated_at
      ) VALUES (?,?,'JURO Lawyer','["contracts"]','["ru"]','pending','pending_review',
        5,'By agreement','available','declared','JURO Legal','Tashkent','Tashkent',
        'Law school','["video"]','lawyer-profiles/test/photo.webp',?,?)`,
    ).run(profileId, lawyerId, now, now);

    await moderateLawyerProfile(d1, {
      profileId,
      moderatorUserId: moderatorId,
      decision: "approved",
      reason: "Profile completeness confirmed.",
      now: new Date(now),
    });
    const availabilityUpdate = sqlite.prepare(
      `UPDATE lawyer_profiles SET availability_status='limited',
        next_available_at='2026-09-01T09:00:00.000Z',updated_at=?
       WHERE id=? AND profile_revision=1 AND status='public_approved'
         AND marketplace_status='public_approved' AND updated_at=?`,
    );
    const firstUpdate = availabilityUpdate.run(
      "2026-08-29T22:25:00.000Z",
      profileId,
      now,
    );
    const staleUpdate = availabilityUpdate.run(
      "2026-08-29T22:26:00.000Z",
      profileId,
      now,
    );
    assert.equal(firstUpdate.changes, 1);
    assert.equal(staleUpdate.changes, 0);

    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT status,marketplace_status AS marketplaceStatus,
          profile_revision AS profileRevision,availability_status AS availabilityStatus
         FROM lawyer_profiles WHERE id=?`,
      ).get(profileId) },
      {
        status: "public_approved",
        marketplaceStatus: "public_approved",
        profileRevision: 1,
        availabilityStatus: "limited",
      },
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM lawyer_profile_moderation WHERE lawyer_profile_id=? AND profile_revision=1",
      ).get(profileId) as { total: number }).total,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("a correction-requested profile remains fail-closed if it reaches a directory projection", () => {
  const [lawyer] = projectPublicLawyerDirectory([{
    id: "correction-requested-lawyer",
    displayName: "Юрист JURO",
    specialtiesJson: '["Договоры"]',
    languagesJson: '["ru","uz"]',
    experienceYears: 5,
    priceDescription: "По договорённости",
    availabilityStatus: "available",
    nextAvailableAt: null,
    advocateStatus: "not_verified",
    firmName: null,
    bio: null,
    marketplaceStatus: "changes_requested",
  }], [], []);
  assert.equal(lawyer.marketplaceStatus, "pending_review");
  assert.equal(lawyer.canReceiveRequests, false);
});

test("profile photos remain fail-closed until the malware scanner verifies their checksum", () => {
  const route = readFileSync(new URL("../app/api/platform/lawyer-profile/photo/route.ts", import.meta.url), "utf8");
  assert.match(route, /malwareScannerResponseSchema/);
  assert.match(route, /MALWARE_SCANNER_UNAVAILABLE/);
  assert.match(route, /scanVerdict !== "clean"/);
  assert.match(route, /parsed\.data\.sourceSha256 !== checksum/);
  assert.ok(route.indexOf("const scanVerdict") < route.indexOf("const objectKey"));
});

test("a completed profile stays private until approval and retains a self-only preview", () => {
  const publicPhotoRoute = readFileSync(new URL("../app/api/public/lawyers/[profileId]/photo/route.ts", import.meta.url), "utf8");
  const directoryRoute = readFileSync(new URL("../app/api/platform/lawyers/route.ts", import.meta.url), "utf8");
  const publicDirectoryRoute = readFileSync(new URL("../app/api/public/lawyers/route.ts", import.meta.url), "utf8");
  const publicDetailRoute = readFileSync(new URL("../app/api/public/lawyers/[profileId]/route.ts", import.meta.url), "utf8");
  const directoryClient = readFileSync(new URL("../app/_platform/LawyerDirectoryClient.tsx", import.meta.url), "utf8");
  const detailRoute = readFileSync(new URL("../app/api/platform/lawyers/[lawyerId]/route.ts", import.meta.url), "utf8");
  const detailClient = readFileSync(new URL("../app/_platform/LawyerProfileClient.tsx", import.meta.url), "utf8");
  const privatePhotoRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/photo/route.ts", import.meta.url), "utf8");
  const privateProfileRoute = readFileSync(new URL("../app/api/platform/lawyer-profile/route.ts", import.meta.url), "utf8");
  for (const source of [publicPhotoRoute, directoryRoute, publicDirectoryRoute, publicDetailRoute, detailRoute]) {
    assert.match(source, /status='public_approved'/);
    assert.match(source, /marketplace_status='public_approved'/);
    assert.doesNotMatch(source, /marketplace_status='pending_review' AND status='pending'/);
  }
  assert.doesNotMatch(publicDirectoryRoute, /phone|user_profiles|moderation_notes/i);
  assert.match(detailClient, /consultations\?lawyer=/);
  assert.match(privateProfileRoute, /lawyer_profile_status/);
  const application = readFileSync(new URL("../app/_platform/LawyerProfessionalProfile.tsx", import.meta.url), "utf8");
  assert.match(application, /lawyer-profile-preview/);
  assert.match(application, /Предпросмотр публичного профиля/);
  assert.match(privatePhotoRoute, /export const GET/);
  assert.match(privatePhotoRoute, /WHERE user_id=\?/);
  assert.match(privatePhotoRoute, /lawyer_profile_status/);
  assert.match(directoryClient, /canReceiveRequests/);
});

test("JURO approval and Top Lawyer remain separate public designations", () => {
  const designationRoute = readFileSync(new URL("../app/api/platform/admin/lawyer-profiles/[profileId]/designation/route.ts", import.meta.url), "utf8");
  const designationService = readFileSync(new URL("../lib/platform/lawyer-profile-designation-service.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../drizzle/0116_lawyer_trust_designations.sql", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../app/_platform/LawyerDirectoryClient.tsx", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../app/_platform/LawyerProfileClient.tsx", import.meta.url), "utf8");
  const staffPanel = readFileSync(new URL("../app/_staff/LawyerTrustDesignationPanel.tsx", import.meta.url), "utf8");
  assert.match(designationRoute, /freshMfaWithinMs: 15 \* 60 \* 1_000/);
  assert.match(designationRoute, /lawyer\.profiles\.moderate/);
  assert.match(designationService, /marketplace_status='public_approved'/);
  assert.match(designationService, /workspace_audit_events/);
  assert.match(migration, /lawyer_profile_trust_designations/);
  assert.match(migration, /append-only/);
  assert.match(directory, /Одобрен JURO/);
  assert.match(directory, /Top Lawyer/);
  assert.match(profile, /Фото:/);
  assert.match(profile, /Критерии Top Lawyer/);
  assert.match(staffPanel, /\/designation/);
  assert.match(staffPanel, /Публичные критерии Top Lawyer/);
});
