import { personalDetailsSchema, personalDetailColumns } from "../../../../lib/platform/personal-details";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import {
  prepareUserIdentityWrite,
  resolveUserIdentity,
  userIdentityById,
  userIdentitySelect,
  type UserIdentityRow,
} from "../../../../lib/auth/identity-protection";
import { runtimeIdentityProtection } from "../../../../lib/auth/identity-runtime";
import {
  authLocaleFromRequest,
  localizedRequestFormatError,
  type RequestAuthLocale,
} from "../../../../lib/auth/request-locale";
import { workspaceForUser } from "../../../../lib/platform/workspace";
import { canManageTeam } from "../../../../lib/platform/role-policy";
import { isLocale } from "../../../../lib/platform/routing";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

function localized(
  locale: RequestAuthLocale,
  values: Record<RequestAuthLocale, string>,
): string {
  return values[locale];
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser(request);
  const workspace = await workspaceForUser(user);
  const db = requireD1();
  const [profile, workspaceRow, consents, acceptances, deletionRequest] =
    await db.batch([
    db.prepare(
      `SELECT id,${userIdentitySelect("user_profiles")},
        full_name AS fullName,first_name AS firstName,last_name AS lastName,middle_name AS middleName,
        birth_date AS birthDate,registered_address AS registeredAddress,locale,account_type AS accountType,
        company_name AS companyName,organization_role AS organizationRole,primary_goal AS primaryGoal,
        timezone,onboarding_completed_at AS onboardingCompletedAt,created_at AS createdAt
       FROM user_profiles WHERE id=? LIMIT 1`,
    ).bind(user.id),
    db.prepare("SELECT id,name,full_name AS fullName,short_name AS shortName,type,locale FROM workspaces WHERE id=? LIMIT 1").bind(workspace.id),
    db.prepare(
      "SELECT type,version,granted_at AS grantedAt,revoked_at AS revokedAt FROM consents WHERE user_id=? ORDER BY granted_at DESC",
    ).bind(user.id),
    db.prepare(
      `SELECT
         acceptance.document_key AS type,
         acceptance.document_version AS version,
         acceptance.locale,
         acceptance.content_sha256 AS contentSha256,
         acceptance.accepted_at AS acceptedAt,
         CASE
           WHEN acceptance.policy_document_id IS NULL
             THEN 'legacy_unverified'
           ELSE coalesce(policy.status,'registry_missing')
         END AS status
       FROM user_acceptances acceptance
       LEFT JOIN policy_documents policy
         ON policy.id=acceptance.policy_document_id
       WHERE acceptance.user_id=?
       ORDER BY acceptance.accepted_at DESC`,
    ).bind(user.id),
    db.prepare(
      `SELECT
         id,status,deletion_mode AS deletionMode,
         requested_at AS requestedAt,verified_at AS verifiedAt,
         scheduled_purge_at AS scheduledPurgeAt,
         purge_started_at AS purgeStartedAt,
         purge_irreversible_at AS purgeIrreversibleAt,
         failure_code AS failureCode,
         CASE
           WHEN deletion_mode='recoverable_30d'
             AND status IN ('scheduled','blocked')
             AND purge_irreversible_at IS NULL
           THEN 1 ELSE 0
         END AS cancelable,
          CASE
            WHEN status='blocked' AND purge_irreversible_at IS NULL
            THEN 1 ELSE 0
          END AS retryable
       FROM account_deletion_requests
       WHERE user_id=?
         AND status IN ('requested','reviewing','scheduled','purging','blocked')
       ORDER BY requested_at DESC
       LIMIT 1`,
    ).bind(user.id),
  ]);
  const profileRow = profile.results[0] as (UserIdentityRow & {
    fullName: string | null;
    firstName: string | null; lastName: string | null; middleName: string | null;
    birthDate: string | null; registeredAddress: string | null;
    locale: string;
    accountType: string;
    companyName: string | null;
    organizationRole: string | null;
    primaryGoal: string | null;
    timezone: string;
    onboardingCompletedAt: string | null;
    createdAt: string;
  }) | undefined;
  const identity = profileRow
    ? await resolveUserIdentity(runtimeIdentityProtection(), profileRow)
    : null;
  const profileLocale = profileRow && isLocale(profileRow.locale)
    ? profileRow.locale
    : "ru";
  const storedWorkspace = workspaceRow.results[0] as
    | (Record<string, unknown> & { locale?: unknown })
    | undefined;
  return response({
    profile: profileRow && identity ? {
      id: profileRow.id,
      email: identity.email,
      fullName: profileRow.fullName,
      firstName: profileRow.firstName, lastName: profileRow.lastName, middleName: profileRow.middleName,
      birthDate: profileRow.birthDate, registeredAddress: profileRow.registeredAddress,
      phone: identity.phone,
      locale: profileLocale,
      accountType: profileRow.accountType,
      companyName: profileRow.companyName,
      organizationRole: profileRow.organizationRole,
      primaryGoal: profileRow.primaryGoal,
      timezone: profileRow.timezone,
      onboardingCompletedAt: profileRow.onboardingCompletedAt,
      createdAt: profileRow.createdAt,
    } : null,
    workspace: storedWorkspace
      ? {
          ...storedWorkspace,
          locale: typeof storedWorkspace.locale === "string"
              && isLocale(storedWorkspace.locale)
            ? storedWorkspace.locale
            : profileLocale,
        }
      : null,
    role: workspace.role,
    consents: consents.results,
    acceptances: acceptances.results,
    deletionRequest: deletionRequest.results[0] ?? null,
  });
});

