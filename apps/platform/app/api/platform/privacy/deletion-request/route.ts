import {
  cancelAccountDeletionRequest,
  confirmAccountDeletion,
  invalidateAccountDeletionChallenge,
  reserveAccountDeletionChallenge,
  retryAccountDeletionRequest,
  type DeletionConfirmationResult,
} from "../../../../../lib/auth/account-deletion";
import {
  RECOVERABLE_DELETION_DELAY_MS,
  accountDeletionSubjectHash,
} from "../../../../../lib/auth/account-deletion-lifecycle";
import { randomOtp, randomToken } from "../../../../../lib/auth/crypto";
import { runtimeIdentityProtection } from "../../../../../lib/auth/identity-runtime";
import {
  accountDeletionInputSchema,
  parseJsonRequest,
} from "../../../../../lib/auth/input";
import {
  jsonNoStore,
  localSessionForRequest,
} from "../../../../../lib/auth/mfa-http";
import { MfaError } from "../../../../../lib/auth/mfa-service";
import { clearSessionCookie } from "../../../../../lib/auth/session";
import { sharedAuthCookieDomain } from "../../../../../lib/auth/session-persistence";
import {
  renderJuroAuthEmail,
  sendJuroAuthEmail,
} from "../../../../../lib/auth/transactional-email";
import {
  assertSafeWrite,
  withApiErrors,
} from "../../../../../lib/document-builder/auth/api";
import { localizedRequestFormatError } from "../../../../../lib/auth/request-locale";
import {
  requireD1,
  runtimeEnv,
} from "../../../../../lib/document-builder/storage/runtime";
import { ensureDefaultWorkspace } from "../../../../../lib/platform/workspace";
import type { PlatformLocale } from "../../../../../lib/platform/routing";
import { dispatchOutbox } from "../../../../../worker/platform-outbox";

const CHALLENGE_TTL_MS = 10 * 60 * 1_000;
const RECENT_SESSION_MS = 10 * 60 * 1_000;

function sessionCookiesToClear(request: Request): string[] {
  const domain = sharedAuthCookieDomain(new URL(request.url).hostname);
  return [
    clearSessionCookie(),
    ...(domain ? [clearSessionCookie(domain)] : []),
  ];
}

function localized(
  locale: PlatformLocale,
  values: Record<PlatformLocale, string>,
): string {
  return values[locale];
}

function requestError(locale: PlatformLocale, code: string, status: number) {
  const messages: Record<string, [string, string, string]> = {
    LOCAL_SESSION_REQUIRED: [
      "Запрос удаления доступен только из локальной сессии JURO.",
      "O‘chirish so‘rovi faqat mahalliy JURO sessiyasida mavjud.",
      "Account deletion can only be requested from a local JURO session.",
    ],
    SESSION_NOT_RECENT: [
      "Для удаления войдите в JURO заново и повторите запрос.",
      "O‘chirish uchun JURO hisobiga qayta kirib, so‘rovni takrorlang.",
      "To delete your account, sign in to JURO again and repeat the request.",
    ],
  };
  const [ruMessage, uzMessage, enMessage] = messages[code] ?? [
    "Запрос не выполнен.",
    "So‘rov bajarilmadi.",
    "The request could not be completed.",
  ];
  return jsonNoStore(
    {
      code,
      error: localized(locale, { ru: ruMessage, uz: uzMessage, en: enMessage }),
    },
    status,
  );
}

function authErrorResponse(
  error: unknown,
  locale: PlatformLocale,
): Response | null {
  if (!(error instanceof MfaError)) return null;
  if (error.code === "LOCAL_SESSION_REQUIRED") {
    return requestError(locale, error.code, 401);
  }
  if (error.code === "SESSION_NOT_RECENT") {
    return requestError(locale, error.code, 401);
  }
  return null;
}

