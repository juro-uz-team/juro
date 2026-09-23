import {
  parseJsonRequest,
  verifyMfaInputSchema,
} from "../../../../lib/auth/input";
import {
  identityKeyring,
  jsonNoStore,
  mfaErrorResponse,
} from "../../../../lib/auth/mfa-http";
import {
  MfaError,
  verifyLoginMfa,
} from "../../../../lib/auth/mfa-service";
import {
  clearMfaChallengeCookie,
  deviceContinuityCookie,
  replacementSessionCookies,
} from "../../../../lib/auth/session";
import { authRequestSecurityContext } from "../../../../lib/auth/request-security-evidence";
import {
  deviceContinuityTokenFromCookie,
  mfaChallengeTokenFromCookie,
} from "../../../../lib/auth/session-token";
import {
  assertSafeWrite,
  withApiErrors,
} from "../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { isLocale, isPersonalAccountType } from "../../../../lib/platform/routing";
import { lawyerLandingDestination } from "../../../../lib/platform/lawyer-entry-routing";
import { issueSessionHandoff } from "../../../../lib/auth/session-handoff";
import { localizedRequestFormatError } from "../../../../lib/auth/request-locale";
import {
  resolveThemePreference,
  themePreferenceCookie,
} from "../../../../lib/platform/theme-preference";

function terminalMfaError(error: unknown): boolean {
  return error instanceof MfaError
    && [
      "MFA_CHALLENGE_INVALID",
      "MFA_CHALLENGE_EXPIRED",
      "MFA_CHALLENGE_USED",
      "MFA_ATTEMPTS_EXCEEDED",
      "MFA_RATE_LIMITED",
    ].includes(error.code);
}

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const parsed = await parseJsonRequest(request, verifyMfaInputSchema);
  if (!parsed.ok) {
    const status = parsed.error === "payload_too_large"
      ? 413
      : parsed.error === "invalid_content_type"
        ? 415
        : 400;
    return jsonNoStore({
      code: parsed.error.toLocaleUpperCase(),
      error: localizedRequestFormatError(request),
    }, status);
  }
  const { code, locale, rememberMe } = parsed.data;
  const token = mfaChallengeTokenFromCookie(request.headers.get("cookie"));
  if (!token) {
    return jsonNoStore({
      code: "MFA_CHALLENGE_INVALID",
      error: locale === "ru"
        ? "Проверка входа недействительна. Начните вход заново."
        : locale === "uz"
          ? "Kirish tekshiruvi yaroqsiz. Kirishni qaytadan boshlang."
          : "The sign-in check is invalid. Start signing in again.",
    }, 401, [clearMfaChallengeCookie()]);
  }
  try {
    const result = await verifyLoginMfa(
      requireD1(),
      identityKeyring(),
      {
        token,
        code,
        userAgent: request.headers.get("user-agent"),
        securityContext: authRequestSecurityContext(request),
        deviceToken: deviceContinuityTokenFromCookie(
          request.headers.get("cookie"),
        ),
        requestIp: request.headers.get("x-juro-client-ip")?.trim() || null,
        rememberMe,
      },
    );
    const userLocale = isLocale(result.locale) ? result.locale : locale;
    const accountType = isPersonalAccountType(result.accountType)
      ? result.accountType
      : "individual";
    const themePreference = resolveThemePreference(result.themePreference);
    const requestUrl = new URL(request.url);
    const requestHostname = requestUrl.hostname;
    const normalizedHostname = requestHostname.toLowerCase();
    const lawyerHost = normalizedHostname === "lawyer.juro.uz";
    const lawyerProfile = accountType === "lawyer"
      ? await requireD1().prepare(
          `SELECT status AS lawyerProfileStatus,
            marketplace_status AS lawyerMarketplaceStatus
           FROM lawyer_profiles WHERE user_id=? LIMIT 1`,
        ).bind(result.userId).first<{
          lawyerProfileStatus: string | null;
          lawyerMarketplaceStatus: string | null;
        }>()
      : null;
    const accountRedirect = accountType === "lawyer"
      ? lawyerLandingDestination({
          locale: userLocale,
          accountType,
          onboardingCompleted: Boolean(result.onboardingCompletedAt),
          lawyerProfileStatus: lawyerProfile?.lawyerProfileStatus ?? null,
          lawyerMarketplaceStatus: lawyerProfile?.lawyerMarketplaceStatus ?? null,
        }, lawyerHost, requestHostname)
      : result.onboardingCompletedAt
        ? `/${userLocale}/${accountType}/dashboard`
        : `/${userLocale}/onboarding`;
    const redirectTo = accountType !== "lawyer" && lawyerHost
      ? `https://app.juro.uz${accountRedirect}`
      : accountRedirect;
    const handoff = await issueSessionHandoff(requireD1(), {
      userId: result.userId,
      sourceSessionId: result.session.sessionId,
      sourceHost: normalizedHostname,
      destinationUrl: redirectTo,
      rememberMe,
    });
    return jsonNoStore({
      ok: true,
      redirectTo,
      handoff,
      themePreference,
    }, 200, [
      clearMfaChallengeCookie(),
      ...replacementSessionCookies(result.session.token, rememberMe, requestHostname),
      ...(result.session.deviceContinuityToken
        ? [deviceContinuityCookie(result.session.deviceContinuityToken)]
        : []),
      themePreferenceCookie(themePreference, requestUrl),
    ]);
  } catch (error) {
    const response = mfaErrorResponse(error, locale);
    if (!response) throw error;
    if (terminalMfaError(error)) {
      response.headers.append("set-cookie", clearMfaChallengeCookie());
    }
    return response;
  }
});
