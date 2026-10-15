import { normalizeEmail, sha256 } from "../../../../lib/auth/crypto";
import { userIdByEmail } from "../../../../lib/auth/identity-protection";
import { runtimeIdentityProtection } from "../../../../lib/auth/identity-runtime";
import { localizedRequestFormatError } from "../../../../lib/auth/request-locale";
import {
  consumeOtpChallenge,
  type OtpChallengeResult,
} from "../../../../lib/auth/otp-challenge";
import {
  identityKeyring,
  mfaErrorResponse,
  optionalIdentityKeyring,
} from "../../../../lib/auth/mfa-http";
import {
  authRequestSecurityContext,
  prepareAuthRequestSecurityEvidence,
} from "../../../../lib/auth/request-security-evidence";
import {
  prepareDeviceContinuity,
} from "../../../../lib/auth/device-continuity";
import {
  createLoginMfaChallenge,
  hasActiveMfa,
} from "../../../../lib/auth/mfa-service";
import {
  parseJsonRequest,
  verifyOtpInputSchema,
} from "../../../../lib/auth/input";
import {
  finalizePendingRegistration,
} from "../../../../lib/auth/registration-retention";
import {
  deviceContinuityCookie,
  mfaChallengeCookie,
  replacementSessionCookies,
} from "../../../../lib/auth/session";
import {
  createPrimarySessionIfMfaDisabled,
} from "../../../../lib/auth/session-management";
import { issueSessionHandoff } from "../../../../lib/auth/session-handoff";
import {
  deviceContinuityTokenFromCookie,
} from "../../../../lib/auth/session-token";
import {
  assertSafeWrite,
  withApiErrors,
} from "../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import {
  prepareRegistrationAcceptanceWrite,
} from "../../../../lib/legal/acceptance";
import { ensureDefaultWorkspace } from "../../../../lib/platform/workspace";
import { isPersonalAccountType } from "../../../../lib/platform/routing";
import { lawyerLandingDestination } from "../../../../lib/platform/lawyer-entry-routing";
import {
  resolveThemePreference,
  themePreferenceCookie,
} from "../../../../lib/platform/theme-preference";