function invalidInputResponse(
  request: Request,
  error:
    | "invalid_content_type"
    | "invalid_json"
    | "invalid_input"
    | "payload_too_large",
) {
  const status =
    error === "payload_too_large"
      ? 413
      : error === "invalid_content_type"
        ? 415
        : 400;
  return jsonNoStore(
    {
      code: error.toLocaleUpperCase(),
      error: localizedRequestFormatError(request),
    },
    status,
  );
}

function maskedEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function confirmationError(
  result: Exclude<
    DeletionConfirmationResult,
    {
      status: "confirmed";
    }
  >,
  locale: PlatformLocale,
): Response {
  if (result.status === "existing_request") {
    return jsonNoStore(
      {
        code: "DELETION_REQUEST_EXISTS",
        error: localized(locale, {
          ru: "Запрос на удаление уже зарегистрирован.",
          uz: "O‘chirish so‘rovi allaqachon ro‘yxatdan o‘tgan.",
          en: "An account deletion request has already been submitted.",
        }),
        request: result.request,
      },
      409,
    );
  }
  const values: Record<
    Exclude<typeof result.status, "existing_request">,
    [number, string, string, string, string]
  > = {
    invalid: [
      400,
      "DELETION_CODE_INVALID",
      "Проверка недействительна.",
      "Tekshiruv yaroqsiz.",
      "The verification is invalid.",
    ],
    used: [
      409,
      "DELETION_CODE_USED",
      "Этот код уже использован.",
      "Bu kod allaqachon ishlatilgan.",
      "This code has already been used.",
    ],
    replaced: [
      400,
      "DELETION_CODE_REPLACED",
      "Код заменён новым. Используйте последнее письмо.",
      "Kod yangisi bilan almashtirilgan. Oxirgi xatdan foydalaning.",
      "A newer code has been issued. Use the most recent email.",
    ],
    expired: [
      400,
      "DELETION_CODE_EXPIRED",
      "Срок действия кода истёк.",
      "Kod muddati tugagan.",
      "This code has expired.",
    ],
    attempts_exceeded: [
      429,
      "DELETION_ATTEMPTS_EXCEEDED",
      "Попытки закончились. Запросите новый код.",
      "Urinishlar tugadi. Yangi kod so‘rang.",
      "No attempts remain. Request a new code.",
    ],
    incorrect: [
      400,
      "DELETION_CODE_INCORRECT",
      "Неверный код.",
      "Kod noto‘g‘ri.",
      "The code is incorrect.",
    ],
  };
  const [status, code, ruMessage, uzMessage, enMessage] = values[result.status];
  return jsonNoStore(
    {
      code,
      error: localized(locale, { ru: ruMessage, uz: uzMessage, en: enMessage }),
      ...(result.status === "incorrect"
        ? {
            attemptsRemaining: Math.max(
              0,
              result.maxAttempts - result.attemptCount,
            ),
          }
        : {}),
    },
    status,
  );
}

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const parsed = await parseJsonRequest(request, accountDeletionInputSchema);
  if (!parsed.ok) return invalidInputResponse(request, parsed.error);
  const body = parsed.data;
  const locale = body.locale;
  let session;
  try {
    session = await localSessionForRequest(request, {
      recent: true,
      minimumAssurance: "primary",
    });
  } catch (error) {
    const response = authErrorResponse(error, locale);
    if (response) return response;
    throw error;
  }

  const db = requireD1();
  const env = runtimeEnv();
  const identityKeyring = env.IDENTITY_KEYRING;
  if (!identityKeyring) {
    return jsonNoStore(
      {
        code: "IDENTITY_KEYRING_UNAVAILABLE",
        error: localized(locale, {
          ru: "Защищённое удаление аккаунта временно недоступно.",
          uz: "Hisobni himoyalangan tarzda o‘chirish vaqtincha mavjud emas.",
          en: "Secure account deletion is temporarily unavailable.",
        }),
      },
      503,
    );
  }
  const identityContext = runtimeIdentityProtection();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  if (body.action === "request_code") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return jsonNoStore(
        {
          code: "EMAIL_NOT_CONFIGURED",
          error: localized(locale, {
            ru: "Отправка кода временно не настроена.",
            uz: "Kod yuborish vaqtincha sozlanmagan.",
            en: "Code delivery is temporarily unavailable.",
          }),
        },
        503,
      );
    }
    const id = crypto.randomUUID();
    const code = randomOtp();
    const salt = randomToken(16);
    const reservation = await reserveAccountDeletionChallenge(db, {
      identityContext,
      id,
      userId: session.userId,
      sessionId: session.sessionId,
      email: session.email,
      locale,
      codeSalt: salt,
      code,
      expiresAt: new Date(nowMs + CHALLENGE_TTL_MS).toISOString(),
      now,
      recentSince: new Date(nowMs - RECENT_SESSION_MS).toISOString(),
      cooldownSince: new Date(nowMs - 60 * 1_000).toISOString(),
      hourlySince: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
    });
    if (reservation.status === "existing_request") {
      return confirmationError(reservation, locale);
    }
    if (reservation.status === "blocked") {
      const latest = reservation.latestActiveCreatedAt
        ? Date.parse(reservation.latestActiveCreatedAt)
        : Number.NaN;
      const retryAfterSeconds = Number.isFinite(latest)
        ? Math.max(0, 60 - Math.floor((nowMs - latest) / 1_000))
        : 0;
      if (retryAfterSeconds > 0) {
        return jsonNoStore(
          {
            code: "DELETION_CODE_COOLDOWN",
            retryAfterSeconds,
            error: localized(locale, {
              ru: `Новый код можно запросить через ${retryAfterSeconds} сек.`,
              uz: `Yangi kodni ${retryAfterSeconds} soniyadan keyin so‘rash mumkin.`,
              en: `You can request a new code in ${retryAfterSeconds} seconds.`,
            }),
          },
          429,
        );
      }
      return jsonNoStore(
        {
          code: "DELETION_CODE_RATE_LIMIT",
          error: localized(locale, {
            ru: "Слишком много запросов. Попробуйте позже.",
            uz: "Juda ko‘p so‘rov. Keyinroq urinib ko‘ring.",
            en: "Too many requests. Try again later.",
          }),
        },
        429,
      );
    }

    const message = renderJuroAuthEmail({
      locale,
      purpose: "account_deletion",
      code,
    });
    const sent = await sendJuroAuthEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      to: session.email,
      idempotencyKey: `juro_account_deletion_${id}`,
      message,
    });
    if (!sent.ok) {
      await invalidateAccountDeletionChallenge(db, {
        id,
        userId: session.userId,
        sessionId: session.sessionId,
        invalidatedAt: new Date().toISOString(),
      });
      return jsonNoStore(
        {
          code: "EMAIL_PROVIDER_ERROR",
          error: localized(locale, {
            ru: "Не удалось отправить письмо. Попробуйте позже.",
            uz: "Xat yuborilmadi. Keyinroq urinib ko‘ring.",
            en: "We could not send the email. Try again later.",
          }),
        },
        502,
      );
    }
    return jsonNoStore({
      ok: true,
      challengeId: id,
      expiresInSeconds: CHALLENGE_TTL_MS / 1_000,
      resendAfterSeconds: 60,
      destination: maskedEmail(session.email),
    });
  }

  const workspaceId = await ensureDefaultWorkspace(session.userId);
  if (body.action === "cancel") {
    const result = await cancelAccountDeletionRequest(db, {
      requestId: body.requestId,
      userId: session.userId,
      sessionId: session.sessionId,
      workspaceId,
      identityKeyring,
      assuranceLevel: session.assuranceLevel,
      now,
    });
    if (
      result.status === "cancelled" ||
      result.status === "already_cancelled"
    ) {
      return jsonNoStore({
        ok: true,
        requestId: body.requestId,
        status: "cancelled",
      });
    }
    const code =
      result.status === "completed"
        ? "DELETION_ALREADY_COMPLETED"
        : result.status === "not_cancelable"
          ? "DELETION_NOT_CANCELABLE"
          : "DELETION_REQUEST_INVALID";
    return jsonNoStore(
      {
        code,
        error: localized(locale, result.status === "completed"
          ? {
              ru: "Удаление аккаунта уже завершено.",
              uz: "Hisobni o‘chirish allaqachon yakunlangan.",
              en: "Account deletion has already been completed.",
            }
          : result.status === "not_cancelable"
            ? {
                ru: "Этот запрос уже нельзя отменить.",
                uz: "Bu so‘rovni endi bekor qilib bo‘lmaydi.",
                en: "This request can no longer be cancelled.",
              }
            : {
                ru: "Запрос удаления не найден.",
                uz: "O‘chirish so‘rovi topilmadi.",
                en: "The account deletion request was not found.",
              }),
      },
      result.status === "completed"
        ? 410
        : result.status === "invalid"
          ? 404
          : 409,
    );
  }

  if (body.action === "retry") {
    const result = await retryAccountDeletionRequest(db, {
      requestId: body.requestId,
      userId: session.userId,
      sessionId: session.sessionId,
      workspaceId,
      identityKeyring,
      assuranceLevel: session.assuranceLevel,
      now,
    });
    if (result.status === "retried" || result.status === "already_queued") {
      await dispatchOutbox({ ...env, DB: db }, 1, body.requestId);
      return jsonNoStore(
        {
          ok: true,
          requestId: body.requestId,
          status: "scheduled",
          logout: true,
        },
        200,
        sessionCookiesToClear(request),
      );
    }
    const code =
      result.status === "completed"
        ? "DELETION_ALREADY_COMPLETED"
        : result.status === "not_retryable"
          ? "DELETION_NOT_RETRYABLE"
          : "DELETION_REQUEST_INVALID";
    return jsonNoStore(
      {
        code,
        error: localized(locale, result.status === "completed"
          ? {
              ru: "Удаление аккаунта уже завершено.",
              uz: "Hisobni o‘chirish allaqachon yakunlangan.",
              en: "Account deletion has already been completed.",
            }
          : result.status === "not_retryable"
            ? {
                ru: "Этот запрос сейчас нельзя запустить повторно.",
                uz: "Bu so‘rovni hozir qayta ishga tushirib bo‘lmaydi.",
                en: "This request cannot be retried at the moment.",
              }
            : {
                ru: "Запрос удаления не найден.",
                uz: "O‘chirish so‘rovi topilmadi.",
                en: "The account deletion request was not found.",
              }),
      },
      result.status === "completed"
        ? 410
        : result.status === "invalid"
          ? 404
          : 409,
    );
  }
  const deletionSubject = await accountDeletionSubjectHash(
    identityKeyring,
    session.userId,
  );
  const scheduledPurgeAt = new Date(
    nowMs +
      (body.deletionMode === "recoverable_30d"
        ? RECOVERABLE_DELETION_DELAY_MS
        : 0),
  ).toISOString();
  const result = await confirmAccountDeletion(db, {
    identityContext,
    challengeId: body.challengeId,
    userId: session.userId,
    sessionId: session.sessionId,
    email: session.email,
    workspaceId,
    code: body.code,
    reason: body.reason || null,
    deletionMode: body.deletionMode,
    scheduledPurgeAt,
    subjectHash: deletionSubject.hash,
    subjectKeyVersion: deletionSubject.keyVersion,
    assuranceLevel: session.assuranceLevel,
    now,
    recentSince: new Date(nowMs - RECENT_SESSION_MS).toISOString(),
  });
  if (result.status !== "confirmed") {
    return confirmationError(result, locale);
  }
  if (body.deletionMode === "immediate") {
    await dispatchOutbox({ ...env, DB: db }, 1, result.requestId);
  }
  return jsonNoStore(
    {
      ok: true,
      requestId: result.requestId,
      status: "scheduled",
      deletionMode: result.deletionMode,
      scheduledPurgeAt: result.scheduledPurgeAt,
      logout: true,
      revokedSessions: result.revokedSessions,
    },
    201,
    sessionCookiesToClear(request),
  );
});
