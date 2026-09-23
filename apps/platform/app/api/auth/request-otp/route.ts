import { normalizeEmail, randomOtp, randomToken } from "../../../../lib/auth/crypto";
import {
  prepareUserIdentityWrite,
  userIdByEmail,
  userIdentityWriteBindings,
} from "../../../../lib/auth/identity-protection";
import { runtimeIdentityProtection } from "../../../../lib/auth/identity-runtime";
import { localizedRequestFormatError } from "../../../../lib/auth/request-locale";
import {
  parseJsonRequest,
  requestOtpInputSchema,
} from "../../../../lib/auth/input";
import { reserveOtpChallenge } from "../../../../lib/auth/otp-request";
import {
  completePasswordLoginAttempt,
  failPasswordLoginAttempt,
  passwordCredentialWriteStatement,
  passwordCredentialForUser,
  passwordLoginRateLimit,
  preparePasswordCredential,
  reservePasswordLoginAttempt,
  verifyPassword,
} from "../../../../lib/auth/password";
import {
  pendingRegistrationUpsertStatement,
} from "../../../../lib/auth/registration-retention";
import {
  authTurnstileActions,
  validateAuthTurnstile,
} from "../../../../lib/auth/turnstile";
import {
  renderJuroAuthEmail,
  sendJuroAuthEmail,
} from "../../../../lib/auth/transactional-email";
import {
  assertSafeWrite,
  withApiErrors,
} from "../../../../lib/document-builder/auth/api";
import { requireD1, runtimeEnv } from "../../../../lib/document-builder/storage/runtime";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthLocale = "ru" | "uz" | "en";