function json(body: unknown, status = 200, cookies?: string | string[]) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store", pragma: "no-cache" });
  for (const cookie of cookies ? (Array.isArray(cookies) ? cookies : [cookies]) : []) {
    headers.append("set-cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

type AuthLocale = "ru" | "uz" | "en";

function localized(
  locale: AuthLocale,
  values: { ru: string; uz: string; en: string },
): string {
  return values[locale];
}

function otpError(
  result: Exclude<OtpChallengeResult, { status: "verified" }>,
  locale: AuthLocale,
): Response {
  switch (result.status) {
    case "used":
      return json({
        code: "OTP_USED",
        error: localized(locale, {
          ru: "Этот код уже использован. Запросите новый.",
          uz: "Bu kod allaqachon ishlatilgan. Yangi kod so‘rang.",
          en: "This code has already been used. Request a new one.",
        }),
      }, 400);
    case "replaced":
      return json({
        code: "OTP_REPLACED",
        error: localized(locale, {
          ru: "Код заменён новым. Используйте последнее письмо.",
          uz: "Kod yangisi bilan almashtirilgan. Oxirgi xatdan foydalaning.",
          en: "A newer code was issued. Use the most recent email.",
        }),
      }, 400);
    case "expired":
      return json({
        code: "OTP_EXPIRED",
        error: localized(locale, {
          ru: "Срок действия кода истёк. Запросите новый.",
          uz: "Kod muddati tugagan. Yangi kod so‘rang.",
          en: "The code has expired. Request a new one.",
        }),
      }, 400);
    case "attempts_exceeded":
      return json({
        code: "OTP_ATTEMPTS_EXCEEDED",
        error: localized(locale, {
          ru: "Попытки закончились. Запросите новый код.",
          uz: "Urinishlar tugadi. Yangi kod so‘rang.",
          en: "There are no attempts left. Request a new code.",
        }),
      }, 429);
    case "locked":
      return json({
        code: "OTP_VERIFICATION_LOCKED",
        retryAfterSeconds: result.retryAfterSeconds,
        error: localized(locale, {
          ru: "Слишком много неверных попыток. Повторите через 15 минут.",
          uz: "Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring.",
          en: "Too many incorrect attempts. Try again in 15 minutes.",
        }),
      }, 429);
    case "incorrect":
      return json({
        code: "OTP_INCORRECT",
        error: localized(locale, {
          ru: "Неверный код.", uz: "Kod noto‘g‘ri.", en: "The code is incorrect.",
        }),
      }, 400);
    default:
      return json({
        code: "OTP_INVALID",
        error: localized(locale, {
          ru: "Код недействителен.", uz: "Kod yaroqsiz.", en: "The code is invalid.",
        }),
      }, 400);
  }
}

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const parsed = await parseJsonRequest(request, verifyOtpInputSchema);
  if (!parsed.ok) {
    const status = parsed.error === "payload_too_large"
      ? 413
      : parsed.error === "invalid_content_type"
        ? 415
        : 400;
    return json({
      code: parsed.error.toLocaleUpperCase(),
      error: localizedRequestFormatError(request),
    }, status);
  }
  const body = parsed.data;
  const email = normalizeEmail(body.email);
  const code = body.code;
  const locale = body.locale;
  const routeLocale = locale;
  const purpose = body.purpose;
  if (purpose === "register" && (!body.acceptTerms || !body.acceptPrivacy || !body.acceptPersonalData)) return json({ error: localized(locale, {
    ru: "Нужно принять обязательные документы.",
    uz: "Majburiy hujjatlarni qabul qilish kerak.",
    en: "You need to accept the required legal documents.",
  }) }, 400);

  const db = requireD1();
  const identityContext = runtimeIdentityProtection();
  const now = new Date().toISOString();
  const verification = await consumeOtpChallenge(db, {
    identityContext,
    challengeId: body.challengeId,
    email,
    purpose,
    code,
    now,
  });
  if (verification.status !== "verified") {
    return otpError(verification, locale);
  }
  const emailHash = await sha256(email);

  const existingUserId = await userIdByEmail(db, identityContext, email);
  const user = existingUserId
    ? await db.prepare(
      `SELECT u.id,u.account_type AS accountType,
        u.email_verified_at AS emailVerifiedAt,
        u.theme_preference AS themePreference,
        u.onboarding_completed_at AS onboardingCompletedAt,
        lp.status AS lawyerProfileStatus,
        lp.marketplace_status AS lawyerMarketplaceStatus
       FROM user_profiles u
       LEFT JOIN lawyer_profiles lp ON lp.user_id=u.id
       WHERE u.id=? LIMIT 1`,
    ).bind(existingUserId).first<{
      id: string;
      accountType: string;
      emailVerifiedAt: string | null;
      themePreference: string;
      onboardingCompletedAt: string | null;
      lawyerProfileStatus: string | null;
      lawyerMarketplaceStatus: string | null;
    }>()
    : null;
  if (purpose === "register" && user?.emailVerifiedAt) {
    return json({
      code: "ACCOUNT_EXISTS",
      error: localized(locale, {
        ru: "Аккаунт уже существует. Используйте вход.",
        uz: "Hisob allaqachon mavjud. Kirishdan foydalaning.",
        en: "An account already exists. Sign in instead.",
      }),
    }, 409);
  }
  if (purpose === "register" && !user) {
    return json({
      code: "REGISTRATION_RESTART_REQUIRED",
      error: localized(locale, {
        ru: "Регистрационные данные не найдены. Заполните форму ещё раз.",
        uz: "Ro‘yxatdan o‘tish ma’lumotlari topilmadi. Shaklni qayta to‘ldiring.",
        en: "The registration details were not found. Complete the form again.",
      }),
    }, 409);
  }
  const accountType = user && isPersonalAccountType(user.accountType)
    ? user.accountType
    : verification.accountType;
  if (!user) throw new Error("AUTH_USER_STATE_CONFLICT");
  const themePreference = resolveThemePreference(user.themePreference);
  // Prepare mandatory legal evidence, then commit it in the same D1 batch as
  // profile verification and marker removal. A Worker interruption or D1
  // failure therefore cannot create an acceptance-protected registration
  // orphan that bypasses the retention window.
  const acceptanceWrite = await prepareRegistrationAcceptanceWrite(db, {
    userId: user.id,
    locale,
    otpChallengeId: body.challengeId,
    acceptedMarketing: Boolean(body.marketing),
    acceptedAt: now,
  });
  const verified = await finalizePendingRegistration(db, {
    userId: user.id,
    verifiedAt: now,
    acceptanceWrite: {
      ...acceptanceWrite,
      locale,
    },
  });
  if (!verified) {
    return json({
      code: "ACCOUNT_EXISTS",
      error: localized(locale, {
        ru: "Аккаунт уже подтверждён. Используйте вход.",
        uz: "Hisob allaqachon tasdiqlangan. Kirishdan foydalaning.",
        en: "The account is already confirmed. Sign in instead.",
      }),
    }, 409);
  }
  user.emailVerifiedAt = now;
  await ensureDefaultWorkspace(user.id);
  const requestUrl = new URL(request.url);
  const requestHostname = requestUrl.hostname;
  const normalizedHostname = requestHostname.toLowerCase();
  const lawyerHost = normalizedHostname === "lawyer.juro.uz";
  const accountRedirect = accountType === "lawyer"
    ? lawyerLandingDestination({
        locale: routeLocale,
        accountType,
        onboardingCompleted: Boolean(user.onboardingCompletedAt) && purpose !== "register",
        lawyerProfileStatus: user.lawyerProfileStatus,
        lawyerMarketplaceStatus: user.lawyerMarketplaceStatus,
      }, lawyerHost, requestHostname)
    : `/${routeLocale}/${accountType}/dashboard`;
  const redirectTo = accountType !== "lawyer" && lawyerHost
    ? `https://app.juro.uz${accountRedirect}`
    : accountRedirect;
  if (await hasActiveMfa(db, user.id)) {
    try {
      const challenge = await createLoginMfaChallenge(
        db,
        identityKeyring(),
        {
          userId: user.id,
          emailHash,
          emailOtpChallengeId: body.challengeId,
          userAgent: request.headers.get("user-agent"),
          now: new Date(now),
        },
      );
      return json({
        ok: true,
        requiresTwoFactor: true,
        expiresInSeconds: 300,
        themePreference,
      }, 200, [
        mfaChallengeCookie(challenge.token),
        themePreferenceCookie(themePreference, requestUrl),
      ]);
    } catch (error) {
      const response = mfaErrorResponse(error, routeLocale);
      if (response) return response;
      throw error;
    }
  }
  const continuityKeyring = optionalIdentityKeyring();
  const securityEvidence = await prepareAuthRequestSecurityEvidence(
    continuityKeyring,
    user.id,
    authRequestSecurityContext(request),
  );
  const deviceContinuity = await prepareDeviceContinuity(
    db,
    continuityKeyring,
    {
      userId: user.id,
      deviceToken: deviceContinuityTokenFromCookie(
        request.headers.get("cookie"),
      ),
      securityEvidence,
      now: new Date(now),
    },
  );
  const session = await createPrimarySessionIfMfaDisabled(db, {
    userId: user.id,
    userAgent: request.headers.get("user-agent"),
    securityEvidence,
    deviceContinuity,
    loginSecurityNotification: null,
    rememberMe: body.rememberMe,
    now: new Date(now),
  });
  if (!session) {
    try {
      const challenge = await createLoginMfaChallenge(
        db,
        identityKeyring(),
        {
          userId: user.id,
          emailHash,
          emailOtpChallengeId: body.challengeId,
          userAgent: request.headers.get("user-agent"),
          now: new Date(now),
        },
      );
      return json({
        ok: true,
        requiresTwoFactor: true,
        expiresInSeconds: 300,
        themePreference,
      }, 200, [
        mfaChallengeCookie(challenge.token),
        themePreferenceCookie(themePreference, requestUrl),
      ]);
    } catch (error) {
      const response = mfaErrorResponse(error, routeLocale);
      if (response) return response;
      throw error;
    }
  }
  const handoff = await issueSessionHandoff(db, {
    userId: user.id,
    sourceSessionId: session.sessionId,
    sourceHost: normalizedHostname,
    destinationUrl: redirectTo,
    rememberMe: body.rememberMe,
    now: new Date(now),
  });
  return json({
    ok: true,
    redirectTo,
    handoff,
    themePreference,
  }, 200, [
    ...replacementSessionCookies(session.token, body.rememberMe, requestHostname),
    ...(session.deviceContinuityToken
      ? [deviceContinuityCookie(session.deviceContinuityToken)]
      : []),
    themePreferenceCookie(themePreference, requestUrl),
  ]);
});
