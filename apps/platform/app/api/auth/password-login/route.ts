import { normalizeEmail } from "../../../../lib/auth/crypto";
import {
  authRequestSecurityContext,
  prepareAuthRequestSecurityEvidence,
} from "../../../../lib/auth/request-security-evidence";
import { prepareDeviceContinuity } from "../../../../lib/auth/device-continuity";
import {
  identityKeyring,
  mfaErrorResponse,
  optionalIdentityKeyring,
} from "../../../../lib/auth/mfa-http";
import {
  createLoginMfaChallenge,
  hasActiveMfa,
} from "../../../../lib/auth/mfa-service";
import {
  completePasswordLoginAttempt,
  failPasswordLoginAttempt,
  createPasswordMfaProof,
  passwordCredentialForUser,
  passwordLoginRateLimit,
  reservePasswordLoginAttempt,
  verifyPassword,
} from "../../../../lib/auth/password";
import {
  parseJsonRequest,
  passwordLoginInputSchema,
} from "../../../../lib/auth/input";
import {
  deviceContinuityCookie,
  mfaChallengeCookie,
  replacementSessionCookies,
} from "../../../../lib/auth/session";
import { createPrimarySessionIfMfaDisabled } from "../../../../lib/auth/session-management";
import { issueSessionHandoff } from "../../../../lib/auth/session-handoff";
import { deviceContinuityTokenFromCookie } from "../../../../lib/auth/session-token";
import { userIdByEmail } from "../../../../lib/auth/identity-protection";
import { runtimeIdentityProtection } from "../../../../lib/auth/identity-runtime";
import { localizedRequestFormatError } from "../../../../lib/auth/request-locale";
import {
  authTurnstileActions,
  validateAuthTurnstile,
} from "../../../../lib/auth/turnstile";
import { assertSafeWrite, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { requireD1, runtimeEnv } from "../../../../lib/document-builder/storage/runtime";
import { ensureDefaultWorkspace } from "../../../../lib/platform/workspace";
import { lawyerLandingDestination } from "../../../../lib/platform/lawyer-entry-routing";
import { isAccountType, isPersonalAccountType } from "../../../../lib/platform/routing";
import {
  resolveThemePreference,
  themePreferenceCookie,
} from "../../../../lib/platform/theme-preference";

type AuthLocale = "ru" | "uz" | "en";

function json(body: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "private, no-store",
    pragma: "no-cache",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function message(
  locale: AuthLocale,
  values: { ru: string; uz: string; en: string },
): string {
  return values[locale];
}

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const parsed = await parseJsonRequest(request, passwordLoginInputSchema);
  if (!parsed.ok) {
    return json({
      code: parsed.error.toLocaleUpperCase(),
      error: localizedRequestFormatError(request),
    }, parsed.error === "payload_too_large" ? 413 : parsed.error === "invalid_content_type" ? 415 : 400);
  }
  const { locale, rememberMe, password } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const env = runtimeEnv();
  if (!env.TURNSTILE_SECRET_KEY) {
    return json({
      code: "AUTH_UNAVAILABLE",
      error: message(locale, {
        ru: "Защищённый вход временно недоступен.",
        uz: "Himoyalangan kirish vaqtincha mavjud emas.",
        en: "Secure sign-in is temporarily unavailable.",
      }),
    }, 503);
  }
  const db = requireD1();
  const requestIp = request.headers.get("x-juro-client-ip")?.trim() || null;
  const limit = await passwordLoginRateLimit(db, { email, requestIp });
  if (!limit.allowed) {
    return json({
      code: "AUTH_RATE_LIMITED",
      retryAfterSeconds: limit.retryAfterSeconds,
      error: message(locale, {
        ru: "Слишком много попыток входа. Повторите позднее.",
        uz: "Kirish urinishlari juda ko‘p. Keyinroq qayta urinib ko‘ring.",
        en: "Too many sign-in attempts. Try again later.",
      }),
    }, 429);
  }
  const turnstile = await validateAuthTurnstile({
    secretKey: env.TURNSTILE_SECRET_KEY,
    token: parsed.data.turnstileToken,
    remoteIp: requestIp,
    expectedHostname: new URL(request.url).hostname,
    expectedActions: [authTurnstileActions.passwordLogin],
  });
  if (turnstile.status !== "verified") {
    return json({
      code: turnstile.status === "unavailable"
        ? "TURNSTILE_UNAVAILABLE"
        : "TURNSTILE_INVALID",
      error: message(locale, {
        ru: "Не удалось подтвердить проверку безопасности. Повторите попытку.",
        uz: "Xavfsizlik tekshiruvi tasdiqlanmadi. Qayta urinib ko‘ring.",
        en: "The security check could not be verified. Try again.",
      }),
    }, turnstile.status === "unavailable" ? 503 : 400);
  }

  const attempt = await reservePasswordLoginAttempt(db, { email, requestIp });
  if (!attempt.allowed) {
    return json({
      code: "AUTH_RATE_LIMITED",
      retryAfterSeconds: attempt.retryAfterSeconds,
      error: message(locale, {
        ru: "Слишком много попыток входа. Повторите позднее.",
        uz: "Kirish urinishlari juda ko‘p. Keyinroq qayta urinib ko‘ring.",
        en: "Too many sign-in attempts. Try again later.",
      }),
    }, 429);
  }

  const identityContext = runtimeIdentityProtection();
  const userId = await userIdByEmail(db, identityContext, email);
  const profile = userId
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
    ).bind(userId).first<{
      id: string;
      accountType: string;
      emailVerifiedAt: string | null;
      themePreference: string;
      onboardingCompletedAt: string | null;
      lawyerProfileStatus: string | null;
      lawyerMarketplaceStatus: string | null;
    }>()
    : null;
  const credential = profile
    ? await passwordCredentialForUser(db, profile.id)
    : null;
  const authenticated = await verifyPassword(password, credential);
  if (!authenticated || !profile || !isAccountType(profile.accountType)) {
    await failPasswordLoginAttempt(db, attempt.reservation);
    return json({
      code: "AUTH_FAILED",
      error: message(locale, {
        ru: "Не удалось войти. Проверьте электронную почту и пароль.",
        uz: "Kirish amalga oshmadi. Email va parolni tekshiring.",
        en: "We could not sign you in. Check your email and password.",
      }),
    }, 401);
  }
  await completePasswordLoginAttempt(db, attempt.reservation);
  if (!profile.emailVerifiedAt) {
    return json({
      code: "EMAIL_NOT_VERIFIED",
      error: message(locale, {
        ru: "Адрес электронной почты ещё не подтверждён.",
        uz: "Email manzili hali tasdiqlanmagan.",
        en: "Your email address has not been confirmed yet.",
      }),
    }, 403);
  }
  const themePreference = resolveThemePreference(profile.themePreference);
  const requestUrl = new URL(request.url);

  const routeLocale = locale;
  const workspaceId = await ensureDefaultWorkspace(profile.id);
  const requestHostname = requestUrl.hostname.toLowerCase();
  const lawyerHost = requestHostname === "lawyer.juro.uz";
  const accountRedirect = profile.accountType === "lawyer"
    ? lawyerLandingDestination({
        locale: routeLocale,
        accountType: "lawyer",
        onboardingCompleted: Boolean(profile.onboardingCompletedAt),
        lawyerProfileStatus: profile.lawyerProfileStatus,
        lawyerMarketplaceStatus: profile.lawyerMarketplaceStatus,
      }, lawyerHost, requestHostname)
    : !profile.onboardingCompletedAt
      ? `/${routeLocale}/onboarding`
      : profile.accountType === "business" && workspaceId
        ? `/${routeLocale}/business/${encodeURIComponent(workspaceId)}/dashboard`
        : `/${routeLocale}/${profile.accountType}/dashboard`;
  const redirectTo = profile.accountType !== "lawyer" && lawyerHost
    ? `https://app.juro.uz${accountRedirect}`
    : accountRedirect;

  if (await hasActiveMfa(db, profile.id)) {
    const proof = await createPasswordMfaProof(db, {
      email,
      locale: routeLocale,
      accountType: isPersonalAccountType(profile.accountType)
        ? profile.accountType
        : "individual",
    });
    try {
      const challenge = await createLoginMfaChallenge(db, identityKeyring(), {
        userId: profile.id,
        emailHash: proof.emailHash,
        emailOtpChallengeId: proof.challengeId,
        primaryAuthMethod: "password",
        userAgent: request.headers.get("user-agent"),
      });
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
    profile.id,
    authRequestSecurityContext(request),
  );
  const deviceContinuity = await prepareDeviceContinuity(
    db,
    continuityKeyring,
    {
      userId: profile.id,
      deviceToken: deviceContinuityTokenFromCookie(request.headers.get("cookie")),
      securityEvidence,
    },
  );
  const session = await createPrimarySessionIfMfaDisabled(db, {
    userId: profile.id,
    userAgent: request.headers.get("user-agent"),
    authMethod: "password",
    securityEvidence,
    deviceContinuity,
    loginSecurityNotification: continuityKeyring
      ? {
          keyring: continuityKeyring,
          recipientEmail: email,
          locale: routeLocale,
          workspaceId,
        }
      : null,
    rememberMe,
  });
  if (!session) throw new Error("PASSWORD_SESSION_STATE_CONFLICT");
  const handoff = await issueSessionHandoff(db, {
    userId: profile.id,
    sourceSessionId: session.sessionId,
    sourceHost: requestHostname,
    destinationUrl: redirectTo,
    rememberMe,
  });
  return json({ ok: true, redirectTo, handoff, themePreference }, 200, [
    ...replacementSessionCookies(session.token, rememberMe, requestHostname),
    ...(session.deviceContinuityToken
      ? [deviceContinuityCookie(session.deviceContinuityToken)]
      : []),
    themePreferenceCookie(themePreference, requestUrl),
  ]);
});
