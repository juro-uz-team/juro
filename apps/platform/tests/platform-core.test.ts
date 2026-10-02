import assert from "node:assert/strict";
import test from "node:test";
import { glob, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { entitlementsForSubscription, resolveAiAnswerCycleLimit } from "../lib/billing/entitlements";
import { billingPlanSelectionSchema } from "../lib/billing/input";
import { consultationBookingSchema } from "../lib/platform/consultation";
import { conflictCheckDecisionSchema, lawyerAccessGrantSchema, lawyerRequestSchema } from "../lib/platform/lawyer-request";
import { lawyerOfferCreateSchema, lawyerOfferResponseSchema } from "../lib/platform/lawyer-offer";
import { lawyerRequestMessageSchema } from "../lib/platform/lawyer-request-message";
import { lawyerProfileCreateSchema, lawyerProfileModerationSchema, lawyerProfileUpdateSchema } from "../lib/platform/lawyer-profile";
import { lawyerReviewSchema } from "../lib/platform/lawyer-review";
import { hasLikelyPersonalData, lawyerReviewModerationSchema } from "../lib/platform/lawyer-review-moderation";
import { MINIMUM_PUBLISHED_LAWYER_REVIEWS, projectPublicLawyerDirectory } from "../lib/platform/lawyer-directory-reviews";
import { normalizeEmail, randomOtp, sha256 } from "../lib/auth/crypto";
import { pricingConfig } from "../config/pricing";
import { appLegalContent } from "../content/app-legal";
import { canEditWorkspaceContent, canManageTeam, isWorkspaceRole } from "../lib/platform/role-policy";
import {
  INTERNAL_REQUEST_PATH_HEADER,
  isAccountType,
  isAuthenticatedPlatformLocaleReady,
  isAuthenticatedPlatformPathReady,
  isLocale,
  isPlatformModule,
  isWorkspaceId,
  platformBasePath,
  platformPath,
  safeWorkspaceReturnPath,
  workspaceForAccountRoute,
} from "../lib/platform/routing";
import { actionPlanStepPatchSchema } from "../lib/platform/action-plan";
import { taskStatusForPlanStep, taskStatusIsTerminal } from "../lib/platform/task-status";
import { builderNavigationPaths } from "../lib/platform/builder-paths";
import { documentBuilderMetadataCopy, localizedDocumentStatus, workspaceCopy } from "../lib/platform/builder-workspace-copy";
import { isLawyerProfileDirectoryPreviewEnabled } from "../lib/platform/lawyer-profile-preview";
import { notificationPreferencesSchema, optionalEmailPreferenceKeys } from "../lib/platform/notification-preferences";
import {
  globalSearchFuzzyNeedle,
  globalSearchGroupScore,
  globalSearchQueryMode,
  rankGlobalSearchRows,
  semanticGlobalSearchScore,
} from "../lib/platform/global-search-policy";

test("lawyer directory projects only moderation-approved review aggregates", () => {
  const directory = projectPublicLawyerDirectory(
    [{ id: "lawyer-1", displayName: "Юрист JURO", specialtiesJson: '["contracts"]', languagesJson: '["ru","uz"]', experienceYears: 7, priceDescription: "По договорённости", availabilityStatus: "available", nextAvailableAt: "2026-08-03T10:00:00.000Z", advocateStatus: "declared", firmName: "JURO Legal", bio: "Договорная практика" }],
    [{ lawyerProfileId: "lawyer-1", reviewCount: 3, overallAverage: 4.666, speedAverage: 4.5, qualityAverage: 5, communicationAverage: 4 }],
    [
      { reviewId: "review-1", lawyerProfileId: "lawyer-1", overallRating: 5, body: "Проверенный текст", createdAt: "2026-08-02T00:00:00.000Z", replyBody: "Одобренный ответ", replyCreatedAt: "2026-08-03T00:00:00.000Z" },
      { reviewId: "review-2", lawyerProfileId: "lawyer-1", overallRating: 4, body: "Второй", createdAt: "2026-08-01T00:00:00.000Z", replyBody: null, replyCreatedAt: null },
      { reviewId: "review-3", lawyerProfileId: "lawyer-1", overallRating: 4, body: "Третий", createdAt: "2026-07-31T00:00:00.000Z", replyBody: null, replyCreatedAt: null },
      { reviewId: "review-4", lawyerProfileId: "lawyer-1", overallRating: 3, body: "Скрытый четвёртый", createdAt: "2026-07-30T00:00:00.000Z", replyBody: null, replyCreatedAt: null },
    ],
  );
  assert.deepEqual(directory, [{
    id: "lawyer-1", displayName: "Юрист JURO", specialties: ["contracts"], languages: ["ru", "uz"], experienceYears: 7, priceDescription: "По договорённости", consultationDurationMinutes: 60, additionalServices: [], availabilityStatus: "available", nextAvailableAt: "2026-08-03T10:00:00.000Z", advocateStatus: "declared", firmName: "JURO Legal", bio: "Договорная практика",
    rating: { reviewCount: 3, overallAverage: 4.67, speedAverage: 4.5, qualityAverage: 5, communicationAverage: 4 },
    reviews: [
      { id: "review-1", overallRating: 5, body: "Проверенный текст", createdAt: "2026-08-02T00:00:00.000Z", reply: { body: "Одобренный ответ", createdAt: "2026-08-03T00:00:00.000Z" } },
      { id: "review-2", overallRating: 4, body: "Второй", createdAt: "2026-08-01T00:00:00.000Z", reply: null },
      { id: "review-3", overallRating: 4, body: "Третий", createdAt: "2026-07-31T00:00:00.000Z", reply: null },
    ],
  }]);
  assert.equal(projectPublicLawyerDirectory([{ id: "lawyer-2", displayName: "Без отзывов", specialtiesJson: "[]", languagesJson: "[]", experienceYears: null, priceDescription: null, availabilityStatus: "unknown", nextAvailableAt: null, advocateStatus: "not_declared", firmName: null, bio: null }], [], [])[0]?.rating.reviewCount, 0);
});

test("public lawyer rating waits for the minimum approved-review threshold", () => {
  const lawyer = { id: "lawyer-public", displayName: "Юрист", specialtiesJson: "[]", languagesJson: "[]", experienceYears: 3, priceDescription: null, availabilityStatus: "available", nextAvailableAt: null, advocateStatus: "not_declared", firmName: null, bio: null };
  const below = projectPublicLawyerDirectory([lawyer], [{ lawyerProfileId: lawyer.id, reviewCount: MINIMUM_PUBLISHED_LAWYER_REVIEWS - 1, overallAverage: 5, speedAverage: 5, qualityAverage: 5, communicationAverage: 5 }], []);
  assert.equal(below[0]?.rating.reviewCount, 0);
  const atThreshold = projectPublicLawyerDirectory([lawyer], [{ lawyerProfileId: lawyer.id, reviewCount: MINIMUM_PUBLISHED_LAWYER_REVIEWS, overallAverage: 5, speedAverage: 5, qualityAverage: 5, communicationAverage: 5 }], []);
  assert.equal(atThreshold[0]?.rating.reviewCount, MINIMUM_PUBLISHED_LAWYER_REVIEWS);
});

test("lawyer professional profile accepts only bounded self-declared directory data", async () => {
  const valid = { displayName: "Юрист JURO", specialties: ["contracts"], languages: ["ru", "uz"], experienceYears: 7, priceDescription: "По договорённости", consultationDurationMinutes: 60, additionalServices: ["Письменное заключение"], availabilityStatus: "available", nextAvailableAt: "2026-08-03T10:00:00.000Z", advocateStatus: "declared", firmName: "JURO Legal", bio: "Договорная практика", locale: "ru" };
  assert.equal(lawyerProfileCreateSchema.safeParse(valid).success, true);
  assert.equal(lawyerProfileCreateSchema.safeParse({ ...valid, advocateStatus: "verified" }).success, false);
  assert.equal(lawyerProfileCreateSchema.safeParse({ ...valid, experienceYears: 100 }).success, false);
  assert.equal(lawyerProfileUpdateSchema.safeParse({ locale: "ru" }).success, false);
  assert.equal(lawyerProfileModerationSchema.safeParse({ decision: "approved", reason: "Checked current revision.", locale: "ru" }).success, true);
  const [route, client, handoffClient, migration] = await Promise.all([
    readFile(new URL("../app/api/platform/lawyer-profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerProfessionalProfile.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerHandoffClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0058_innocent_ben_grimm.sql", import.meta.url), "utf8"),
  ]);
  assert.equal(isLawyerProfileDirectoryPreviewEnabled({ APP_ENV: "staging", LAWYER_PROFILE_DIRECTORY_ENABLED: "true", DB: {} }), true);
  assert.equal(isLawyerProfileDirectoryPreviewEnabled({ APP_ENV: "development", LAWYER_PROFILE_DIRECTORY_ENABLED: "true", DB: {} }), true);
  assert.equal(isLawyerProfileDirectoryPreviewEnabled({ APP_ENV: "production", LAWYER_PROFILE_DIRECTORY_ENABLED: "true", DB: {} }), true);
  for (const environment of [undefined, "preview"]) assert.equal(isLawyerProfileDirectoryPreviewEnabled({ APP_ENV: environment, LAWYER_PROFILE_DIRECTORY_ENABLED: "true", DB: {} }), false);
  assert.equal(isLawyerProfileDirectoryPreviewEnabled({ APP_ENV: "staging", LAWYER_PROFILE_DIRECTORY_ENABLED: "false", DB: {} }), false);
  assert.equal(isLawyerProfileDirectoryPreviewEnabled({ APP_ENV: "staging", LAWYER_PROFILE_DIRECTORY_ENABLED: "true" }), false);
  assert.match(route, /account_type IN \('lawyer','business'\)/); assert.match(route, /isLawyerProfileDirectoryPreviewEnabled/); assert.match(route, /assertSafeWrite/); assert.match(route, /lawyer_profile_created/); assert.match(route, /lawyer_profile_draft_saved/); assert.match(route, /meta\.changes/); assert.match(route, /WHERE EXISTS/);
  assert.match(client, /Статус адвоката «подтверждён» нельзя установить самостоятельно/);
  for (const filter of ["specialtyFilter", "languageFilter", "minimumExperience", "minimumRating", "availabilityFilter", "advocateFilter", "firmFilter"]) assert.match(handoffClient, new RegExp(filter));
  assert.match(migration, /lawyer_profiles_directory_values_insert/); assert.match(migration, /lawyer_profiles_directory_filter_idx/);
});

test("lawyer-profile approval is staff-capability and revision gated", async () => {
  const [capabilities, listRoute, decisionRoute, service, page, migration] = await Promise.all([
    readFile(new URL("../lib/auth/staff-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/admin/lawyer-profiles/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/admin/lawyer-profiles/[profileId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/lawyer-profile-moderation-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/admin/lawyer-profiles/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0059_pretty_punisher.sql", import.meta.url), "utf8"),
  ]);
  assert.match(capabilities, /lawyer\.profiles\.moderate/);
  assert.match(listRoute, /isLawyerProfileDirectoryPreviewEnabled/); assert.match(listRoute, /freshMfaWithinMs/); assert.match(listRoute, /profile_revision/);
  assert.match(decisionRoute, /isLawyerProfileDirectoryPreviewEnabled/); assert.match(decisionRoute, /moderateLawyerProfile/);
  assert.match(service, /lawyer_profile_moderation/); assert.match(service, /profileSha256/); assert.match(service, /lawyer_profile_moderated/); assert.match(service, /meta\.changes/); assert.match(service, /WHERE EXISTS/);
  assert.match(page, /lawyer\.profiles\.moderate/);
  assert.match(migration, /lawyer_profile_moderation_revision_uidx/); assert.match(migration, /lawyer_profiles_status_requires_moderation/); assert.match(migration, /append-only/);
});

test("builder navigation preserves canonical locale and account context", () => {
  const caseId = "11111111-1111-4111-8111-111111111111";
  const stepId = "22222222-2222-4222-8222-222222222222";
  const ru = builderNavigationPaths(
    "/ru/individual/document-builder/debt?caseId=discarded",
    { caseId, planStepId: stepId },
  );
  assert.equal(ru.locale, "ru");
  assert.equal(ru.builder, `/ru/individual/document-builder?caseId=${caseId}&stepId=${stepId}`);
  assert.equal(ru.documents, "/ru/individual/documents");
  assert.equal(ru.template("debt", "0602001"), `/ru/individual/document-builder/debt/0602001?caseId=${caseId}&stepId=${stepId}`);
  assert.equal(ru.document("doc / 1"), "/ru/individual/documents/doc%20%2F%201");
  assert.equal(ru.switchLocale("uz"), `/uz/individual/document-builder/debt?caseId=${caseId}&stepId=${stepId}`);

  const uz = builderNavigationPaths("/uz/business/document-builder/");
  assert.equal(uz.contacts, "/uz/business/contacts");
  assert.equal(uz.notifications, "/uz/business/notifications");

  const business = builderNavigationPaths("/ru/business/ws_business_1/document-builder/contracts");
  assert.equal(business.builder, "/ru/business/ws_business_1/document-builder");
  assert.equal(business.documents, "/ru/business/ws_business_1/documents");
  assert.equal(business.switchLocale("uz"), "/uz/business/ws_business_1/document-builder/contracts");

  const legacy = builderNavigationPaths("/document-builder/library");
  assert.equal(legacy.locale, null);
  assert.equal(legacy.library, "/document-builder/library");
  assert.equal(legacy.document("doc-1"), "/document-builder/documents/doc-1");

  const unsafe = builderNavigationPaths("/ru/individual/document-builder", {
    caseId: "not-a-uuid",
    planStepId: stepId,
  });
  assert.equal(unsafe.builder, "/ru/individual/document-builder");
  assert.equal(unsafe.template("debt", "0602001"), "/ru/individual/document-builder/debt/0602001");
});
test("action plan step updates accept only bounded calendar data", () => {
  assert.deepEqual(
    actionPlanStepPatchSchema.parse({
      status: "in_progress",
      revision: 1,
      dueAt: "2026-08-31",
    }),
    { status: "in_progress", revision: 1, dueAt: "2026-08-31" },
  );
  assert.equal(actionPlanStepPatchSchema.safeParse({
    status: "completed",
    revision: 2,
    dueAt: null,
  }).success, true);
  for (const dueAt of ["2026-02-30", "2026-8-01", "tomorrow", "2026-08-01T00:00:00Z"]) {
    assert.equal(actionPlanStepPatchSchema.safeParse({
      status: "not_started",
      revision: 1,
      dueAt,
    }).success, false);
  }
  assert.equal(actionPlanStepPatchSchema.safeParse({ status: "unknown", revision: 1, dueAt: null }).success, false);
  assert.equal(actionPlanStepPatchSchema.safeParse({ status: "completed", revision: 0, dueAt: null }).success, false);
  assert.equal(actionPlanStepPatchSchema.safeParse({ status: "completed", revision: 1, dueAt: null, userId: "other" }).success, false);

});
test("workspace entitlements fail closed without current paid evidence", () => {
  const now = new Date("2026-07-30T12:00:00.000Z");
  assert.deepEqual(entitlementsForSubscription(null, now), {
    planCode: "free",
    subscriptionStatus: null,
    aiAnswerCyclesMonthly: 20,
    lawyerHandoff: false,
    fullDocumentAnalysis: false,
    expertDocumentAnalysis: false,
    documentComparison: false,
  });
  const active = entitlementsForSubscription({
    planCode: "individual",
    status: "active",
    currentPeriodEndsAt: "2026-08-30T12:00:00.000Z",
  }, now);
  assert.equal(active.lawyerHandoff, true);
  assert.equal(active.planCode, "individual");
  assert.equal(active.aiAnswerCyclesMonthly, 120);
  for (const evidence of [
    { planCode: "individual", status: "past_due", currentPeriodEndsAt: "2026-08-30T12:00:00.000Z" },
    { planCode: "individual", status: "active", currentPeriodEndsAt: "invalid" },
    { planCode: "individual", status: "active", currentPeriodEndsAt: "2026-07-01T00:00:00.000Z" },
    { planCode: "unknown", status: "active", currentPeriodEndsAt: null },
  ]) {
    assert.equal(entitlementsForSubscription(evidence, now).lawyerHandoff, false);
  }
});

test("AI answer cycles are unlimited only in local development", () => {
  assert.equal(resolveAiAnswerCycleLimit("development", 20), null);
  assert.equal(resolveAiAnswerCycleLimit("staging", 120), 120);
  assert.equal(resolveAiAnswerCycleLimit("production", 600), 600);
  assert.equal(resolveAiAnswerCycleLimit(undefined, 20), 20);
});

test("consultation and billing requests are strict and tenant-context shaped", () => {
  const slotId = "11111111-1111-4111-8111-111111111111";
  const caseId = "22222222-2222-4222-8222-222222222222";
  const planStepId = "33333333-3333-4333-8333-333333333333";
  assert.equal(consultationBookingSchema.safeParse({
    slotId,
    caseId,
    planStepId,
    consent: true,
    locale: "uz",
  }).success, true);
  assert.equal(consultationBookingSchema.safeParse({
    slotId,
    planStepId,
    consent: true,
    locale: "ru",
  }).success, false);
  assert.equal(consultationBookingSchema.safeParse({
    slotId,
    consent: false,
    locale: "ru",
  }).success, false);
  assert.equal(consultationBookingSchema.safeParse({
    slotId,
    consent: true,
    locale: "ru",
    userId: "other",
  }).success, false);
  assert.equal(billingPlanSelectionSchema.safeParse({ planCode: "individual", locale: "ru" }).success, true);
  assert.equal(billingPlanSelectionSchema.safeParse({ planCode: "free", locale: "ru" }).success, false);
  assert.equal(billingPlanSelectionSchema.safeParse({ planCode: "business" }).success, false);
});

test("personal routes retain the personal workspace when business is default", () => {
  const personal = { id: "ws_personal", type: "individual" as const };
  const business = { id: "ws_business", type: "business" as const };

  assert.equal(
    workspaceForAccountRoute(business, [personal, business], "individual"),
    personal,
  );
  assert.equal(
    workspaceForAccountRoute(business, [personal, business], "entrepreneur"),
    personal,
  );
  assert.equal(
    workspaceForAccountRoute(business, [personal, business], "lawyer"),
    personal,
  );
  assert.equal(
    workspaceForAccountRoute(business, [personal, business], "business"),
    business,
  );
});

test("builder workspaces expose complete RU and UZ navigation copy", () => {
  const ru = workspaceCopy("ru");
  const uz = workspaceCopy("uz");
  assert.equal(ru.documents.title, "Мои документы");
  assert.equal(uz.documents.title, "Mening hujjatlarim");
  assert.equal(uz.contacts.newTitle, "Yangi kontakt");
  assert.equal(uz.notifications.emptyTitle, "Yangi bildirishnomalar yo‘q");
  assert.equal(localizedDocumentStatus("Черновик", "uz"), "Qoralama");
  assert.equal(localizedDocumentStatus("custom", "uz"), "custom");
  assert.equal(localizedDocumentStatus("Черновик", "ru"), "Черновик");
  assert.equal(documentBuilderMetadataCopy("ru").title, "Создать документ");
  assert.equal(documentBuilderMetadataCopy("uz").title, "Hujjat yaratish");
});

test("OTP values are six decimal digits and email normalization is stable", () => {
  for (let index=0; index<200; index++) assert.match(randomOtp(), /^\d{6}$/);
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
});

test("OTP hashes are deterministic and do not expose the code", async () => {
  const digest = await sha256("salt:123456");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, await sha256("salt:123456"));
  assert.doesNotMatch(digest, /123456/);
});