export const PATCH = withApiErrors(async function PATCH(request: Request) {
  assertSafeWrite(request);
  const requestLocale = authLocaleFromRequest(request);
  const user = await requireApiUser(request);
  const workspace = await workspaceForUser(user);
  const body = await request.json().catch(() => null) as { fullName?: string; phone?: string; locale?: string; timezone?: string; companyName?: string; organizationRole?: string } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return response({ error: localizedRequestFormatError(request) }, 400);
  }
  const details = personalDetailsSchema.safeParse(body);
  if (!details.success) return response({ code: "INVALID_PERSONAL_DETAILS", error: localized(requestLocale, {
    ru: "Проверьте личные данные: имя — до 80 символов, адрес — до 500. Дата рождения должна быть действительной и не в будущем.",
    uz: "Shaxsiy ma’lumotlarni tekshiring: ism — 80, manzil — 500 belgigacha. Tug‘ilgan sana haqiqiy va kelajakda bo‘lmasligi kerak.",
    en: "Check your personal details: names allow 80 characters and address 500. Date of birth must be valid and not in the future.",
  }) }, 400);
  const db = requireD1();
  const storedNames = details.data.firstName ? await db.prepare(
    "SELECT last_name AS lastName,middle_name AS middleName FROM user_profiles WHERE id=?",
  ).bind(user.id).first<{ lastName: string | null; middleName: string | null }>() : null;
  const fullName = details.data.firstName
    ? [details.data.firstName, details.data.middleName ?? storedNames?.middleName, details.data.lastName ?? storedNames?.lastName].filter(Boolean).join(" ")
    : typeof body.fullName === "string" ? body.fullName.trim().slice(0, 160) : "";
  if (!fullName) {
    return response({
      code: "FULL_NAME_REQUIRED",
      error: localized(requestLocale, {
        ru: "Укажите имя.",
        uz: "Ismingizni kiriting.",
        en: "Enter your name.",
      }),
    }, 400);
  }
  if (typeof body.locale !== "string" || !isLocale(body.locale)) {
    return response({
      code: "INVALID_LOCALE",
      error: localized(requestLocale, {
        ru: "Выберите поддерживаемый язык интерфейса.",
        uz: "Qo‘llab-quvvatlanadigan interfeys tilini tanlang.",
        en: "Choose a supported interface language.",
      }),
    }, 400);
  }
  const locale = body.locale;
  const timezone = body.timezone === "UTC" ? "UTC" : "Asia/Tashkent";
  const phone = body.phone?.trim().slice(0, 40) || null;
  const companyName = body.companyName?.trim().slice(0, 180) || null;
  const organizationRole = body.organizationRole?.trim().slice(0, 120) || null;
  const now = isoNow();
  const identityContext = runtimeIdentityProtection();
  const currentIdentity = await userIdentityById(
    db,
    identityContext,
    user.id,
  );
  if (!currentIdentity) {
    return response({
      code: "PROFILE_NOT_FOUND",
      error: localized(locale, {
        ru: "Профиль не найден.",
        uz: "Profil topilmadi.",
        en: "Profile not found.",
      }),
    }, 404);
  }
  const protectedIdentity = identityContext.mode === "dual_write"
    ? await prepareUserIdentityWrite(identityContext, {
        userId: user.id,
        email: currentIdentity.email,
        phone,
      })
    : null;
  const profileUpdate = protectedIdentity
    ? db.prepare(
      `UPDATE user_profiles SET
         full_name=?,phone=?,
         email_ciphertext=?,email_iv=?,email_key_version=?,
         email_lookup_hash=?,email_lookup_key_version=?,
         phone_ciphertext=?,phone_iv=?,phone_key_version=?,
         phone_lookup_hash=?,phone_lookup_key_version=?,
         locale=?,timezone=?,company_name=?,organization_role=?,updated_at=?
       WHERE id=?`,
    ).bind(
      fullName,
      protectedIdentity.phone,
      protectedIdentity.emailCiphertext,
      protectedIdentity.emailIv,
      protectedIdentity.emailKeyVersion,
      protectedIdentity.emailLookupHash,
      protectedIdentity.emailLookupKeyVersion,
      protectedIdentity.phoneCiphertext,
      protectedIdentity.phoneIv,
      protectedIdentity.phoneKeyVersion,
      protectedIdentity.phoneLookupHash,
      protectedIdentity.phoneLookupKeyVersion,
      locale,
      timezone,
      companyName,
      organizationRole,
      now,
      user.id,
    )
    : db.prepare(
      `UPDATE user_profiles SET
         full_name=?,phone=?,locale=?,timezone=?,
         company_name=?,organization_role=?,updated_at=?
       WHERE id=?`,
    ).bind(
      fullName,
      phone,
      locale,
      timezone,
      companyName,
      organizationRole,
      now,
      user.id,
    );
  const detailKeys = (Object.keys(personalDetailColumns) as Array<keyof typeof personalDetailColumns>)
    .filter(key => details.data[key] !== undefined);
  const detailUpdates = detailKeys.length ? [db.prepare(
    `UPDATE user_profiles SET ${detailKeys.map(key => `${personalDetailColumns[key]}=?`).join(",")} WHERE id=?`,
  ).bind(...detailKeys.map(key => details.data[key] || null), user.id)] : [];
  const workspaceUpdates = canManageTeam(workspace.role)
    ? [db.prepare(`UPDATE workspaces SET locale=?,
        name=CASE WHEN type='business' AND ? IS NOT NULL THEN ? ELSE name END,
        full_name=CASE WHEN type='business' AND ? IS NOT NULL THEN ? ELSE full_name END,
        updated_at=? WHERE id=?`)
        .bind(locale, companyName, companyName, companyName, companyName, now, workspace.id)]
    : [];
  await db.batch([
    profileUpdate,
    ...detailUpdates,
    ...workspaceUpdates,
    db.prepare(
      "INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'user',?,'profile_updated',?,?)",
    ).bind(crypto.randomUUID(), workspace.id, user.id, user.id, JSON.stringify({ locale, timezone, workspaceSettingsChanged: workspaceUpdates.length === 1 }), now),
  ]);
  return response({ ok: true, locale });
});