function localized(
  locale: AuthLocale,
  values: { ru: string; uz: string; en: string },
): string {
  return values[locale];
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const parsed = await parseJsonRequest(request, requestOtpInputSchema);
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
  const { purpose, locale, accountType } = parsed.data;
  const env = runtimeEnv();
  if (
    !env.RESEND_API_KEY || !env.EMAIL_FROM || !env.TURNSTILE_SECRET_KEY
  ) {
    return json({
      error: localized(locale, {
        ru: "Защищённый вход временно не настроен.",
        uz: "Himoyalangan kirish vaqtincha sozlanmagan.",
        en: "Secure sign-in is temporarily unavailable.",
      }),
    }, 503);
  }
  const email = normalizeEmail(parsed.data.email);
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: localized(locale, {
    ru: "Проверьте адрес электронной почты.",
    uz: "Elektron pochta manzilini tekshiring.",
    en: "Check the email address.",
  }) }, 400);

  const db = requireD1();
  const identityContext = runtimeIdentityProtection();
  const connectingIp = request.headers.get("x-juro-client-ip")?.trim() || null;
  const turnstile = await validateAuthTurnstile({
    secretKey: env.TURNSTILE_SECRET_KEY,
    token: parsed.data.turnstileToken,
    remoteIp: connectingIp,
    expectedHostname: new URL(request.url).hostname,
    expectedActions: purpose === "register"
      ? [authTurnstileActions.registration]
      : purpose === "registration_resend"
        ? [authTurnstileActions.registrationResend]
        : [
          authTurnstileActions.passwordReset,
          authTurnstileActions.passwordResetResend,
        ],
  });
  if (turnstile.status !== "verified") {
    const unavailable = turnstile.status === "unavailable";
    return json({
      code: unavailable ? "TURNSTILE_UNAVAILABLE" : "TURNSTILE_INVALID",
      error: localized(locale, unavailable ? {
        ru: "Проверка безопасности временно недоступна. Повторите позже.",
        uz: "Xavfsizlik tekshiruvi vaqtincha mavjud emas. Keyinroq urinib ko‘ring.",
        en: "The security check is temporarily unavailable. Try again later.",
      } : {
        ru: "Подтвердите проверку безопасности и повторите.",
        uz: "Xavfsizlik tekshiruvini tasdiqlab, qayta urinib ko‘ring.",
        en: "Complete the security check and try again.",
      }),
    }, unavailable ? 503 : 400);
  }
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const id = crypto.randomUUID();
  let challengeAccountType = accountType;

  if (purpose === "registration_resend") {
    const passwordLimit = await passwordLoginRateLimit(db, {
      email,
      requestIp: connectingIp,
    });
    if (!passwordLimit.allowed) {
      return json({
        code: "AUTH_RATE_LIMITED",
        retryAfterSeconds: passwordLimit.retryAfterSeconds,
        error: localized(locale, {
          ru: "Слишком много запросов. Повторите позднее.",
          uz: "Juda ko‘p so‘rov. Keyinroq qayta urinib ko‘ring.",
          en: "Too many requests. Try again later.",
        }),
      }, 429);
    }
    const attempt = await reservePasswordLoginAttempt(db, {
      email,
      requestIp: connectingIp,
    });
    if (!attempt.allowed) {
      return json({
        code: "AUTH_RATE_LIMITED",
        retryAfterSeconds: attempt.retryAfterSeconds,
        error: localized(locale, {
          ru: "Слишком много запросов. Повторите позднее.",
          uz: "Juda ko‘p so‘rov. Keyinroq qayta urinib ko‘ring.",
          en: "Too many requests. Try again later.",
        }),
      }, 429);
    }

    const existingUserId = await userIdByEmail(db, identityContext, email);
    const existing = existingUserId
      ? await db.prepare(
        `SELECT profile.id,profile.account_type AS accountType,
           profile.email_verified_at AS emailVerifiedAt,
           EXISTS(
             SELECT 1 FROM auth_pending_registrations pending
             WHERE pending.user_id=profile.id AND pending.expires_at>?
           ) AS pendingRegistration
         FROM user_profiles profile WHERE profile.id=? LIMIT 1`,
      ).bind(now, existingUserId).first<{
        id: string;
        accountType: string;
        emailVerifiedAt: string | null;
        pendingRegistration: number | boolean;
      }>()
      : null;
    const credential = existing
      ? await passwordCredentialForUser(db, existing.id)
      : null;
    const authenticated = await verifyPassword(parsed.data.password, credential);
    if (!authenticated || !existing || existing.emailVerifiedAt) {
      if (authenticated) {
        await completePasswordLoginAttempt(db, attempt.reservation);
      } else {
        await failPasswordLoginAttempt(db, attempt.reservation);
      }
      // Keep the public response indistinguishable for missing, verified, and
      // password-mismatched accounts. A real challenge is sent only after the
      // password and pending-registration state are both verified.
      return json({
        ok: true,
        challengeId: id,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
    }
    await completePasswordLoginAttempt(db, attempt.reservation);
    if (
      existing.accountType === "individual"
      || existing.accountType === "entrepreneur"
      || existing.accountType === "lawyer"
    ) {
      challengeAccountType = existing.accountType;
    }
    if (!existing.pendingRegistration) {
      return json({
        code: "REGISTRATION_RESTART_REQUIRED",
        accountType: challengeAccountType,
        error: localized(locale, {
          ru: "Срок регистрации истёк. Продолжите регистрацию заново — существующий аккаунт будет безопасно обновлён.",
          uz: "Ro‘yxatdan o‘tish muddati tugadi. Ro‘yxatdan o‘tishni qayta davom ettiring — mavjud hisob xavfsiz yangilanadi.",
          en: "Your registration session expired. Continue registration again and your existing account will be updated safely.",
        }),
      }, 409);
    }
  }

  // Run the same slow password work for every registration address. The
  // resulting credential is persisted only after the OTP reservation wins,
  // so a cooldown/rate-limited request cannot replace an in-flight user's
  // chosen password while their earlier code remains valid.
  const registrationCredential = purpose === "register"
    ? await preparePasswordCredential(parsed.data.password, new Date(now))
    : null;

  const code = randomOtp();
  const salt = randomToken(16);
  const expiresAt = new Date(nowMs + 10 * 60 * 1000).toISOString();
  const reservation = await reserveOtpChallenge(db, {
    identityContext,
    id,
    email,
    requestIp: connectingIp,
    purpose: purpose === "password_reset" ? "password_reset" : "register",
    locale,
    accountType: challengeAccountType,
    codeSalt: salt,
    code,
    expiresAt,
    now,
    cooldownSince: new Date(nowMs - 60 * 1000).toISOString(),
    hourlySince: new Date(nowMs - 60 * 60 * 1000).toISOString(),
  });
  if (reservation.status === "blocked") {
    const verificationLockTimestamp = reservation.verificationLockedUntil
      ? Date.parse(reservation.verificationLockedUntil)
      : Number.NaN;
    const verificationRetryAfterSeconds = Number.isFinite(
        verificationLockTimestamp,
      )
      ? Math.max(
        1,
        Math.ceil((verificationLockTimestamp - nowMs) / 1000),
      )
      : 0;
    if (verificationRetryAfterSeconds > 0) {
      return json({
        code: "OTP_VERIFICATION_LOCKED",
        retryAfterSeconds: verificationRetryAfterSeconds,
        error: localized(locale, {
          ru: "Слишком много неверных попыток. Повторите через 15 минут.",
          uz: "Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring.",
          en: "Too many incorrect attempts. Try again in 15 minutes.",
        }),
      }, 429);
    }
    const latestTimestamp = reservation.latestActiveCreatedAt
      ? Date.parse(reservation.latestActiveCreatedAt)
      : Number.NaN;
    const retryAfterSeconds = Number.isFinite(latestTimestamp)
      ? Math.max(0, 60 - Math.floor((nowMs - latestTimestamp) / 1000))
      : 0;
    if (retryAfterSeconds > 0) {
      return json({
        code: "OTP_COOLDOWN",
        retryAfterSeconds,
        error: localized(locale, {
          ru: `Новый код можно запросить через ${retryAfterSeconds} сек.`,
          uz: `Yangi kodni ${retryAfterSeconds} soniyadan keyin so‘rash mumkin.`,
          en: `You can request a new code in ${retryAfterSeconds} seconds.`,
        }),
      }, 429);
    }
    return json({
      code: "OTP_RATE_LIMIT",
      error: localized(locale, {
        ru: "Слишком много запросов. Попробуйте позже.",
        uz: "Juda ko‘p so‘rov. Keyinroq urinib ko‘ring.",
        en: "Too many requests. Try again later.",
      }),
    }, 429);
  }

  if (purpose === "register" && registrationCredential) {
    try {
      const existingUserId = await userIdByEmail(db, identityContext, email);
      const existing = existingUserId
        ? await db.prepare(
          `SELECT id,email_verified_at AS emailVerifiedAt
           FROM user_profiles WHERE id=? LIMIT 1`,
        ).bind(existingUserId).first<{
          id: string;
          emailVerifiedAt: string | null;
        }>()
        : null;
      if (!existing?.emailVerifiedAt) {
        const userId = existing?.id ?? crypto.randomUUID();
        const fullName = [parsed.data.firstName, parsed.data.lastName]
          .filter(Boolean)
          .join(" ")
          .trim()
          .slice(0, 160);
        const unverifiedGuard = {
          selectSql: `SELECT 1 FROM user_profiles
            WHERE id=? AND email_verified_at IS NULL`,
          bindings: [userId],
        };
        const statements: D1PreparedStatement[] = [];
        if (existing) {
          statements.push(db.prepare(
            `UPDATE user_profiles
             SET full_name=?,locale=?,account_type=?,updated_at=?
             WHERE id=? AND email_verified_at IS NULL`,
          ).bind(fullName, locale, accountType, now, userId));
        } else {
          const identity = await prepareUserIdentityWrite(identityContext, {
            userId,
            email,
            phone: null,
          });
          statements.push(db.prepare(
            `INSERT INTO user_profiles (
               id,email,email_ciphertext,email_iv,email_key_version,
               email_lookup_hash,email_lookup_key_version,
               phone,phone_ciphertext,phone_iv,phone_key_version,
               phone_lookup_hash,phone_lookup_key_version,
               full_name,locale,account_type,company_name,
               onboarding_completed_at,email_verified_at,created_at,updated_at
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
          ).bind(
            userId,
            ...userIdentityWriteBindings(identity),
            fullName,
            locale,
            accountType,
            null,
            now,
            now,
          ));
        }
        statements.push(passwordCredentialWriteStatement(
          db,
          userId,
          registrationCredential,
          unverifiedGuard,
        ));
        statements.push(pendingRegistrationUpsertStatement(db, {
          userId,
          now,
        }));
        await db.batch(statements);
      }
    } catch (error) {
      await db.prepare(
        `UPDATE auth_otp_challenges SET invalidated_at=?
         WHERE id=? AND consumed_at IS NULL AND invalidated_at IS NULL`,
      ).bind(new Date().toISOString(), id).run();
      throw error;
    }
  }

  const message = renderJuroAuthEmail({
    locale,
    purpose: purpose === "register" || purpose === "registration_resend"
      ? "registration"
      : "password_reset",
    code,
  });
  const sent = await sendJuroAuthEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: email,
    idempotencyKey: `juro_otp_${id}`,
    message,
  });
  if (!sent.ok) {
    console.error(JSON.stringify({
      event: "auth_otp_email_delivery_failed",
      provider: "resend",
      purpose,
      attempts: sent.attempts,
      failure: sent.failure,
      providerStatus: sent.providerStatus,
    }));
    await db.prepare("UPDATE auth_otp_challenges SET invalidated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return json({ code: "EMAIL_PROVIDER_ERROR", error: localized(locale, {
      ru: "Не удалось отправить письмо. Попробуйте позже.",
      uz: "Xat yuborilmadi. Keyinroq urinib ko‘ring.",
      en: "The email could not be sent. Try again later.",
    }) }, 502);
  }
  return json({
    ok: true,
    challengeId: id,
    expiresInSeconds: 600,
    resendAfterSeconds: 60,
    ...(purpose === "registration_resend"
      ? { accountType: challengeAccountType }
      : {}),
  });
});