test("session cookies are HttpOnly, secure and revocable", async () => {
  const source=await readFile(new URL("../lib/auth/session.ts",import.meta.url),"utf8");
  assert.match(source,/HttpOnly/);assert.match(source,/Secure/);assert.match(source,/SameSite=Lax/);assert.match(source,/Max-Age=0/);assert.match(source,/domain\?: string/);
});

test("application shell refreshes due local sessions through the protected periodic-rotation route", async () => {
  const [route, shell, refresh, rotation] = await Promise.all([
    readFile(
      new URL(
        "../app/api/platform/security/sessions/refresh/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/_platform/PlatformShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/_platform/useSessionRefresh.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/auth/session-rotation.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /localSessionForRequest\(request/);
  assert.match(route, /rotatePeriodicSessionToken/);
  assert.match(
    route,
    /replacementSessionCookiesUntil\([\s\S]*?result\.token,[\s\S]*?result\.expiresAt,[\s\S]*?new URL\(request\.url\)\.hostname,[\s\S]*?now/,
  );
  assert.doesNotMatch(route, /sharedAuthCookieDomain/);
  assert.match(route, /jsonNoStore/);
  assert.match(shell, /useSessionRefresh\(locale\)/);
  assert.match(refresh, /sessions\/refresh\?lang=\$\{locale\}/);
  assert.match(refresh, /"x-juro-csrf": "1"/);
  assert.match(refresh, /credentials: "same-origin"/);
  assert.match(refresh, /visibilitychange/);
  assert.match(refresh, /authenticationRetryUsed/);
  assert.match(refresh, /response\.status === 401/);
  assert.match(rotation, /PERIODIC_SESSION_ROTATION_MS = 12 \* 60 \* 60/);
  assert.match(rotation, /replayed\.rotationReason === "periodic"/);
  assert.match(rotation, /replayElapsedMs < PERIODIC_REPLAY_GRACE_MS/);
});

test("OTP, MFA, and logout writes require the application CSRF contract", async () => {
  const [
    authForm,
    logoutButton,
    logoutClient,
    requestRoute,
    verifyRoute,
    verifyMfaRoute,
    logoutRoute,
    logoutHandler,
  ] =
    await Promise.all([
      readFile(new URL("../app/_auth/AuthForm.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/_platform/LogoutButton.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/_platform/logout-client.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/auth/request-otp/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/auth/verify-otp/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/auth/verify-mfa/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/auth/logout/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../lib/auth/logout-handler.ts", import.meta.url), "utf8"),
    ]);
  assert.equal(authForm.match(/"x-juro-csrf": "1"/g)?.length, 5);
  for (const endpoint of [
    "/api/auth/password-login",
    "/api/auth/request-otp",
    "/api/auth/verify-otp",
    "/api/auth/reset-password",
    "/api/auth/verify-mfa",
  ]) {
    assert.match(authForm, new RegExp(`fetch\\("${endpoint.replaceAll("/", "\\/")}"`));
  }
  assert.match(logoutButton, /performLogout\(locale\)/);
  assert.match(logoutClient, /"x-juro-csrf"\s*:\s*"1"/);
  for (const route of [
    requestRoute,
    verifyRoute,
    verifyMfaRoute,
    logoutHandler,
  ]) {
    assert.match(route, /assertSafeWrite\(request\)/);
  }
  for (const route of [requestRoute, verifyRoute, verifyMfaRoute, logoutRoute]) {
    assert.match(route, /withApiErrors/);
  }
  assert.match(requestRoute, /requestOtpInputSchema/);
  assert.match(verifyRoute, /verifyOtpInputSchema/);
  assert.match(verifyMfaRoute, /verifyMfaInputSchema/);
  assert.match(authForm, /rememberMe/);
  assert.match(verifyRoute, /rememberMe: body\.rememberMe/);
  assert.match(
    verifyRoute,
    /replacementSessionCookies\(session\.token, body\.rememberMe, requestHostname\)/,
  );
  assert.match(verifyMfaRoute, /replacementSessionCookies\(result\.session\.token, rememberMe, requestHostname\)/);
  assert.match(verifyRoute, /deviceContinuityCookie\(session\.deviceContinuityToken\)/);
  assert.match(verifyMfaRoute, /deviceContinuityCookie\(result\.session\.deviceContinuityToken\)/);
});

test("auth locale links retain the canonical locale URL and query string", async () => {
  const authForm = await readFile(new URL("../app/_auth/AuthForm.tsx", import.meta.url), "utf8");
  assert.match(authForm, /usePathname/);
  assert.match(authForm, /useSearchParams/);
  assert.match(authForm, /const locale = initialLocale/);
  assert.match(authForm, /pathname\.replace/);
  assert.match(authForm, /searchParams\.toString\(\)/);
  assert.match(authForm, /\(\["ru", "uz", "en"\] as const\)\.map/);
  assert.match(authForm, /href=\{hrefFor\(value\)\}/);
  assert.match(authForm, /hrefLang=\{value\}/);
});

test("production identity prefers OTP sessions and gates trusted edge headers", async () => {
  const source = await readFile(new URL("../app/chatgpt-auth.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("const sessionUser = await getSessionUser(request)") < source.indexOf("const requestHeaders = request?.headers ?? await headers()"));
  assert.match(source, /ALLOW_PLATFORM_AUTH_HEADERS/);
  assert.match(source, /APP_ENV !== "production"/);
  assert.match(source, /logoutPendingFromCookie/);
  assert.ok(
    source.indexOf("logoutPendingFromCookie(requestHeaders.get(\"cookie\"))")
      < source.indexOf("const email = requestHeaders.get(USER_EMAIL_HEADER)"),
  );
  assert.doesNotMatch(source, /NODE_ENV !== "production" \|\|/);
  assert.match(source, /authSource: "platform_header"/);
  assert.match(source, /assuranceLevel: "upstream"/);
  assert.match(source, /sessionId: null/);
  assert.match(source, /hasActiveMfa/);
  assert.match(
    source,
    /localUserId && await hasActiveMfa\(db, localUserId\)/,
  );
  assert.match(source, /userIdByEmail/);
  assert.match(source, /runtimeIdentityProtection/);
});

test("local development login is explicit, loopback-only, and creates a real session", async () => {
  const [route, developmentAuth, authPage, authForm, launcher, rootPackageText] = await Promise.all([
    readFile(new URL("../app/api/auth/dev-login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/development-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_auth/AuthPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_auth/AuthForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/runtime/self-hosted.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(developmentAuth, /NODE_ENV !== "production"/);
  assert.match(developmentAuth, /APP_ENV === "development"/);
  assert.match(developmentAuth, /LOCAL_AUTH_BYPASS === "true"/);
  assert.match(developmentAuth, /authMethod === "development_bypass"/);
  assert.match(route, /isLoopbackDevelopmentHost/);
  assert.match(route, /createLocalDevelopmentSession/);
  assert.match(route, /sessionCookie\(session\.token\)/);
  assert.match(authPage, /developmentAuthEnabled/);
  assert.match(authForm, /\/api\/auth\/dev-login\?returnTo=/);
  assert.match(launcher, /LOCAL_AUTH_BYPASS: "false"/);
  assert.equal(JSON.parse(rootPackageText).scripts.dev, "npm run dev:platform");
  assert.match(
    await readFile(new URL("../server/index.ts", import.meta.url), "utf8"),
    /listen\(port, "127\.0\.0\.1"/,
  );

});

test("canonical identity expand stays disabled and public projections omit protected fields", async () => {
  const [
    identity,
    session,
    profile,
    storage,
    team,
    collaboration,
    workspaceInvitation,
    documentInvitation,
    identityEvidence,
    config,
  ] = await Promise.all([
    readFile(new URL("../lib/auth/identity-protection.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/session-management.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/document-builder/storage/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/team/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/document-builder/documents/[id]/collaboration/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/api/platform/team/invitations/accept/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/document-builder/invitations/[token]/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../lib/auth/identity-evidence.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/runtime/self-hosted.ts", import.meta.url), "utf8"),
  ]);
  assert.match(identity, /"legacy" \| "dual_write"/);
  assert.match(identity, /backfillUserIdentityBatch/);
  assert.match(identity, /IDENTITY_VALUE_DIVERGED/);
  assert.match(config, /\.\.\.process\.env/);
  assert.match(session, /return \{\s*sessionId:/);
  assert.doesNotMatch(storage, /\.\.\.existing/);
  assert.match(storage, /!existing\.onboardingCompletedAt/);
  assert.doesNotMatch(profile, /profile:\s*profile\.results/);
  assert.doesNotMatch(team, /members:\s*members\.results/);
  assert.doesNotMatch(team, /invitations:\s*invitations\.results/);
  assert.match(team, /invitations:\s*resolvedInvitations/);
  assert.doesNotMatch(
    collaboration,
    /collaborators:\s*collaborators\.results/,
  );
  assert.match(
    collaboration,
    /target_identifier_lookup_hash/,
  );
  assert.match(workspaceInvitation, /identityEvidenceMatches/);
  assert.match(documentInvitation, /identityEvidenceMatches/);
  assert.match(identityEvidence, /context\.mode === "legacy"/);
  assert.match(identityEvidence, /IDENTITY_VALUE_DIVERGED/);
  assert.match(identityEvidence, /secureEqual/);
});

test("short-lived challenge evidence is keyed without enabling rollout", async () => {
  const [
    requestOtp,
    verifyOtp,
    otpReservation,
    otpConsumption,
    deletionRoute,
    deletionService,
    challengeEvidence,
    migration,
  ] = await Promise.all([
    readFile(
      new URL("../app/api/auth/request-otp/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/auth/verify-otp/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/auth/otp-request.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/auth/otp-challenge.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/platform/privacy/deletion-request/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../lib/auth/account-deletion.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/auth/challenge-evidence.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0018_loud_puck.sql", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(requestOtp, /runtimeIdentityProtection/);
  assert.match(verifyOtp, /identityContext/);
  assert.match(otpReservation, /prepareAuthOtpChallengeEvidence/);
  assert.match(otpReservation, /email_lookup_key_version/);
  assert.match(otpConsumption, /authOtpEmailMatches/);
  assert.match(otpConsumption, /authOtpCodeMatches/);
  assert.match(deletionRoute, /runtimeIdentityProtection/);
  assert.match(deletionService, /accountDeletionEmailMatches/);
  assert.match(deletionService, /accountDeletionCodeMatches/);
  assert.match(challengeEvidence, /identityEvidenceLookupPairs/);
  assert.match(challengeEvidence, /legacyNormalizedValue/);
  assert.match(migration, /auth_otp_challenge_evidence_insert_guard/);
  assert.match(
    migration,
    /account_deletion_challenge_evidence_insert_guard/,
  );
});

test("session management distinguishes the current local device and audits revocation", async () => {
  const [sessionStore, sessionRoute, singleRoute, settings] =
    await Promise.all([
      readFile(
        new URL("../lib/auth/session-management.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/api/platform/security/sessions/route.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/api/platform/security/sessions/[sessionId]/route.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/_platform/ProfileSettingsClient.tsx", import.meta.url),
        "utf8",
      ),
    ]);
  assert.match(sessionStore, /coalesce\(s\.idle_expires_at,s\.expires_at\)>\?/);
  assert.match(sessionStore, /TOUCH_INTERVAL_MS/);
  assert.match(sessionStore, /batchWithSecurityEvent/);
  assert.match(sessionStore, /auth_device_continuities/);
  assert.match(sessionRoute, /s\.user_id=\?/);
  assert.match(sessionRoute, /externalProviderSessionsIncluded: false/);
  assert.match(sessionRoute, /scope !== "all" && scope !== "others"/);
  assert.match(singleRoute, /userId: user\.id,\s*sessionId/s);
  assert.match(singleRoute, /assertSafeWrite\(request\)/);
  assert.match(sessionRoute, /clearDeviceContinuityCookie/);
  assert.match(singleRoute, /clearDeviceContinuityCookie/);
  assert.match(settings, /Локальные сессии JURO/);
  assert.match(settings, /Local JURO sessions/);
  assert.match(settings, /внешнего защищённого провайдера/);
  assert.match(settings, /2FA включена/);
  assert.match(settings, /резервн/);
});

test("MFA cookies and logout use narrow, server-only boundaries", async () => {
  const [session, logout, logoutResponse] = await Promise.all([
    readFile(new URL("../lib/auth/session.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/auth/logout-handler.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/auth/logout-response.ts", import.meta.url), "utf8"),
  ]);
  assert.match(
    session,
    /Path=\/api\/auth\/verify-mfa; HttpOnly; Secure; SameSite=Strict/,
  );
  assert.match(session, /clearMfaChallengeCookie/);
  assert.match(
    session,
    /DEVICE_CONTINUITY_COOKIE.*Path=\/; HttpOnly; Secure; SameSite=Lax/s,
  );
  assert.match(logout, /logoutResponseHeaders\(request\.url\)/);
  assert.match(logoutResponse, /clearSessionCookie/);
  assert.match(logoutResponse, /clearMfaChallengeCookie/);
  assert.match(logoutResponse, /headers\.append\("set-cookie"/);
});

test("email OTP defers primary-session issuance while MFA is active", async () => {
  const [verifyOtp, sessionManagement] = await Promise.all([
    readFile(
      new URL("../app/api/auth/verify-otp/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/auth/session-management.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(verifyOtp, /hasActiveMfa/);
  assert.match(verifyOtp, /createLoginMfaChallenge/);
  assert.match(verifyOtp, /requiresTwoFactor: true/);
  assert.match(verifyOtp, /createPrimarySessionIfMfaDisabled/);
  assert.match(
    sessionManagement,
    /NOT EXISTS \(\s*SELECT 1 FROM auth_totp_credentials/s,
  );
});

test("successful OTP and MFA routes record bounded request evidence", async () => {
  const [verifyOtp, verifyMfa, evidence] = await Promise.all([
    readFile(
      new URL("../app/api/auth/verify-otp/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/auth/verify-mfa/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/auth/request-security-evidence.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(verifyOtp, /prepareAuthRequestSecurityEvidence/);
  assert.match(verifyOtp, /authRequestSecurityContext\(request\)/);
  assert.match(verifyOtp, /optionalIdentityKeyring/);
  assert.match(verifyMfa, /securityContext: authRequestSecurityContext\(request\)/);
  assert.match(evidence, /identityLookupHmac/);
  assert.match(evidence, /MAX_IP_CHARACTERS = 64/);
  assert.match(evidence, /MAX_USER_AGENT_CHARACTERS = 512/);
  assert.match(evidence, /x-juro-client-ip/);
  assert.doesNotMatch(evidence, /IncomingRequestCf|cf-connecting-ip/);
  assert.match(evidence, /countryCode/);
  assert.match(evidence, /regionCode/);
  assert.doesNotMatch(evidence, /city|postalCode|latitude|longitude/);
});
test("MFA HTTP helpers fail closed and accept only a local session", async () => {
  const source = await readFile(
    new URL("../lib/auth/mfa-http.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /sessionTokenFromCookie/);
  assert.match(source, /LOCAL_SESSION_REQUIRED/);
  assert.ok(
    source.indexOf("sessionTokenFromCookie(cookie)")
      < source.indexOf("requireD1()"),
  );
  assert.match(source, /MfaConfigurationError/);
  assert.match(source, /IdentityKeyringError/);
  assert.match(source, /cache-control": "private, no-store"/);
});

test("MFA management routes require protected writes and local reauthentication", async () => {
  const routes = await Promise.all([
    "../app/api/platform/security/mfa/route.ts",
    "../app/api/platform/security/mfa/setup/route.ts",
    "../app/api/platform/security/mfa/confirm/route.ts",
    "../app/api/platform/security/mfa/backup-codes/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const route of routes) {
    assert.match(route, /localSessionForRequest/);
  }
  for (const route of routes) {
    if (!/export const (POST|DELETE)/.test(route)) continue;
    assert.match(route, /assertSafeWrite\(request\)/);
  }
  assert.match(routes[1], /recent: true/);
  assert.match(routes[2], /recent: true/);
  assert.match(routes[2], /confirmTotpEnrollmentInputSchema/);
  assert.match(routes[3], /manageMfaInputSchema/);
  assert.match(routes[0], /sessionTokenFromCookie/);
  assert.match(routes[0], /replacementSessionCookiesUntil/);
  assert.doesNotMatch(routes[0], /sharedAuthCookieDomain/);
  assert.match(routes[0], /currentToken/);
});

test("MFA factor claims bind replay fences to the exact operation and credential", async () => {
  const source = await readFile(
    new URL("../lib/auth/mfa-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /auth_mfa_factor_claims/);
  assert.match(source, /id=\? AND operation_id=\? AND credential_id=\?/);
  assert.match(source, /used_at IS NULL AND revoked_at IS NULL/);
  assert.match(source, /last_used_step IS NULL OR last_used_step<\?/);
  assert.match(source, /disabledByOperationGuard/);
  assert.match(source, /batchWithSecurityEvent/);
});

test("email change binds both address proofs to one fresh local session", async () => {
  const [route, service, profileUi] = await Promise.all([
    readFile(
      new URL(
        "../app/api/platform/security/email-change/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../lib/auth/email-change.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/_platform/ProfileSettingsClient.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /emailChangeInputSchema/);
  assert.match(route, /recentEmailChangeSession/);
  assert.match(route, /hasActiveMfa/);
  assert.match(route, /while \(newCode === currentCode\)/);
  assert.match(route, /response = await sendEmailRequest\(/);
  assert.match(route, /signal: AbortSignal\.timeout\(8_000\),\s*\}, true\)/);
  assert.match(route, /"idempotency-key"/);
  assert.match(route, /markEmailChangeCodesQueued/);
  assert.match(route, /sessionTokenFromCookie/);
  assert.match(route, /replacementSessionCookiesUntil/);
  assert.doesNotMatch(route, /sharedAuthCookieDomain/);
  assert.match(route, /currentToken,/);
  assert.ok(
    route.indexOf("localSessionForRequest(request)")
      < route.indexOf("invalidateEmailChangeChallenge(requireD1()"),
  );

  assert.match(service, /batchWithSecurityEvent/);
  assert.match(service, /account\.email_changed/);
  assert.match(service, /account_email_changed/);
  assert.match(service, /prepareSessionTokenRotation/);
  assert.match(service, /reason: "email_change"/);
  assert.match(service, /sessionTokenRotated: true/);
  for (const table of [
    "auth_sessions",
    "auth_otp_challenges",
    "account_deletion_challenges",
    "auth_mfa_challenges",
  ]) {
    assert.match(service, new RegExp(table));
  }

  assert.match(profileUi, /\/api\/platform\/security\/email-change/);
  assert.match(profileUi, /currentEmailCode/);
  assert.match(profileUi, /newEmailCode/);
  assert.match(profileUi, /Защищённая смена email/);
});

test("platform staff access is separate, local-MFA-only, and grants no customer-content capability", async () => {
  const [policy, httpBoundary] = await Promise.all([
    readFile(new URL("../lib/auth/staff-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/staff-http.ts", import.meta.url), "utf8"),
  ]);
  assert.match(
    policy,
    /"administrator",\s*"support",\s*"legal_reviewer"/,
  );
  assert.doesNotMatch(
    policy,
    /"owner"|"admin"|"lawyer"|"employee"/,
  );
  assert.match(policy, /s\.assurance_level='mfa'/);
  assert.match(policy, /auth_totp_credentials/);
  assert.match(policy, /a\.revoked_at IS NULL/);
  assert.match(policy, /a\.expires_at>\?/);
  assert.doesNotMatch(
    policy,
    /documents?\.|cases?\.|customer\.|workspace\.content/,
  );
  assert.match(httpBoundary, /localSessionForRequest/);
  assert.match(httpBoundary, /requirePlatformStaffAccess/);
  assert.match(httpBoundary, /mfaErrorResponse/);
  assert.match(httpBoundary, /PlatformStaffAccessError/);
  assert.match(httpBoundary, /status: 403/);
  assert.match(httpBoundary, /withPlatformStaffErrors/);
  assert.doesNotMatch(httpBoundary, /getChatGPTUser|getAuthPrincipal/);

  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  for await (const path of glob("app/api/platform/admin/**/route.ts", {
    cwd: projectRoot,
  })) {
    const route = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    if (!route.includes("requirePlatformStaffRequest")) continue;
    assert.match(
      route,
      /withPlatformStaffErrors/,
      `${path} must translate session, MFA, and capability failures into typed HTTP responses`,
    );
  }
});

test("staff role lifecycle is internal, fresh-MFA-gated, and atomically audited", async () => {
  const [management, events] = await Promise.all([
    readFile(
      new URL("../lib/auth/staff-role-management.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/auth/staff-role-events.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(management, /STAFF_ROLE_FRESH_MFA_MS = 5 \* 60/);
  assert.match(management, /MAX_STAFF_ROLE_TTL_MS = 30 \* 24/);
  assert.match(management, /requirePlatformStaffAccess/);
  assert.match(management, /"staff\.roles\.manage"/);
  assert.match(management, /auth_totp_credentials/);
  assert.match(management, /PLATFORM_STAFF_ROLE_SELF_GRANT_FORBIDDEN/);
  assert.match(management, /batchWithPlatformStaffRoleEvent/);
  assert.match(events, /juro-platform-staff-role-event-v1/);
  assert.match(events, /platform_staff_role_events/);
  assert.match(events, /"staff\.roles\.manage"/);
  assert.match(events, /MAX_CHAIN_RETRIES = 3/);
  assert.doesNotMatch(
    `${management}\n${events}`,
    /operator_bootstrap|getChatGPTUser|getAuthPrincipal|NextRequest|cookies\(/,
  );
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  for await (const path of glob(
    ["app/**/*.{ts,tsx}", "worker/**/*.ts"],
    { cwd: projectRoot },
  )) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /staff-role-management/,
      `${path} must not expose the internal staff role mutation service`,
    );
  }
});

test("canonical platform route classifier is stable", () => {
  assert.ok(isLocale("ru"));assert.ok(isLocale("uz"));assert.ok(isLocale("en"));assert.ok(!isLocale("de"));
  assert.ok(isAuthenticatedPlatformLocaleReady("ru"));
  assert.ok(isAuthenticatedPlatformLocaleReady("uz"));
  assert.ok(isAuthenticatedPlatformLocaleReady("en"));
  assert.ok(isAuthenticatedPlatformPathReady("/en/auth/login"));
  assert.ok(isAuthenticatedPlatformPathReady("/en/help"));
  assert.ok(isAuthenticatedPlatformPathReady("/en/individual/dashboard"));
  assert.ok(isAuthenticatedPlatformPathReady("/en/business/workspace-1/dashboard"));
  assert.ok(isAuthenticatedPlatformPathReady("/ru/individual/dashboard"));
  assert.ok(isAuthenticatedPlatformPathReady("/uz/lawyer/dashboard"));
  assert.ok(isAccountType("individual"));assert.ok(isAccountType("entrepreneur"));assert.ok(isAccountType("lawyer"));assert.ok(isAccountType("business"));assert.ok(!isAccountType("admin"));
  assert.ok(isPlatformModule("dashboard"));assert.ok(isPlatformModule("action-plan"));assert.ok(!isPlatformModule("main"));assert.ok(!isPlatformModule("document-builder-test"));
  assert.equal(platformPath("uz","business","document-builder"),"/uz/business/document-builder");
  assert.equal(platformPath("uz","business","dashboard","ws_business_1"),"/uz/business/ws_business_1/dashboard");
  assert.equal(platformBasePath("ru","business","ws_business_1"),"/ru/business/ws_business_1");
  assert.equal(platformPath("ru","lawyer","dashboard"),"/ru/lawyer/dashboard");
  assert.equal(platformPath("en","individual","dashboard"),"/en/individual/dashboard");
  assert.ok(isWorkspaceId("ws_business_1"));
  assert.ok(!isWorkspaceId("workspace/escape"));
  assert.throws(() => platformBasePath("ru", "business", "workspace/escape"), /INVALID_WORKSPACE_ID/);
  assert.equal(INTERNAL_REQUEST_PATH_HEADER, "x-juro-request-path");
  assert.equal(
    safeWorkspaceReturnPath(
      "/ru/individual/settings/security?section=mfa",
      "/ru/individual",
      "/ru/individual/dashboard",
    ),
    "/ru/individual/settings/security?section=mfa",
  );
  for (const unsafe of [
    "https://attacker.example/ru/individual/settings/security",
    "//attacker.example/ru/individual/settings/security",
    "/ru/admin/console",
    "/uz/individual/settings/security",
  ]) {
    assert.equal(
      safeWorkspaceReturnPath(unsafe, "/ru/individual", "/ru/individual/dashboard"),
      "/ru/individual/dashboard",
    );
  }
});

test("legacy builder routing preserves every supported profile persona", async () => {
  const source = await readFile(new URL("../app/document-builder/route-helpers.ts", import.meta.url), "utf8");
  assert.match(source, /isAccountType\(queryType\)/);
  assert.match(source, /isAccountType\(storedType\)/);
  assert.doesNotMatch(source, /queryType === "business"/);
});

test("workspace role permissions deny management and writes by default", () => {
  for (const role of ["owner", "admin", "lawyer", "employee", "viewer", "external"]) assert.ok(isWorkspaceRole(role));
  assert.ok(canManageTeam("owner"));
  assert.ok(canManageTeam("admin"));
  assert.ok(!canManageTeam("lawyer"));
  assert.ok(!canManageTeam("viewer"));
  assert.ok(canEditWorkspaceContent("employee"));
  assert.ok(!canEditWorkspaceContent("viewer"));
  assert.ok(!canEditWorkspaceContent("unexpected"));
});

test("pricing is centralized, bilingual and retains explicit non-fiction placeholders", () => {
  assert.equal(pricingConfig.currency, "UZS");
  assert.equal(pricingConfig.freeStart.priceMinor, 0);
  assert.deepEqual(pricingConfig.plans.map((plan) => plan.code), ["individual", "business", "legal_team"]);
  for (const plan of pricingConfig.plans) {
    assert.ok(plan.name.ru.length > 2);
    assert.ok(plan.name.uz.length > 2);
    assert.match(plan.priceLabel, /\{PRICE_/);
    assert.ok(plan.features.ru.length >= 3);
    assert.equal(plan.features.ru.length, plan.features.uz.length);
  }
});

test("application legal documents have matching complete RU and UZ keys", () => {
  const ruKeys = Object.keys(appLegalContent.ru).sort();
  const uzKeys = Object.keys(appLegalContent.uz).sort();
  assert.deepEqual(ruKeys, uzKeys);
  assert.deepEqual(ruKeys, ["ai-rules", "cookies", "personal-data", "privacy", "terms"]);
  for (const key of ruKeys) {
    const slug = key as keyof typeof appLegalContent.ru;
    for (const locale of ["ru", "uz"] as const) {
      const document = appLegalContent[locale][slug];
      assert.ok(document.title.length > 12);
      assert.ok(document.description.length > 30);
      assert.ok(document.sections.length >= 3);
      assert.ok(document.sections.every((section) => section.paragraphs.every((paragraph) => paragraph.length > 30)));
    }
  }
});

test("production migration creates a data snapshot before account and workflow changes", async () => {
  const sql=await readFile(new URL("../drizzle/0004_secure_sandstone.sql",import.meta.url),"utf8");
  const backup=sql.indexOf("CREATE TABLE `__backup_20260724_user_profiles`");
  const alter=sql.indexOf("ALTER TABLE `user_profiles` ADD `locale`");
  assert.ok(backup>=0&&alter>backup);
  for(const table of ["auth_otp_challenges","auth_sessions","cases","action_plans","action_plan_steps","consultation_slots","consultation_bookings"]) assert.ok(sql.includes("CREATE TABLE `" + table + "`"));
});

test("workspace and product migrations enforce tenant links, token hashes and analysis indexes", async () => {
  const migrations = await Promise.all([
    "0005_sticky_smiling_tiger.sql",
    "0006_lumpy_ravenous.sql",
    "0007_tranquil_zzzax.sql",
    "0008_noisy_tomorrow_man.sql",
  ].map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")));
  const sql = migrations.join("\n");
  for (const table of [
    "workspaces", "workspace_members", "workspace_invitations", "workspace_audit_events", "consents",
    "conversations", "conversation_messages", "confirmed_facts", "legal_sources", "subscriptions", "payments",
    "document_analyses", "document_risks", "account_deletion_requests",
  ]) assert.match(sql, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  for (const table of ["cases", "documents", "notifications", "consultation_bookings", "document_files"]) {
    assert.match(sql, new RegExp(`ALTER TABLE \\\`${table}\\\` ADD \\\`workspace_id\\\``));
  }
  assert.match(sql, /workspace_invitations_token_uidx/);
  assert.match(sql, /legal_sources_url_locale_uidx/);
  assert.match(sql, /document_analyses_file_uidx/);
  assert.doesNotMatch(sql, /otp[^;\n]*text[^;\n]*123456/i);
});

test("AI platform migration adds tenant-scoped run and usage evidence without destructive SQL", async () => {
  const sql = await readFile(new URL("../drizzle/0037_square_blacklash.sql", import.meta.url), "utf8");
  for (const table of ["ai_runs", "ai_usage_ledger"]) {
    assert.match(sql, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const index of [
    "ai_runs_idempotency_uidx", "ai_usage_ledger_run_uidx",
    "ai_usage_ledger_idempotency_uidx", "ai_usage_ledger_period_idx",
  ]) assert.match(sql, new RegExp(index));
  assert.doesNotMatch(sql, /^\s*(?:DROP\b|DELETE\s+FROM\b|TRUNCATE\b)/im);
});

test("comparison and monitoring migrations preserve immutable versions and verified-source publishing", async () => {
  const [comparisonSql, monitoringSql] = await Promise.all([
    readFile(new URL("../drizzle/0009_glossy_sunspot.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_jittery_micromax.sql", import.meta.url), "utf8"),
  ]);
  for (const table of ["document_comparisons", "comparison_changes"]) {
    assert.match(comparisonSql, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  }
  assert.match(comparisonSql, /ALTER TABLE `document_files` ADD `sha256`/);
  assert.match(comparisonSql, /ON DELETE restrict/);
  assert.match(comparisonSql, /document_comparisons_owner_idx/);
  assert.match(comparisonSql, /comparison_changes_type_idx/);
  for (const table of ["legislation_updates", "monitoring_preferences"]) {
    assert.match(monitoringSql, new RegExp(`CREATE TABLE \\\`${table}\\\``));
  }
  assert.match(monitoringSql, /legislation_updates_source_uidx/);
  assert.match(monitoringSql, /monitoring_preferences_user_workspace_uidx/);
  assert.doesNotMatch(monitoringSql, /INSERT INTO `legislation_updates`/);
});

test("workspace switching is membership-scoped and never reuses an invalid default tenant", async () => {
  const [workspaceLibrary, workspaceAccess, route] = await Promise.all([
    readFile(new URL("../lib/platform/workspace.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/workspace-route-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/workspaces/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /workspaceForUserById\(user\.id, body\.workspaceId/);
  assert.match(route, /source: "workspace_switcher"/);
  assert.doesNotMatch(route, /SET default_workspace_id=\?,account_type=\?/);
  assert.match(route, /isPersonalAccountType\(profile\.accountPersona\)/);
  assert.match(workspaceAccess, /m\.user_id=\? AND m\.status='active'/);
  assert.match(workspaceAccess, /UPDATE user_profiles SET default_workspace_id=\?,updated_at=\?/);
  assert.match(workspaceAccess, /workspace_selected/);
  assert.match(workspaceLibrary, /const workspaceId = `ws_\$\{crypto\.randomUUID\(\)/);
  assert.doesNotMatch(workspaceLibrary, /profile\.defaultWorkspaceId \?\? `ws_/);
  assert.match(workspaceLibrary, /m\.status='active'/);
});

test("global search is tenant-scoped, escapes LIKE input and avoids document-text leakage", async () => {
  const source = await readFile(new URL("../app/api/platform/search/route.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/_platform/GlobalSearch.tsx", import.meta.url), "utf8");
  assert.match(source, /workspace_id=\?/);
  assert.match(source, /owner_user_id=\?/);
  assert.ok(source.includes("ESCAPE '\\\\'"));
  assert.ok(source.includes('replaceAll("%", "\\\\%")'));
  assert.doesNotMatch(source, /final_content|auto_content|structured_json AS/);
  for (const table of ["tasks", "document_analyses", "lawyer_profiles"]) assert.match(source, new RegExp(table));
  assert.match(source, /SELECT 1 FROM sqlite_master WHERE type='table' AND name=\?/);
  assert.match(source, /tasksAvailable \? db\.prepare/);
  assert.match(source, /lawyersAvailable \? db\.prepare/);
  assert.match(source, /t\.workspace_id=\? AND t\.owner_user_id=\?/);
  assert.match(source, /a\.workspace_id=\? AND a\.owner_user_id=\?/);
  assert.match(source, /status='public_approved' AND public_approved_at IS NOT NULL/);
  assert.match(client, /triggerRef = useRef<HTMLButtonElement>/);
  assert.match(client, /triggerRef\.current\?\.focus\(\)/);
  assert.match(client, /wasOpenRef\.current = open/);
});

test("global search policy ranks exact, prefix, fuzzy, and semantic matches in that order", () => {
  assert.equal(globalSearchQueryMode(""), "recent");
  assert.equal(globalSearchQueryMode("я"), "incomplete");
  assert.equal(globalSearchQueryMode("!!"), "incomplete");
  assert.equal(globalSearchQueryMode("увольнение"), "search");
  assert.equal(globalSearchFuzzyNeedle("увольнение сотрудника"), "увол");

  const ranked = rankGlobalSearchRows([
    { id: "fuzzy", title: "Можно ли уволить сотрудника?", subtitle: "" },
    { id: "contains", title: "Порядок: увольнение сотрудника", subtitle: "" },
    { id: "prefix", title: "Увольнение сотрудника", subtitle: "" },
    { id: "exact", title: "Увольнение", subtitle: "" },
    { id: "unrelated", title: "Налоговый спор", subtitle: "" },
  ], "увольнение", 6);
  assert.deepEqual(ranked.map((row) => row.id), ["exact", "prefix", "contains", "fuzzy"]);
  assert.ok(ranked[3]!.searchScore > semanticGlobalSearchScore(1));
  assert.equal(globalSearchGroupScore(ranked), ranked[0]!.searchScore);
});

test("AI chat labels unmetered local allowances", async () => {
  const client = await readFile(new URL("../app/_platform/AiLawyerClient.tsx", import.meta.url), "utf8");
  assert.match(client, /usage\?\.limit === null/);
  assert.match(client, /безлимитно \(локально\)/);
});

test("verified legal retrieval includes official metadata in exact lexical matching", async () => {
  const source = await readFile(new URL("../lib/legal/verified-retrieval.ts", import.meta.url), "utf8");
  for (const field of ["source.act_title", "source.act_identifier", "section.canonical_ref", "section.article", "section.heading", "section.body_text"]) {
    assert.match(source, new RegExp(field.replaceAll(".", "\\.")));
  }
  assert.match(source, /\\p\{N\}\{1,10\}/);
  assert.match(source, /lexicalBindings/);
  assert.match(source, /legalSearchPatterns/);
  assert.doesNotMatch(source, /lower\(\$\{field\}\) LIKE/);
});

test("billing exposes only the gated Payment foundation and never treats credentials as payment success", async () => {
  const [provider, foundation, client, createRoute] = await Promise.all([
    readFile(new URL("../lib/billing/provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/billing/foundation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/BillingClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/checkout/create/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(provider, /credentialsConfigured/);
  assert.match(provider, /checkoutAvailable: false/);
  assert.match(foundation, /PAYMENT_PRODUCTION_APPROVED/);
  assert.match(foundation, /sandboxEnabled: false/);
  assert.match(client, /disabled=\{!data\.provider\.enabled/);
  assert.match(client, /api\/checkout\/create/);
  assert.match(createRoute, /paymentFoundationStatus/);
  assert.doesNotMatch(client, /data\.provider\.configured/);
  assert.doesNotMatch(client + createRoute, /providerPaymentId.*success|status:\s*["']paid["']/i);
});

test("legislation monitoring exposes only fresh official Lex metadata and does not use a local review corpus", async () => {
  const source = await readFile(new URL("../app/api/platform/monitoring/route.ts", import.meta.url), "utf8");
  assert.match(source, /legal_monitoring_metadata/);
  assert.match(source, /legal_monitoring_change_events/);
  assert.match(source, /http_status BETWEEN 200 AND 299/);
  assert.match(source, /summarizeLexMetadataMonitoringFreshness/);
  assert.match(source, /automaticPublication: true/);
  assert.match(source, /controlledBeta: false/);
  assert.doesNotMatch(source, /published_verified|verification_state|content_sha256|pending_review/);
});

test("monitoring keeps delivery disabled until a fresh Lex metadata run is available", async () => {
  const [shell, client] = await Promise.all([
    readFile(new URL("../app/_platform/PlatformShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/MonitoringClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /\[\s*"monitoring",\s*Scale,\s*"Мониторинг законодательства",\s*"Qonunchilik monitoringi",\s*"Legal monitoring",?\s*\]/);
  assert.match(shell, /key: "help", ru: "Помощь", uz: "Yordam", en: "Support"/);
  assert.match(client, /normalizeMonitoringAudience\(accountType\)/);
  assert.match(client, /normalizeMonitoringAudience\(body\.preference\.audience\)/);
  assert.match(client, /monitoringPreferencesAreInformationalOnly\(\{/);
  assert.match(client, /controlledBeta: status\.controlledBeta/);
  assert.match(client, /t\.preferenceOnlyNotice/);
  assert.match(client, /disabled=\{preferenceOnly \|\| !status\.emailConfigured\}/);
  assert.match(client, /preferenceOnly \? t\.savePreferences : t\.save/);
});

test("JURO motion tokens are bounded and the dashboard route is static", async () => {
  const [globals, dashboard] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/dashboard.css", import.meta.url), "utf8"),
  ]);
  for (const value of ["140ms", "220ms", "360ms", "680ms"]) assert.match(globals, new RegExp(value));
  assert.ok(globals.includes("cubic-bezier(.16,1,.3,1)"));
  assert.ok(globals.includes("cubic-bezier(.2,.8,.2,1)"));
  assert.match(globals, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(dashboard, /golden-route/);
  assert.doesNotMatch(dashboard, /stroke-dashoffset/);
  assert.doesNotMatch(dashboard, /golden-route[^}]*animation/);
  assert.doesNotMatch(dashboard, /infinite|parallax|perspective/);
});

test("new work surfaces keep mobile, zoom and keyboard accessibility safeguards", async () => {
  const [globals, shell, shellComponent, dashboard, comparison, monitoring, readability] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/platform-shell.css", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/PlatformShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/dashboard.css", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/document-comparison.css", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/monitoring.css", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/platform-readability.css", import.meta.url), "utf8"),
  ]);

  assert.match(globals, /:focus-visible/);
  assert.match(globals, /outline:3px solid/);
  assert.match(shell, /min-height:44px/);
  assert.match(shell, /max-width:800px/);
  assert.match(shell, /prefers-reduced-transparency:reduce/);
  assert.match(shellComponent, /\["ai-chat", Bot/);
  assert.match(shellComponent, /\["document-builder", FilePenLine/);
  assert.match(shellComponent, /\["document-review", FileCheck2/);
  assert.match(shellComponent, /\["cases", BriefcaseBusiness/);
  assert.match(shellComponent, /\["documents", Files/);
  assert.match(shellComponent, /const toolGroups = lawyer\s*\?\s*\(\[/);
  assert.match(shellComponent, /"Все инструменты"/);
  assert.match(shellComponent, /href=\{`\$\{base\}\/profile`\}/);
  assert.match(shellComponent, /useSearchParams/);
  assert.match(shellComponent, /const nextParams = new URLSearchParams\(searchParams\.toString\(\)\)/);
  assert.match(shellComponent, /nextParams\.delete\("prompt"\)/);
  assert.doesNotMatch(shellComponent, /nextParams\.delete\("intake"\)/);
  assert.match(shellComponent, /router\.push\(query \? `\$\{nextPath\}\?\$\{query\}` : nextPath\)/);
  assert.match(shellComponent, /window\.matchMedia\("\(max-width: 900px\)"\)/);
  assert.match(shell, /min-width:801px\) and \(max-width:900px/);
  assert.match(shellComponent, /aria-hidden=\{mobile && !open \? true : undefined\}/);
  assert.match(shellComponent, /inert=\{mobile && !open \? true : undefined\}/);
  assert.match(shellComponent, /window\.requestAnimationFrame\(\(\) => openButtonRef\.current\?\.focus\(\)\)/);
  assert.match(shell, /platform-brand button\{width:44px;height:44px/);
  assert.match(shell, /platform-sidebar nav a\{min-height:44px\}/);
  assert.match(shell, /platform-account select\{width:100%;min-height:44px/);
  const aiClient = await readFile(new URL("../app/_platform/AiLawyerClient.tsx", import.meta.url), "utf8");
  assert.match(aiClient, /href=\{aiLocation\(new URLSearchParams\(\{ conversationId: item\.id \}\)\)\}/);
  assert.match(aiClient, /router\.replace\(aiLocation\(nextParams, !intakeFinalized\), \{ scroll: false \}\)/);
  assert.doesNotMatch(shellComponent, /MoreHorizontal/);
  assert.match(dashboard, /max-width:\s*820px/);
  assert.match(dashboard, /max-width:\s*460px/);
  assert.match(dashboard, /\.dashboard-command-form textarea\s*\{[\s\S]*?min-height:\s*96px;[\s\S]*?grid-column:\s*1\/-1;[\s\S]*?grid-row:\s*1;[\s\S]*?resize:\s*none;/);
  assert.match(dashboard, /\.dashboard-voice-action\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2;/);
  assert.match(dashboard, /\.dashboard-start\s*\{[\s\S]*?grid-column:\s*3;[\s\S]*?grid-row:\s*2;/);
  assert.match(dashboard, /\.dashboard-attach\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;/);
  assert.match(comparison, /max-width:820px/);
  assert.match(comparison, /max-width:560px/);
  assert.match(comparison, /prefers-reduced-motion:reduce/);
  assert.match(monitoring, /max-width:700px/);
  assert.match(readability, /font-size:14px/);
  assert.match(readability, /min-height:44px/);
  for (const source of [dashboard, comparison, monitoring]) {
    assert.doesNotMatch(source, /width:100vw/);
    assert.doesNotMatch(source, /cursor-trail|particle|3d-tilt|animation:[^;}]*infinite/i);
  }
});

test("Jurobek is a static optimized image without animation handlers or 3D dependencies", async () => {
  const [component, styles, packageSource] = await Promise.all([
    readFile(new URL("../app/onboarding/OnboardingForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/onboarding/onboarding.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(component, /next\/image/);
  assert.match(component, /jurobek-avatar\.webp/);
  assert.doesNotMatch(component, /onPointerMove|onMouseMove|requestAnimationFrame|useFrame|Canvas/);
  assert.doesNotMatch(styles, /@keyframes[^}]*jurobek|animation[^;]*jurobek/i);
  assert.doesNotMatch(packageSource, /three|react-three|lottie|framer-motion/);
});

test("case-detail routes remain tenant-scoped and do not render the workspace-wide plan", async () => {
  const [api, client, personalPage, businessPage] = await Promise.all([
    readFile(new URL("../app/api/platform/cases/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/CaseWorkspaceClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/[accountType]/cases/[caseId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/business/[workspaceId]/cases/[caseId]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(api, /new URL\(request\.url\)\.searchParams\.get\("caseId"\)/);
  assert.match(api, /WHERE c\.workspace_id=\?\$\{caseScope\}/);
  assert.match(api, /bind\(workspace\.id,caseId\)/);
  assert.match(client, /api\/platform\/cases\?caseId=\$\{encodeURIComponent\(caseId\)\}/);
  assert.match(client, /api\/platform\/cases\/\$\{encodeURIComponent\(caseId\)\}\/tasks/);
  assert.match(personalPage, /CaseWorkspaceClient locale=\{locale\} caseId=\{caseId\}/);
  assert.match(businessPage, /CaseWorkspaceClient locale=\{locale\} caseId=\{caseId\}/);
});

test("lawyer handoff keeps conflict review anonymized and access explicitly consented", async () => {
  const caseId = "11111111-1111-4111-8111-111111111111";
  const lawyerProfileId = "22222222-2222-4222-8222-222222222222";
  assert.equal(lawyerRequestSchema.safeParse({
    caseId,
    lawyerProfileId,
    anonymizedSummary: "Нужна проверка договорного спора без раскрытия персональных данных.",
    serviceCode: "document_review",
    preferredFormat: "video",
    proposedStartsAt: "2026-08-24T10:00:00+05:00",
    consent: true,
    locale: "ru",
  }).success, true);
  assert.equal(lawyerRequestSchema.safeParse({ caseId, anonymizedSummary: "слишком коротко", consent: true, locale: "ru" }).success, false);
  assert.equal(lawyerRequestSchema.safeParse({ caseId, anonymizedSummary: "Достаточно длинное нейтральное описание ситуации для проверки конфликта.", consent: false, locale: "ru" }).success, false);
  assert.equal(lawyerRequestSchema.safeParse({ caseId, anonymizedSummary: "Достаточно длинное нейтральное описание ситуации для проверки конфликта.", serviceCode: "invented", consent: true, locale: "ru" }).success, false);
  assert.equal(conflictCheckDecisionSchema.safeParse({ decision: "clear", locale: "uz" }).success, true);
  assert.equal(conflictCheckDecisionSchema.safeParse({ decision: "approve", locale: "uz" }).success, false);
  assert.equal(lawyerAccessGrantSchema.safeParse({ consent: true, locale: "ru" }).success, true);
  assert.equal(lawyerAccessGrantSchema.safeParse({ consent: false, locale: "ru" }).success, false);

  const [requestRoute, conflictRoute, grantRoute] = await Promise.all([
    readFile(new URL("../app/api/platform/lawyer-requests/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/conflict-check/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/access-grant/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(requestRoute, /workspaceEntitlements\(db, workspace\.id\)/);
  assert.match(requestRoute, /WHERE id=\? AND workspace_id=\? AND archived_at IS NULL/);
  assert.match(requestRoute, /anonymized_summary/);
  assert.match(requestRoute, /serviceCode: parsed\.data\.serviceCode/);
  assert.match(requestRoute, /json_extract\(r\.requested_scope_json,'\$\.preferredFormat'\)/);
  assert.match(conflictRoute, /anonymized summary/);
  assert.match(conflictRoute, /p\.user_id=\? AND p\.status='public_approved'/);
  assert.match(grantRoute, /c\.status='clear'/);
  assert.match(grantRoute, /requester_user_id=\?/);
  assert.match(grantRoute, /lawyer_case_access_granted/);
  assert.match(grantRoute, /lawyer_case_access_revoked/);
});

test("notification reads use strict bounded input and expose resilient UI states", async () => {
  const [route, client] = await Promise.all([
    readFile(new URL("../app/api/document-builder/notifications/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_document-builder/notifications/NotificationsClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /notificationReadSchema/);
  assert.match(route, /z\.string\(\)\.uuid\(\)/);
  assert.match(route, /parseJsonRequest\(request, notificationReadSchema, 1_024\)/);
  assert.match(route, /Boolean\(value\.id\) !== Boolean\(value\.all\)/);
  assert.match(client, /aria-busy=\{loading \|\| marking !== null\}/);
  assert.match(client, /aria-live="polite"/);
  assert.match(client, /disabled=\{loading \|\| marking !== null\}/);
  assert.match(client, /Не удалось загрузить уведомления/);
});

test("document upload progress is byte-based and remains accessible", async () => {
  const [upload, client, reviewCopy] = await Promise.all([
    readFile(new URL("../lib/document-analysis/client-upload.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/DocumentReviewClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/document-review-localization.ts", import.meta.url), "utf8"),
  ]);
  assert.match(upload, /type SecureDocumentUploadProgress/);
  assert.match(upload, /new XMLHttpRequest\(\)/);
  assert.match(upload, /request\.upload\.addEventListener\("progress"/);
  assert.match(upload, /event\.lengthComputable/);
  assert.match(upload, /onProgress\?\.\(\{ phase: "finalizing"/);
  assert.match(client, /role="progressbar"/);
  assert.match(client, /aria-valuetext=\{uploadStatus\}/);
  assert.match(reviewCopy, /Передаём файл/);
  assert.match(reviewCopy, /Fayl yuborilmoqda/);
  assert.match(reviewCopy, /Uploading file/);
});

test("workspace content mutations require an editor role at the route boundary", async () => {
  const routes = await Promise.all([
    "../app/api/platform/cases/route.ts",
    "../app/api/platform/cases/[caseId]/route.ts",
    "../app/api/platform/cases/[caseId]/tasks/route.ts",
    "../app/api/platform/cases/[caseId]/plan/route.ts",
    "../app/api/platform/cases/[caseId]/steps/[stepId]/route.ts",
    "../app/api/platform/document-analysis/uploads/route.ts",
    "../app/api/platform/document-analysis/uploads/[analysisId]/route.ts",
    "../app/api/platform/document-analysis/uploads/[analysisId]/finalize/route.ts",
    "../app/api/platform/document-comparisons/route.ts",
    "../app/api/platform/document-comparisons/[comparisonId]/route.ts",
    "../app/api/platform/document-comparisons/[comparisonId]/process/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const route of routes) assert.match(route, /workspaceForContentEditor\(user\)/);
  const workspace = await readFile(new URL("../lib/platform/workspace.ts", import.meta.url), "utf8");
  const permissions = await readFile(new URL("../lib/platform/permissions.ts", import.meta.url), "utf8");
  assert.match(workspace, /requireWorkspaceContentEditor\(workspace\.role\)/);
  assert.match(permissions, /if \(!canEditWorkspaceContent\(role\)\)/);
});

test("optional email preferences are strict, consent-backed, audited, and localized", async () => {
  assert.deepEqual(optionalEmailPreferenceKeys, ["marketing_email", "weekly_case_summary", "unfinished_document", "comments", "lawyer_request_updates"]);
  assert.equal(notificationPreferencesSchema.safeParse({ preferences: { marketing_email: true, weekly_case_summary: false, unfinished_document: true, comments: false, lawyer_request_updates: true } }).success, true);
  assert.equal(notificationPreferencesSchema.safeParse({ preferences: { marketing_email: true } }).success, false);
  assert.equal(notificationPreferencesSchema.safeParse({ preferences: { marketing_email: true, weekly_case_summary: false, unfinished_document: false, comments: false, lawyer_request_updates: false, otp: true } }).success, false);

  const [route, client] = await Promise.all([
    readFile(new URL("../app/api/platform/notification-preferences/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/NotificationPreferencesPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /workspaceForUser\(user\)/);
  assert.match(route, /workspace_audit_events/);
  assert.match(route, /revoked_at/);
  assert.match(route, /ORDER BY granted_at DESC, rowid DESC/);
  assert.match(route, /cache-control": "private, no-store/);
  assert.match(client, /x-juro-csrf/);
  assert.match(client, /role="alert"/);
  assert.match(client, /Email-уведомления/);
  assert.match(client, /Email bildirishnomalari/);
  assert.match(client, /Коды входа/);
});

test("active sessions expose only privacy-safe approximate region evidence", async () => {
  const [route, client] = await Promise.all([
    readFile(new URL("../app/api/platform/security/sessions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/ProfileSettingsClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /continuity\.last_country_code AS countryCode/);
  assert.match(route, /continuity\.last_region_code AS regionCode/);
  assert.match(route, /LEFT JOIN auth_device_continuities continuity/);
  assert.doesNotMatch(route, /raw_ip|user_agent/i);
  assert.match(client, /countryCode: string \| null/);
  assert.match(client, /Примерный регион/);
});

test("notification reads and read acknowledgements remain workspace-scoped", async () => {
  const [notificationRoute, dashboardRoute] = await Promise.all([
    readFile(new URL("../app/api/document-builder/notifications/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/dashboard/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(notificationRoute, /workspaceForUser\(user\)/);
  assert.match(notificationRoute, /WHERE user_id = \? AND workspace_id = \?/);
  assert.match(notificationRoute, /id = \? AND user_id = \? AND workspace_id = \?/);
  assert.match(dashboardRoute, /notifications WHERE user_id = \? AND workspace_id = \? AND read_at IS NULL/);
  assert.match(dashboardRoute, /WHERE user_id=\? AND workspace_id=\? ORDER BY created_at DESC LIMIT 4/);
  assert.doesNotMatch(notificationRoute, /WHERE user_id = \? ORDER BY created_at DESC/);
});
test("handoff UI requires a fresh owner consent before grant and exposes revoke", async () => {
  const client = await readFile(new URL("../app/_platform/LawyerHandoffClient.tsx", import.meta.url), "utf8");
  assert.match(client, /accessConsents/);
  assert.match(client, /action === "grant" && !accessConsents\[item\.id\]/);
  assert.match(client, /access-grant/);
  assert.match(client, /method: action === "grant" \? "POST" : "DELETE"/);
  assert.match(client, /Подтверждаю передачу выбранному юристу материалов этого дела/);
  assert.match(client, /Отозвать доступ/);
});
test("lawyer consultation surface uses assigned requests and the guarded conflict check", async () => {
  const [moduleContent, client] = await Promise.all([
    readFile(new URL("../app/_platform/ModuleContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerRequestsClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(moduleContent, /accountType === "lawyer" && module === "consultations"/);
  assert.match(moduleContent, /<LawyerHubClient locale=\{locale\}/);
  assert.match(client, /lawyer-requests\/assigned/);
  assert.match(client, /conflict-check/);
  assert.match(client, /decision, locale/);
  assert.match(client, /Материалы дела недоступны, пока владелец не предоставит доступ/);
});
test("assigned lawyer view reveals case metadata only for an active grant", async () => {
  const route = await readFile(new URL("../app/api/platform/lawyer-requests/assigned/route.ts", import.meta.url), "utf8");
  assert.match(route, /p\.user_id=\? AND p\.status='public_approved'/);
  assert.match(route, /g\.revoked_at IS NULL/);
  assert.match(route, /g\.expires_at IS NULL OR g\.expires_at>\?/);
  assert.match(route, /CASE WHEN g\.id IS NOT NULL THEN cs\.description END/);
});
test("support tickets are tenant-scoped, validated, and audited", async () => {
  const support = await readFile(new URL("../app/api/platform/support-tickets/route.ts", import.meta.url), "utf8");
  const input = await readFile(new URL("../lib/platform/support.ts", import.meta.url), "utf8");
  assert.match(input, /supportTicketSchema/);
  assert.match(input, /technical.*ai_error.*wrong_norm/s);
  assert.match(support, /WHERE workspace_id=\? AND requester_user_id=\?/);
  assert.match(support, /assertSafeWrite\(request\)/);
  assert.match(support, /support_ticket_created/);
  assert.match(support, /INSERT INTO support_messages/);
  const [detail, staffQueue, staffReply] = await Promise.all([
    readFile(new URL("../app/api/platform/support-tickets/[ticketId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/admin/support-tickets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/admin/support-tickets/[ticketId]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(detail, /id=\? AND workspace_id=\? AND requester_user_id=\?/);
  assert.match(detail, /FROM support_messages WHERE ticket_id=\?/);
  assert.match(detail, /supportTicketReplySchema/);
  assert.match(detail, /TICKET_RESOLVED/);
  assert.match(detail, /support_ticket_replied/);
  assert.match(detail, /status='open',updated_at=\?,closed_at=NULL/);
  assert.match(staffQueue, /freshMfaWithinMs: 15 \* 60 \* 1000/);
  assert.match(staffReply, /support_ticket_replied/);
});
test("direct legal-source health route is staff-gated, bounded, and no-store", async () => {
  const route = await readFile(new URL("../app/api/platform/legal-sources/health/route.ts", import.meta.url), "utf8");
  assert.match(route, /LEGAL_DIRECT_RETRIEVAL_ENABLED !== "true"/);
  assert.doesNotMatch(route, /LEGAL_SOURCE_STAFF_API_ENABLED/);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /staff\.operations\.manage/);
  assert.match(route, /freshMfaWithinMs: 15 \* 60 \* 1_000/);
  assert.match(route, /cache-control": "private, no-store/);
  assert.match(route, /runDirectLegalSourceHealthCheck/);
  assert.match(route, /readDirectLegalSourceHealth/);
  assert.match(route, /ACCESS_DENIED/);
  const page = await readFile(new URL("../app/[locale]/admin/legal-sources/page.tsx", import.meta.url), "utf8");
  assert.match(page, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.match(page, /DirectLegalSourceHealthPanel/);
});
test("action-plan history snapshots are tenant-scoped and immutable", async () => {
  const [createRoute, updateRoute, historyRoute, client, migration] = await Promise.all([
    readFile(new URL("../app/api/platform/cases/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/cases/[caseId]/steps/[stepId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/cases/[caseId]/plan-versions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/ActionPlanClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0051_noisy_nuke.sql", import.meta.url), "utf8"),
  ]);
  assert.match(createRoute, /INSERT INTO action_plan_versions/);
  assert.match(createRoute, /plan_created/);
  assert.match(updateRoute, /await db.batch/);
  assert.match(updateRoute, /INSERT INTO action_plan_versions/);
  assert.match(updateRoute, /NOT NULL constraint failed/);
  assert.match(updateRoute, /planVersion: version/);
  assert.match(updateRoute, /WHERE id=\? AND revision=\?/);
  assert.match(historyRoute, /c\.workspace_id=\?/);
  assert.match(historyRoute, /WHERE plan_id=\? ORDER BY version DESC/);
  assert.match(client, /loadVersionHistory/);
  assert.match(client, /plan-history/);
  assert.match(migration, /action_plan_versions_plan_version_uidx/);
  assert.match(migration, /action_plan_versions_no_update/);
  assert.match(migration, /action_plan_versions_no_delete/);
});

test("confirmed action-plan changes are validated, scoped, and saved as one version", async () => {
  const [schema, route, client] = await Promise.all([
    readFile(new URL("../lib/platform/action-plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/cases/[caseId]/plan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/ActionPlanClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /confirmedActionPlanPatchSchema/);
  assert.match(schema, /A step may be changed only once/);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /workspaceForContentEditor\(user\)/);
  assert.match(route, /plan_changes_confirmed/);
  assert.match(route, /current_revision=current_revision\+1/);
  assert.match(route, /INSERT INTO action_plan_versions/);
  assert.match(client, /Предпросмотр версии/);
  assert.match(client, /Подтвердить и применить/);
  assert.match(client, /Различия: версия/);
  assert.match(client, /selectedHistoryVersionByCase/);
  assert.match(client, /\/api\/platform\/cases\/\$\{item\.id\}\/plan/);
});

test("action-plan task confirmation is tenant-scoped and idempotent per plan revision", async () => {
  const route = await readFile(new URL("../app/api/platform/cases/[caseId]/tasks/route.ts", import.meta.url), "utf8");
  assert.match(route, /WHERE id=\? AND workspace_id=\? AND archived_at IS NULL/);
  assert.match(route, /p\.id AS planId,p\.current_revision AS planRevision/);
  assert.match(route, /INSERT OR IGNORE INTO tasks/);
  assert.match(route, /INSERT OR IGNORE INTO case_events/);
  assert.match(route, /action-plan-tasks:\$\{caseId\}:\$\{plan\.planId\}:\$\{plan\.planRevision\}/);
  assert.match(route, /planRevision: plan\.planRevision/);
});

test("action-plan steps and confirmed tasks share a bounded server-side status vocabulary", async () => {
  assert.equal(taskStatusForPlanStep("not_started"), "planned");
  assert.equal(taskStatusForPlanStep("waiting_user"), "waiting_information");
  assert.equal(taskStatusForPlanStep("waiting_response"), "waiting_counterparty");
  assert.equal(taskStatusForPlanStep("completed"), "completed");
  assert.equal(taskStatusIsTerminal("completed"), true);
  assert.equal(taskStatusIsTerminal("in_progress"), false);
  const [createTasks, updateStep] = await Promise.all([
    readFile(new URL("../app/api/platform/cases/[caseId]/tasks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/cases/[caseId]/steps/[stepId]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(createTasks, /taskStatusForPlanStep\(step\.status\)/);
  assert.match(createTasks, /taskStatusIsTerminal\(taskStatus\)/);
  assert.match(updateStep, /UPDATE tasks SET status=\?,due_at=\?,completed_at=\?,updated_at=\?/);
  assert.match(updateStep, /UPDATE task_reminders SET status='cancelled'/);
  assert.match(updateStep, /SELECT \?,id,'in_app',\?,'pending'/);
  assert.match(updateStep, /SELECT \?,id,'email',\?,'pending'/);
});

test("case workspace documents and activity are tenant-scoped", async () => {
  const [route, client] = await Promise.all([
    readFile(new URL("../app/api/platform/cases/[caseId]/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/CaseWorkspaceClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireApiUser\(\)/);
  assert.match(route, /workspaceForUser\(user\)/);
  assert.match(route, /workspace_id=\?/);
  assert.match(route, /case_id=\?/);
  assert.match(route, /cache-control": "private, no-store/);
  assert.match(client, /\/workspace/);
  assert.match(client, /Документы дела/);
  assert.match(client, /Активность дела/);
});
test("calendar reads only active-workspace plan deadlines and keeps its date window bounded", async () => {
  const [route, client, routing] = await Promise.all([
    readFile(new URL("../app/api/platform/calendar/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/CalendarClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/routing.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /workspaceForUser\(user\)/);
  assert.match(route, /c\.workspace_id=\?/);
  assert.match(route, /s\.due_at>=\? AND s\.due_at<\?/);
  assert.match(route, /t\.workspace_id=c\.workspace_id/);
  assert.match(route, /cache-control": "private, no-store/);
  assert.match(route, /calendarRangeFromSearch/);
  assert.match(client, /"month", "week", "day", "list", "cases", "overdue"/);
  assert.match(client, /previousMonthStart/);
  assert.match(client, /calendar-more/);
  assert.match(client, /api\/platform\/calendar/);
  assert.match(client, /action-plan\//);
  assert.match(routing, /"calendar"/);
});
test("case detail is a tenant-backed workspace rather than a plan-only alias", async () => {
  const [personalRoute, businessRoute, client] = await Promise.all([
    readFile(new URL("../app/[locale]/[accountType]/cases/[caseId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/business/[workspaceId]/cases/[caseId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/CaseWorkspaceClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(personalRoute, /CaseWorkspaceClient/);
  assert.match(businessRoute, /CaseWorkspaceClient/);
  assert.match(client, /api\/platform\/cases\?caseId=/);
  assert.match(client, /\/tasks/);
  assert.match(client, /action-plan/);
  assert.match(client, /calendar/);
  assert.doesNotMatch(personalRoute, /ActionPlanClient/);
});
test("staff support inbox requires capability, fresh MFA, and private ticket detail", async () => {
  const [page, route, detail, client] = await Promise.all([
    readFile(new URL("../app/[locale]/admin/support/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/admin/support-tickets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/admin/support-tickets/[ticketId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_staff/SupportInbox.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /support\.tickets\.manage/); assert.match(page, /freshMfaWithinMs:15\*60\*1_000/);
  assert.match(route, /support\.tickets\.manage/); assert.match(detail, /export const GET = withPlatformStaffErrors/); assert.match(detail, /support\.tickets\.manage/); assert.match(detail, /ORDER BY created_at ASC,id ASC LIMIT 200/); assert.match(detail, /support_ticket_viewed/); assert.match(detail, /private, no-store/);
  assert.match(client, /admin\/support-tickets/); assert.match(client, /x-juro-csrf/); assert.match(client, /waiting_user/); assert.match(client, /aria-live="polite"/); assert.match(client, /t\[ticket\.status\]/); assert.match(client, /t\.requester/);
});
test("user support form exposes only validated categories, localized status, and tenant ticket history", async () => {
  const [client, support] = await Promise.all([
    readFile(new URL("../app/_platform/HelpClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/support.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /supportCategories/); assert.match(client, /supportSeverities/); assert.match(client, /category, severity, subject, message, locale/);
  assert.match(client, /window\.setTimeout\(\(\) => void loadTickets\(\), 0\)/); assert.match(client, /support\[ticket\.status\]/); assert.match(client, /aria-live="polite"/);
  assert.match(support, /wrong_norm.*document.*ocr.*tariff.*lawyer.*privacy.*security.*deletion.*workspace.*feedback/s);
});
test("support analytics records only allowlisted aggregate metadata", async () => {
  const [route, analytics] = await Promise.all([
    readFile(new URL("../app/api/platform/support-tickets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/analytics.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /trackSupportTicketCreated/); assert.match(analytics, /user_support_ticket_created/); assert.match(analytics, /supportCategories\.has/); assert.match(analytics, /supportSeverities\.has/);
  assert.doesNotMatch(analytics, /userId|workspaceId|subject|message|request\.url/i);
});
test("lawyer offers are validated, access-bound, auditable, and owner-resolved", async () => {
  assert.equal(lawyerOfferCreateSchema.safeParse({
    scopeDescription: "Проверить договор, подготовить замечания и согласовать безопасную редакцию.",
    priceDescription: "По согласованию вне платформы",
    durationDescription: "До трёх рабочих дней",
    locale: "ru",
  }).success, true);
  assert.equal(lawyerOfferCreateSchema.safeParse({ scopeDescription: "short", priceDescription: "x", durationDescription: "x", locale: "ru" }).success, false);
  assert.equal(lawyerOfferResponseSchema.safeParse({ decision: "accepted", locale: "uz" }).success, true);
  assert.equal(lawyerOfferResponseSchema.safeParse({ decision: "other", locale: "uz" }).success, false);

  const [route, ownerRoute, assignedRoute, lawyerClient, ownerClient, migration] = await Promise.all([
    readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/offer/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/lawyer-requests/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/lawyer-requests/assigned/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerRequestsClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerHandoffClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0052_narrow_christian_walker.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /p\.user_id=\? AND p\.status='public_approved'/);
  assert.match(route, /g\.revoked_at IS NULL/);
  assert.match(route, /r\.workspace_id=\? AND r\.requester_user_id=\?/);
  assert.match(route, /lawyer_offer_proposed/);
  assert.match(route, /lawyer_offer_accepted/);
  assert.match(route, /lawyer_offer_declined/);
  assert.match(route, /WHERE id=\? AND status='proposed'/);
  assert.match(ownerRoute, /lawyer_offers o WHERE o\.lawyer_request_id=r\.id/);
  assert.match(assignedRoute, /CASE WHEN g\.id IS NOT NULL THEN \(SELECT o\.id/);
  assert.match(lawyerClient, /lawyer-requests\/\$\{encodeURIComponent\(item\.id\)\}\/offer/);
  assert.match(ownerClient, /respondToOffer/);
  assert.match(ownerClient, /Оплата в платформе пока не выполняется/);
  assert.match(migration, /CREATE TABLE `lawyer_offers`/);
  assert.match(migration, /lawyer_offers_request_version_uidx/);
});
test("lawyer request messages require active participant access and are workspace-audited", async () => {
  assert.equal(lawyerRequestMessageSchema.safeParse({ body: "Подтверждаю, что ознакомился с документами дела.", locale: "ru" }).success, true);
  assert.equal(lawyerRequestMessageSchema.safeParse({ body: "", locale: "ru" }).success, false);
  const [route, client, migration] = await Promise.all([
    readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/messages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerRequestMessages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0053_dashing_eddie_brock.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requester_user_id=\?/);
  assert.match(route, /p\.id=r\.lawyer_profile_id AND p\.user_id=\?/);
  assert.match(route, /p\.status='public_approved'/);
  assert.match(route, /p\.marketplace_status='public_approved'/);
  assert.match(route, /g\.revoked_at IS NULL/);
  assert.match(route, /lawyer_request_message_sent/);
  assert.match(route, /ORDER BY m\.created_at ASC,m\.id ASC LIMIT 200/);
  assert.match(client, /x-juro-csrf/);
  assert.match(migration, /CREATE TABLE `lawyer_request_messages`/);
});
test("lawyer phone contact is explicit, active-grant scoped and audited without the phone", async () => {
  const [route, service, client, ownerClient, lawyerClient] = await Promise.all([
    readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/phone/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/lawyer-phone-contact.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerPhoneContact.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerHandoffClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerRequestsClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /runtimeIdentityProtection\(\)/);
  assert.match(service, /g\.revoked_at IS NULL/);
  assert.match(service, /g\.expires_at IS NULL OR g\.expires_at>\?/);
  assert.match(service, /g\.lawyer_user_id=p\.user_id/);
  assert.match(service, /owner_consent\.type='lawyer_case_access'/);
  assert.match(service, /lawyer_consent\.type='lawyer_phone_contact_sharing'/);
  assert.match(service, /lawyer_phone_contact_revealed/);
  assert.doesNotMatch(service, /metadata_json[^\n]+phone/iu);
  assert.match(client, /method: "POST"/);
  assert.match(client, /x-juro-csrf/);
  assert.match(client, /href=\{phone\.href\}/);
  assert.match(client, /JURO не записывает обычный телефонный звонок/);
  assert.match(ownerClient, /<LawyerPhoneContact/);
  assert.match(lawyerClient, /<LawyerPhoneContact/);
  assert.match(lawyerClient, /согласен на контакт/);
  assert.match(ownerClient, /взаимное раскрытие наших номеров телефона/);
  const grantRoute = await readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/access-grant/route.ts", import.meta.url), "utf8");
  assert.match(grantRoute, /'lawyer_case_access','2026-08-06'/);
  assert.match(grantRoute, /reciprocalPhoneDisclosure: true/);
  const conflictRoute = await readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/conflict-check/route.ts", import.meta.url), "utf8");
  assert.match(conflictRoute, /lawyer_phone_contact_sharing','2026-08-06'/);
  assert.match(conflictRoute, /reciprocalPhoneDisclosure: true/);
});
test("completed lawyer services gate private owner reviews and moderation", async () => {
  assert.equal(lawyerReviewSchema.safeParse({ overallRating: 5, speedRating: 4, qualityRating: 5, communicationRating: 5, locale: "ru" }).success, true);
  assert.equal(lawyerReviewSchema.safeParse({ overallRating: 6, speedRating: 4, qualityRating: 5, communicationRating: 5, locale: "ru" }).success, false);
  assert.equal(lawyerReviewModerationSchema.safeParse({ decision: "approved", reason: "Проверен текст без персональных данных.", locale: "ru" }).success, true);
  assert.equal(lawyerReviewModerationSchema.safeParse({ decision: "other", reason: "x", locale: "ru" }).success, false);
  assert.equal(hasLikelyPersonalData("Связь: +998 90 123 45 67"), true);
  assert.equal(hasLikelyPersonalData("Нейтральный отзыв без контактов"), false);
  const [completion, review, lawyerClient, ownerClient, migration, directoryRoute] = await Promise.all([
    readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/completion/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/lawyer-requests/[requestId]/review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerRequestsClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/LawyerReviewForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0054_same_spencer_smythe.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/lawyers/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(completion, /r\.status='offer_accepted'/); assert.match(completion, /g\.revoked_at IS NULL/); assert.match(completion, /lawyer_request_completed/);
  assert.match(review, /workspace_id=\? AND requester_user_id=\? AND status='completed'/); assert.match(review, /lawyer_review_submitted/); assert.match(review, /'pending'/);
  assert.match(review, /SELECT id,status FROM lawyer_reviews WHERE lawyer_request_id=\? AND workspace_id=\? AND requester_user_id=\?/);
  assert.match(review, /replayed:\s*true/);
  assert.match(lawyerClient, /completion/); assert.match(ownerClient, /\/review/); assert.match(migration, /CREATE TABLE `lawyer_reviews`/);
  assert.match(ownerClient, /speedRating/); assert.match(ownerClient, /qualityRating/); assert.match(ownerClient, /communicationRating/);
  const [moderation, moderationService, moderationRoutes, moderationMigration] = await Promise.all([
    readFile(new URL("../lib/platform/lawyer-review-moderation.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/platform/lawyer-review-moderation-service.ts", import.meta.url), "utf8"),
    Promise.all([
      readFile(new URL("../app/api/platform/admin/lawyer-reviews/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/platform/admin/lawyer-reviews/[reviewId]/route.ts", import.meta.url), "utf8"),
    ]),
    Promise.all([
      readFile(new URL("../drizzle/0055_lowly_shadow_king.sql", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0056_zippy_winter_soldier.sql", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0057_calm_rating_guard.sql", import.meta.url), "utf8"),
    ]),
  ]);
  assert.match(moderation, /hasLikelyPersonalData/);
  assert.match(moderationRoutes[0], /lawyer\.reviews\.moderate/);
  assert.match(moderationRoutes[1], /moderateLawyerReview/);
  assert.match(moderationService, /originalBodySha256/);
  assert.match(moderationService, /lawyer_review_moderated/);
  assert.match(moderationRoutes[1], /LIKELY_PERSONAL_DATA/);
  assert.match(moderationRoutes[1], /assertSafeWrite/);
  assert.match(moderationMigration[0], /CREATE TABLE `lawyer_review_moderation`/);
  assert.match(moderationMigration[0], /append-only/);
  assert.match(moderationMigration[1], /lawyer_review_moderation_applies_terminal_status/);
  assert.match(moderationMigration[2], /lawyer_reviews_rating_range_insert/);
  assert.match(moderationMigration[2], /BETWEEN 1 AND 5/);
  assert.match(directoryRoute, /m\.decision='approved'/);
  assert.match(directoryRoute, /r\.status='approved'/);
  assert.match(directoryRoute, /ROW_NUMBER\(\) OVER/);
  assert.match(directoryRoute, /projectPublicLawyerDirectory/);
});
