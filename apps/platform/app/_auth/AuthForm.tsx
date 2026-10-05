"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ThemeSwitcher } from "../_theme/ThemeSwitcher";
import {
  consentFieldError,
  emailFieldError,
  firstNameFieldError,
  type AuthFieldErrorCode,
} from "./auth-field-validation";
import { TurnstileWidget } from "./TurnstileWidget";
import { AuthRequestTimeoutError, requestAuthJson } from "./auth-request";

type AccountType = "individual" | "entrepreneur" | "lawyer";
type Locale = "ru" | "uz" | "en";
type Step = "details" | "verification-request" | "verification" | "mfa" | "recovery-request" | "recovery-code" | "recovery-success";

type Props = {
  mode: "login" | "register";
  initialLocale: Locale;
  initialAccountType?: AccountType;
  returnTo?: string;
  passwordAuthEnabled: boolean;
  emailAuthEnabled: boolean;
  platformAuthEnabled: boolean;
  developmentAuthEnabled: boolean;
  turnstileSiteKey?: string;
};

type Handoff = {
  action: string;
  ticket: string;
  expiresAt: string;
};

type AuthResponse = {
  accountType?: AccountType;
  challengeId?: string;
  expiresInSeconds?: number;
  resendAfterSeconds?: number;
  retryAfterSeconds?: number;
  redirectTo?: string;
  requiresTwoFactor?: boolean;
  handoff?: Handoff | null;
  message?: string;
  error?: string;
  code?: string;
};

type Copy = { ru: string; uz: string; en: string };

const AUTH_HANDOFF_ACTIONS = new Set([
  "https://app.juro.uz/api/auth/session-handoff",
  "https://lawyer.juro.uz/api/auth/session-handoff",
]);
const AUTH_HANDOFF_LOCALES = new Set<Locale>(["ru", "uz", "en"]);

function copy(locale: Locale, value: Copy): string {
  return value[locale];
}

function fieldErrorMessage(
  locale: Locale,
  code: AuthFieldErrorCode | null,
): string | null {
  if (!code) return null;
  const messages: Record<AuthFieldErrorCode, Copy> = {
    email_required: {
      ru: "Укажите электронную почту.",
      uz: "Elektron pochta manzilini kiriting.",
      en: "Enter your email address.",
    },
    email_invalid: {
      ru: "Проверьте формат электронной почты.",
      uz: "Elektron pochta manzili formatini tekshiring.",
      en: "Check the email address format.",
    },
    first_name_required: {
      ru: "Укажите имя.",
      uz: "Ismingizni kiriting.",
      en: "Enter your first name.",
    },
    consent_required: {
      ru: "Подтвердите обязательное согласие.",
      uz: "Majburiy rozilikni tasdiqlang.",
      en: "Confirm this required consent.",
    },
  };
  return copy(locale, messages[code]);
}

function safeReturnPath(value?: string): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://app.juro.uz");
    if (url.origin !== "https://app.juro.uz") return null;
    if (["/login", "/register", "/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(url.pathname)) return null;
    if (/^\/(?:ru|uz|en)\/auth\/(?:login|register)\/?$/u.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function normalizeEmailInput(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function passwordScore(password: string): number {
  if (!password) return 0;
  let score = password.length >= 8 ? 1 : 0;
  if (password.length >= 12) score += 1;
  if (/\p{Ll}/u.test(password) && /\p{Lu}/u.test(password)) score += 1;
  if (/\d/u.test(password) || /[^\p{L}\d\s]/u.test(password)) score += 1;
  return Math.min(4, score);
}

function validHandoff(handoff: Handoff): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(handoff.ticket)) return false;
  const expiresAt = Date.parse(handoff.expiresAt);
  // The receiving server is authoritative for expiry. Client clocks can be
  // wrong, so only reject malformed timestamps here.
  if (!Number.isFinite(expiresAt)) return false;
  try {
    const action = new URL(handoff.action);
    const locale = action.searchParams.get("lang");
    const canonicalAction = `${action.origin}${action.pathname}`;
    return !action.username
      && !action.password
      && !action.hash
      && action.searchParams.size === 1
      && locale !== null
      && AUTH_HANDOFF_LOCALES.has(locale as Locale)
      && AUTH_HANDOFF_ACTIONS.has(canonicalAction);
  } catch {
    return false;
  }
}

function safeAuthenticationDestination(value?: string): string | null {
  if (!value) return null;
  try {
    const destination = new URL(value, window.location.origin);
    const sameOrigin = destination.origin === window.location.origin;
    const safeRelativePath = value.startsWith("/") && !value.startsWith("//");
    const absoluteSameOrigin = /^https?:\/\//u.test(value) && sameOrigin;
    if (
      destination.username
      || destination.password
      || (!safeRelativePath && !absoluteSameOrigin)
    ) return null;
    return safeRelativePath
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : destination.href;
  } catch {
    return null;
  }
}

function submitHandoff(handoff: Handoff): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = handoff.action;
  form.style.display = "none";
  form.referrerPolicy = "no-referrer";
  const ticket = document.createElement("input");
  ticket.type = "hidden";
  ticket.name = "ticket";
  ticket.value = handoff.ticket;
  form.appendChild(ticket);
  document.body.appendChild(form);
  form.submit();
}

function PasswordField({
  locale,
  id,
  name,
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid = false,
  disabled = false,
}: {
  locale: Locale;
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const tooLong = value.length > 256;
  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState("CapsLock"));
  };
  const capsLockId = `${id}-caps-lock`;
  const tooLongId = `${id}-too-long`;
  const descriptionIds = [describedBy, capsLock ? capsLockId : null, tooLong ? tooLongId : null]
    .filter(Boolean)
    .join(" ") || undefined;
  const toggleLabel = visible
    ? copy(locale, { ru: "Скрыть пароль", uz: "Parolni yashirish", en: "Hide password" })
    : copy(locale, { ru: "Показать пароль", uz: "Parolni ko‘rsatish", en: "Show password" });
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <span className="auth-password-control">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          required
          minLength={8}
          autoComplete={autoComplete}
          aria-describedby={descriptionIds}
          aria-invalid={invalid || tooLong || undefined}
          disabled={disabled}
        />
        <button
          type="button"
          className="auth-password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-controls={id}
          aria-label={toggleLabel}
          aria-pressed={visible}
          disabled={disabled}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </span>
      {capsLock && <small id={capsLockId} className="auth-caps" role="status">{copy(locale, {
        ru: "Включён Caps Lock",
        uz: "Caps Lock yoqilgan",
        en: "Caps Lock is on",
      })}</small>}
      {tooLong && <small id={tooLongId} className="auth-field-error" role="alert">{copy(locale, {
        ru: "Максимум 256 символов. Введённое значение не было обрезано.",
        uz: "Ko‘pi bilan 256 ta belgi. Kiritilgan qiymat qisqartirilmadi.",
        en: "Maximum 256 characters. Your value was not truncated.",
      })}</small>}
    </div>
  );
}

export function AuthForm({
  mode,
  initialLocale,
  initialAccountType = "individual",
  returnTo,
  passwordAuthEnabled,
  emailAuthEnabled,
  platformAuthEnabled,
  developmentAuthEnabled,
  turnstileSiteKey,
}: Props) {
  const locale = initialLocale;
  const tr = (value: Copy) => copy(locale, value);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const seededEmail = normalizeEmailInput(searchParams.get("email")?.slice(0, 254) ?? "");
  const [accountType, setAccountType] = useState<AccountType>(initialAccountType);
  const [step, setStep] = useState<Step>("details");
  const [challengeId, setChallengeId] = useState("");
  const [challengeEmail, setChallengeEmail] = useState("");
  const [challengeAccountType, setChallengeAccountType] = useState<AccountType>(initialAccountType);
  const [email, setEmail] = useState(seededEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [registrationRestartMessage, setRegistrationRestartMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [validationAttemptedFor, setValidationAttemptedFor] = useState<Step | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [firstNameTouched, setFirstNameTouched] = useState(false);
  const [termsTouched, setTermsTouched] = useState(false);
  const [privacyTouched, setPrivacyTouched] = useState(false);
  const previousStep = useRef(step);
  const emailInput = useRef<HTMLInputElement>(null);
  const firstNameInput = useRef<HTMLInputElement>(null);
  const termsInput = useRef<HTMLInputElement>(null);
  const privacyInput = useRef<HTMLInputElement>(null);
  const otpInput = useRef<HTMLInputElement>(null);
  const mfaInput = useRef<HTMLInputElement>(null);
  const verificationRequestHeading = useRef<HTMLHeadingElement>(null);
  const requestGeneration = useRef(0);
  const successPanel = useRef<HTMLDivElement>(null);
  const lawyerProduct = initialAccountType === "lawyer";
  const explicitReturnTo = safeReturnPath(returnTo);
  const protectedReturnTo = explicitReturnTo ?? "/";
  const strength = passwordScore(password);
  const passwordsMatch = password === confirmPassword;
  const passwordValid = password.length >= 8 && password.length <= 256;
  const currentEmailError = fieldErrorMessage(locale, emailFieldError(email));
  const currentFirstNameError = fieldErrorMessage(
    locale,
    firstNameFieldError(firstName),
  );
  const currentTermsError = fieldErrorMessage(
    locale,
    consentFieldError(acceptTerms),
  );
  const currentPrivacyError = fieldErrorMessage(
    locale,
    consentFieldError(acceptPrivacy),
  );
  const emailError = emailTouched || validationAttemptedFor === step
    ? currentEmailError
    : null;
  const firstNameError = firstNameTouched || validationAttemptedFor === step
    ? currentFirstNameError
    : null;
  const termsError = termsTouched || validationAttemptedFor === step
    ? currentTermsError
    : null;
  const privacyError = privacyTouched || validationAttemptedFor === step
    ? currentPrivacyError
    : null;
  const legalLocale = locale;
  const authNotice = authenticationNotice({
    locale,
    logout: searchParams.get("logout"),
    session: searchParams.get("session") ?? searchParams.get("reason"),
    handoff: searchParams.get("handoff"),
  });
  const masked = useMemo(() => {
    const visibleEmail = challengeEmail || email;
    const [name, domain] = visibleEmail.split("@");
    return domain ? `${name.slice(0, 2)}•••@${domain}` : visibleEmail;
  }, [challengeEmail, email]);
  const registrationRestartHref = `/${locale}/auth/register?email=${encodeURIComponent(challengeEmail || normalizeEmailInput(email))}&accountType=${challengeAccountType}`;

  const localeHref = (nextLocale: Locale): string => {
    const localePath = pathname.replace(/^\/(?:ru|uz|en)(?=\/|$)/u, `/${nextLocale}`);
    const targetPath = localePath === pathname ? `/${nextLocale}/auth/${mode}` : localePath;
    const query = searchParams.toString();
    return query ? `${targetPath}?${query}` : targetPath;
  };

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => () => {
    requestGeneration.current += 1;
  }, []);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    if (step === "recovery-success") {
      successPanel.current?.focus();
      return;
    }
    if (step === "verification-request") {
      verificationRequestHeading.current?.focus();
      return;
    }
    const target = step === "details" || step === "recovery-request"
      ? emailInput.current
      : step === "verification" || step === "recovery-code"
        ? otpInput.current
        : step === "mfa"
          ? mfaInput.current
          : null;
    target?.focus();
  }, [step]);

  function resetTurnstile() {
    setTurnstileToken("");
    setTurnstileReset((value) => value + 1);
  }

  function clearFeedback() {
    setError("");
    setSuccessMessage("");
    setRegistrationRestartMessage("");
  }

  function returnToDetails() {
    requestGeneration.current += 1;
    setPending(false);
    clearFeedback();
    setStep("details");
    setChallengeId("");
    setChallengeEmail("");
    setChallengeAccountType(initialAccountType);
    setCode("");
    setMfaCode("");
    setCooldown(0);
    setValidationAttemptedFor(null);
    resetTurnstile();
  }

  function completeAuthentication(data: AuthResponse) {
    if (data.handoff) {
      if (!validHandoff(data.handoff)) {
        throw new Error(tr({
          ru: "Сервер вернул недействительный маршрут передачи сессии.",
          uz: "Server sessiyani uzatish uchun yaroqsiz yo‘l qaytardi.",
          en: "The server returned an invalid session handoff destination.",
        }));
      }
      submitHandoff(data.handoff);
      return;
    }
    const destination = safeAuthenticationDestination(data.redirectTo);
    if (!destination) {
      throw new Error(tr({
        ru: "Сервер не вернул безопасный маршрут продолжения.",
        uz: "Server xavfsiz davom etish yo‘lini qaytarmadi.",
        en: "The server did not return a safe destination.",
      }));
    }
    window.location.replace(destination);
  }

  async function requestAuthentication(url: string, init: RequestInit) {
    try {
      return await requestAuthJson<AuthResponse>(url, init);
    } catch (error) {
      if (error instanceof AuthRequestTimeoutError) {
        throw new Error(tr({
          ru: "Время ожидания истекло. Проверьте соединение и повторите попытку.",
          uz: "Kutish vaqti tugadi. Ulanishni tekshiring va qayta urinib ko‘ring.",
          en: "The request timed out. Check your connection and try again.",
        }));
      }
      if (error instanceof TypeError) {
        throw new Error(tr({
          ru: "Не удалось подключиться. Проверьте соединение и повторите попытку.",
          uz: "Ulanib bo‘lmadi. Ulanishni tekshiring va qayta urinib ko‘ring.",
          en: "Could not connect. Check your connection and try again.",
        }));
      }
      throw error;
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    setValidationAttemptedFor("details");
    const normalizedEmail = normalizeEmailInput(email);
    setEmail(normalizedEmail);
    if (emailFieldError(normalizedEmail)) {
      emailInput.current?.focus();
      return;
    }
    if (!turnstileToken) {
      setError(tr({ ru: "Дождитесь завершения проверки безопасности.", uz: "Xavfsizlik tekshiruvi tugashini kuting.", en: "Wait for the security check to finish." }));
      return;
    }
    setPending(true);
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    try {
      const { response, data } = await requestAuthentication("/api/auth/password-login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale },
        body: JSON.stringify({ email: normalizedEmail, password, locale, rememberMe, turnstileToken }),
      });
      if (requestGeneration.current !== generation) return;
      if (!response.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED") {
          setError("");
          setValidationAttemptedFor(null);
          setChallengeEmail(normalizedEmail);
          setChallengeAccountType(accountType);
          setStep("verification-request");
          return;
        }
        throw new Error(data.error || tr({ ru: "Не удалось войти. Проверьте электронную почту и пароль.", uz: "Kirish amalga oshmadi. Email va parolni tekshiring.", en: "We could not sign you in. Check your email and password." }));
      }
      if (data.requiresTwoFactor) {
        setMfaCode("");
        setStep("mfa");
        return;
      }
      completeAuthentication(data);
    } catch (value) {
      if (requestGeneration.current !== generation) return;
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      if (requestGeneration.current === generation) {
        resetTurnstile();
        setPending(false);
      }
    }
  }

  async function requestEmailCode(
    purpose: "register" | "registration_resend" | "password_reset",
  ) {
    clearFeedback();
    if (!emailAuthEnabled || !turnstileToken) {
      setError(tr({ ru: "Дождитесь завершения проверки безопасности.", uz: "Xavfsizlik tekshiruvi tugashini kuting.", en: "Wait for the security check to finish." }));
      return;
    }
    if (purpose === "register" && (!passwordValid || !passwordsMatch)) {
      setError(tr({ ru: "Проверьте пароль и его подтверждение.", uz: "Parol va uning tasdig‘ini tekshiring.", en: "Check the password and its confirmation." }));
      return;
    }
    setPending(true);
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const normalizedEmail = purpose === "registration_resend" && challengeEmail
      ? challengeEmail
      : normalizeEmailInput(email);
    const requestedAccountType = purpose === "registration_resend"
      ? challengeAccountType
      : accountType;
    setEmail(normalizedEmail);
    try {
      const body = purpose === "register"
        ? {
            purpose,
            email: normalizedEmail,
            locale,
            accountType: requestedAccountType,
            password,
            firstName: firstName.trim(),
            lastName: lastName.trim() || undefined,
            acceptTerms,
            acceptPrivacy,
            acceptPersonalData: acceptPrivacy,
            marketing: false,
            turnstileToken,
          }
        : purpose === "registration_resend"
          ? {
              purpose,
              email: normalizedEmail,
              locale,
              accountType: requestedAccountType,
              password,
              acceptTerms,
              acceptPrivacy,
              acceptPersonalData: acceptPrivacy,
              turnstileToken,
            }
        : { purpose, email: normalizedEmail, locale, accountType: requestedAccountType, turnstileToken };
      const { response, data } = await requestAuthentication("/api/auth/request-otp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale },
        body: JSON.stringify(body),
      });
      if (requestGeneration.current !== generation) return;
      if (!response.ok || !data.challengeId) {
        if (purpose === "registration_resend" && data.code === "REGISTRATION_RESTART_REQUIRED") {
          const authoritativeAccountType = data.accountType;
          if (authoritativeAccountType === "individual" || authoritativeAccountType === "entrepreneur" || authoritativeAccountType === "lawyer") {
            setChallengeAccountType(authoritativeAccountType);
          }
          setChallengeEmail(normalizedEmail);
          setChallengeId("");
          setCode("");
          setCooldown(0);
          setRegistrationRestartMessage(data.error || tr({
            ru: "Срок регистрации истёк. Продолжите регистрацию заново — новый аккаунт создан не будет.",
            uz: "Ro‘yxatdan o‘tish muddati tugadi. Ro‘yxatdan o‘tishni qayta davom ettiring — yangi hisob yaratilmaydi.",
            en: "Your registration session expired. Continue registration again; no duplicate account will be created.",
          }));
          setStep("verification-request");
          return;
        }
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds);
        throw new Error(data.error || tr({ ru: "Не удалось отправить письмо.", uz: "Xatni yuborib bo‘lmadi.", en: "The email could not be sent." }));
      }
      setChallengeId(data.challengeId);
      setChallengeEmail(normalizedEmail);
      if (data.accountType === "individual" || data.accountType === "entrepreneur" || data.accountType === "lawyer") {
        setChallengeAccountType(data.accountType);
      } else {
        setChallengeAccountType(requestedAccountType);
      }
      setCode("");
      setStep(purpose === "password_reset" ? "recovery-code" : "verification");
      setCooldown(data.resendAfterSeconds ?? 60);
    } catch (value) {
      if (requestGeneration.current !== generation) return;
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      if (requestGeneration.current === generation) {
        resetTurnstile();
        setPending(false);
      }
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    setValidationAttemptedFor("details");
    const normalizedEmail = normalizeEmailInput(email);
    setEmail(normalizedEmail);
    if (firstNameFieldError(firstName)) {
      firstNameInput.current?.focus();
      return;
    }
    if (emailFieldError(normalizedEmail)) {
      emailInput.current?.focus();
      return;
    }
    if (consentFieldError(acceptTerms)) {
      termsInput.current?.focus();
      return;
    }
    if (consentFieldError(acceptPrivacy)) {
      privacyInput.current?.focus();
      return;
    }
    await requestEmailCode("register");
  }

  async function requestRecovery(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    setValidationAttemptedFor("recovery-request");
    const normalizedEmail = normalizeEmailInput(email);
    setEmail(normalizedEmail);
    if (emailFieldError(normalizedEmail)) {
      emailInput.current?.focus();
      return;
    }
    await requestEmailCode("password_reset");
  }

  async function resendRegistrationConfirmation(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    setValidationAttemptedFor("verification-request");
    if (consentFieldError(acceptTerms)) {
      termsInput.current?.focus();
      return;
    }
    if (consentFieldError(acceptPrivacy)) {
      privacyInput.current?.focus();
      return;
    }
    await requestEmailCode("registration_resend");
  }

  async function verifyRegistration(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    setPending(true);
    try {
      const { response, data } = await requestAuthentication("/api/auth/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale },
        body: JSON.stringify({
          challengeId,
          email: challengeEmail,
          code,
          purpose: "register",
          locale,
          accountType: challengeAccountType,
          acceptTerms: true,
          acceptPrivacy: true,
          acceptPersonalData: true,
          marketing: false,
          rememberMe,
        }),
      });
      if (!response.ok) {
        if (["OTP_USED", "REGISTRATION_RESTART_REQUIRED"].includes(data.code ?? "")) {
          setStep("details");
          setChallengeId("");
          setCode("");
          setCooldown(0);
        }
        throw new Error(data.error || tr({ ru: "Не удалось подтвердить код.", uz: "Kodni tasdiqlab bo‘lmadi.", en: "The code could not be confirmed." }));
      }
      if (data.requiresTwoFactor) {
        setMfaCode("");
        setStep("mfa");
        return;
      }
      completeAuthentication(data);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setPending(false);
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    if (!passwordValid || !passwordsMatch) {
      setError(tr({ ru: "Проверьте новый пароль и его подтверждение.", uz: "Yangi parol va uning tasdig‘ini tekshiring.", en: "Check the new password and its confirmation." }));
      return;
    }
    setPending(true);
    try {
      const { response, data } = await requestAuthentication("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale },
        body: JSON.stringify({ challengeId, email: challengeEmail, code, password, locale }),
      });
      if (!response.ok) {
        throw new Error(data.error || tr({ ru: "Не удалось обновить пароль.", uz: "Parolni yangilab bo‘lmadi.", en: "The password could not be updated." }));
      }
      setSuccessMessage(data.message ?? "");
      setPassword("");
      setConfirmPassword("");
      setCode("");
      setChallengeId("");
      setStep("recovery-success");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setPending(false);
    }
  }

  async function verifySecondFactor(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    setPending(true);
    try {
      const { response, data } = await requestAuthentication("/api/auth/verify-mfa", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale },
        body: JSON.stringify({ code: mfaCode.trim(), locale, rememberMe }),
      });
      if (!response.ok) {
        const terminal = ["MFA_CHALLENGE_INVALID", "MFA_CHALLENGE_EXPIRED", "MFA_CHALLENGE_USED", "MFA_ATTEMPTS_EXCEEDED", "MFA_RATE_LIMITED"].includes(data.code ?? "");
        if (terminal) returnToDetails();
        throw new Error(data.error || tr({ ru: "Не удалось подтвердить второй фактор.", uz: "Ikkinchi omilni tasdiqlab bo‘lmadi.", en: "The second factor could not be confirmed." }));
      }
      completeAuthentication(data);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setPending(false);
    }
  }

  const authAvailable = mode === "login" ? passwordAuthEnabled : emailAuthEnabled;
  if (!authAvailable) {
    return (
      <main className="auth-page" lang={locale}>
        <BrandPanel locale={locale} mode={mode} lawyerProduct={lawyerProduct} />
        <section className="auth-card auth-card-unavailable">
          <AuthUtilities locale={locale} hrefFor={localeHref} />
          <header className="auth-unavailable">
            <LockKeyhole aria-hidden="true" />
            <div>
              <h2>{tr({ ru: "Защищённый вход", uz: "Himoyalangan kirish", en: "Secure sign-in" })}</h2>
              <p>{tr({ ru: "Сервис авторизации временно недоступен. Мы не показываем ложное подтверждение отправки.", uz: "Avtorizatsiya xizmati vaqtincha mavjud emas. Yuborish haqida noto‘g‘ri tasdiq ko‘rsatilmaydi.", en: "The authentication service is temporarily unavailable. We will not show a false delivery confirmation." })}</p>
            </div>
          </header>
          {developmentAuthEnabled
            ? <a className="auth-submit" href={`/api/auth/dev-login?returnTo=${encodeURIComponent(protectedReturnTo)}`}><ArrowRight aria-hidden="true" />{tr({ ru: "Локальный вход разработчика", uz: "Mahalliy dasturchi kirishi", en: "Local developer sign-in" })}</a>
            : platformAuthEnabled
              ? <a className="auth-submit" href={`/signin-with-chatgpt?return_to=${encodeURIComponent(protectedReturnTo)}`}><ArrowRight aria-hidden="true" />{tr({ ru: "Продолжить защищённый вход", uz: "Himoyalangan kirishni davom ettirish", en: "Continue secure sign-in" })}</a>
              : <p className="auth-error" role="status">{tr({ ru: "Повторите попытку позднее или обратитесь в поддержку JURO.", uz: "Keyinroq qayta urinib ko‘ring yoki JURO yordam xizmatiga murojaat qiling.", en: "Try again later or contact JURO support." })}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page" lang={locale}>
      <BrandPanel locale={locale} mode={mode} lawyerProduct={lawyerProduct} />
      <section className="auth-card">
        <AuthUtilities locale={locale} hrefFor={localeHref} />
        {authNotice && <AuthNotice {...authNotice} />}

        {step === "details" && mode === "login" && (
          <form onSubmit={login} noValidate>
            <AuthHeading icon={<KeyRound aria-hidden="true" />} eyebrow={tr({ ru: "Безопасная сессия", uz: "Xavfsiz sessiya", en: "Secure session" })} title={tr({ ru: "Войдите в JURO", uz: "JURO hisobiga kiring", en: "Sign in to JURO" })} description={tr({ ru: "Используйте email и пароль. Код понадобится только для особых проверок.", uz: "Email va paroldan foydalaning. Kod faqat maxsus tekshiruvlar uchun kerak.", en: "Use your email and password. A code is only needed for special checks." })} />
            <AuthTextField inputRef={emailInput} id="auth-email" name="email" label="Email" type="email" value={email} onChange={setEmail} onBlur={() => { setEmailTouched(true); setEmail(normalizeEmailInput(email)); }} required autoComplete="username" autoCapitalize="none" inputMode="email" enterKeyHint="next" placeholder="name@example.com" spellCheck={false} maxLength={254} error={emailError} disabled={pending} />
            <PasswordField locale={locale} id="auth-password" name="password" label={tr({ ru: "Пароль", uz: "Parol", en: "Password" })} value={password} onChange={setPassword} autoComplete="current-password" disabled={pending} />
            <div className="auth-form-options">
              <label className="auth-check auth-remember"><input name="remember-me" type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} disabled={pending} /><span>{tr({ ru: "Запомнить на 30 дней", uz: "30 kun eslab qolish", en: "Remember for 30 days" })}</span></label>
              <button type="button" className="auth-text-button" disabled={pending} onClick={() => { requestGeneration.current += 1; clearFeedback(); setPassword(""); setConfirmPassword(""); setStep("recovery-request"); resetTurnstile(); }}>{tr({ ru: "Забыли пароль?", uz: "Parolni unutdingizmi?", en: "Forgot password?" })}</button>
            </div>
            {turnstileSiteKey && <TurnstileWidget siteKey={turnstileSiteKey} locale={locale} resetSignal={turnstileReset} onToken={setTurnstileToken} action="auth_password_login" />}
            <SubmitButton pending={pending} disabled={!turnstileToken || !passwordValid} label={tr({ ru: "Войти", uz: "Kirish", en: "Sign in" })} />
            <p className="auth-migration-note"><ShieldCheck aria-hidden="true" />{tr({ ru: "Раньше входили по коду? Установите пароль через восстановление — аккаунт и данные сохранятся.", uz: "Avval kod bilan kirganmisiz? Tiklash orqali parol o‘rnating — hisob va ma’lumotlar saqlanadi.", en: "Previously signed in by code? Set a password through recovery—your account and data stay intact." })}</p>
          </form>
        )}

        {step === "details" && mode === "register" && (
          <form onSubmit={register} noValidate>
            <AuthHeading icon={<Sparkles aria-hidden="true" />} eyebrow={tr({ ru: "Один компактный экран", uz: "Bitta ixcham ekran", en: "One compact screen" })} title={tr({ ru: "Создайте аккаунт", uz: "Hisob yarating", en: "Create your account" })} description={tr({ ru: "Только данные, необходимые для безопасного старта. Остальное — позже в профиле.", uz: "Xavfsiz boshlash uchun zarur ma’lumotlargina. Qolganini keyin profilga qo‘shasiz.", en: "Only what is needed for a secure start. Add everything else later in your profile." })} />
            {!lawyerProduct && <AccountTypePicker locale={locale} value={accountType} onChange={setAccountType} disabled={pending} />}
            <div className="auth-row">
              <AuthTextField inputRef={firstNameInput} id="first-name" name="given-name" label={tr({ ru: "Имя", uz: "Ism", en: "First name" })} value={firstName} onChange={setFirstName} onBlur={() => { setFirstNameTouched(true); setFirstName(firstName.trim()); }} required autoComplete="given-name" enterKeyHint="next" maxLength={80} error={firstNameError} disabled={pending} />
              <AuthTextField id="last-name" name="family-name" label={tr({ ru: "Фамилия (необязательно)", uz: "Familiya (ixtiyoriy)", en: "Last name (optional)" })} value={lastName} onChange={setLastName} onBlur={() => setLastName(lastName.trim())} autoComplete="family-name" enterKeyHint="next" maxLength={80} disabled={pending} />
            </div>
            <AuthTextField inputRef={emailInput} id="auth-email" name="email" label="Email" type="email" value={email} onChange={setEmail} onBlur={() => { setEmailTouched(true); setEmail(normalizeEmailInput(email)); }} required autoComplete="username" autoCapitalize="none" inputMode="email" enterKeyHint="next" placeholder="name@example.com" spellCheck={false} maxLength={254} error={emailError} disabled={pending} />
            <PasswordField locale={locale} id="new-password" name="password" label={tr({ ru: "Пароль", uz: "Parol", en: "Password" })} value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-strength" disabled={pending} />
            <PasswordStrength locale={locale} password={password} score={strength} />
            <PasswordField locale={locale} id="confirm-password" name="password-confirmation" label={tr({ ru: "Подтвердите пароль", uz: "Parolni tasdiqlang", en: "Confirm password" })} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" describedBy="password-match" invalid={Boolean(confirmPassword) && !passwordsMatch} disabled={pending} />
            {confirmPassword && <small id="password-match" className={passwordsMatch ? "auth-valid" : "auth-field-error"}>{passwordsMatch ? tr({ ru: "Пароли совпадают", uz: "Parollar mos", en: "Passwords match" }) : tr({ ru: "Пароли не совпадают", uz: "Parollar mos emas", en: "Passwords do not match" })}</small>}
            <div className="auth-consents">
              <Consent name="accept-terms" checked={acceptTerms} onChange={setAcceptTerms} onTouched={() => setTermsTouched(true)} inputRef={termsInput} error={termsError} disabled={pending}>
                {tr({ ru: "Принимаю", uz: "", en: "I accept the" })}{locale === "uz" ? null : " "}
                <a href={`/legal/terms?lang=${legalLocale}`} target="_blank" rel="noreferrer">{tr({ ru: "Условия использования", uz: "Foydalanish shartlarini", en: "Terms of Use" })}</a>{locale === "uz" ? " qabul qilaman" : ""}
              </Consent>
              <Consent name="accept-privacy" checked={acceptPrivacy} onChange={setAcceptPrivacy} onTouched={() => setPrivacyTouched(true)} inputRef={privacyInput} error={privacyError} disabled={pending}>
                {tr({ ru: "Ознакомлен(а) с", uz: "Men", en: "I have read the" })}{" "}
                <a href={`/legal/privacy?lang=${legalLocale}`} target="_blank" rel="noreferrer">{tr({ ru: "Политикой конфиденциальности", uz: "Maxfiylik siyosati", en: "Privacy Policy" })}</a>{" "}
                {tr({ ru: "и согласен(на) на", uz: "bilan tanishdim va", en: "and consent to" })}{" "}
                <a href={`/legal/personal-data?lang=${legalLocale}`} target="_blank" rel="noreferrer">{tr({ ru: "обработку персональных данных", uz: "shaxsiy ma’lumotlarni qayta ishlashga", en: "personal data processing" })}</a>{locale === "uz" ? " roziman" : ""}.
              </Consent>
            </div>
            {turnstileSiteKey && <TurnstileWidget siteKey={turnstileSiteKey} locale={locale} resetSignal={turnstileReset} onToken={setTurnstileToken} action="auth_registration" />}
            <SubmitButton pending={pending} disabled={!turnstileToken || !passwordValid || !passwordsMatch} label={tr({ ru: "Создать аккаунт", uz: "Hisob yaratish", en: "Create account" })} />
          </form>
        )}

        {step === "recovery-request" && (
          <form onSubmit={requestRecovery} noValidate>
            <BackButton onClick={returnToDetails} label={tr({ ru: "Назад ко входу", uz: "Kirishga qaytish", en: "Back to sign in" })} disabled={pending} />
            <AuthHeading icon={<LockKeyhole aria-hidden="true" />} eyebrow={tr({ ru: "Восстановление", uz: "Tiklash", en: "Recovery" })} title={tr({ ru: "Восстановите пароль", uz: "Parolni tiklang", en: "Reset your password" })} description={tr({ ru: "Укажите email. Мы отправим одноразовый код, если он связан с аккаунтом.", uz: "Emailni kiriting. Agar u hisob bilan bog‘langan bo‘lsa, bir martalik kod yuboramiz.", en: "Enter your email. We will send a one-time code if it belongs to an account." })} />
            <AuthTextField inputRef={emailInput} id="recovery-email" name="email" label="Email" type="email" value={email} onChange={setEmail} onBlur={() => { setEmailTouched(true); setEmail(normalizeEmailInput(email)); }} required autoComplete="username" autoCapitalize="none" inputMode="email" enterKeyHint="send" placeholder="name@example.com" spellCheck={false} maxLength={254} error={emailError} disabled={pending} />
            {emailAuthEnabled && turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} locale={locale} resetSignal={turnstileReset} onToken={setTurnstileToken} action="auth_password_reset" /> : <p className="auth-error" role="status">{tr({ ru: "Восстановление временно недоступно.", uz: "Tiklash vaqtincha mavjud emas.", en: "Password recovery is temporarily unavailable." })}</p>}
            <SubmitButton pending={pending} disabled={!emailAuthEnabled || !turnstileToken} label={tr({ ru: "Отправить код", uz: "Kod yuborish", en: "Send code" })} />
          </form>
        )}

        {step === "verification-request" && (
          <form onSubmit={resendRegistrationConfirmation} noValidate aria-labelledby="verification-request-title">
            <BackButton onClick={returnToDetails} label={tr({ ru: "Назад ко входу", uz: "Kirishga qaytish", en: "Back to sign in" })} disabled={pending} />
            <AuthHeading titleId="verification-request-title" titleRef={verificationRequestHeading} icon={<CheckCircle2 aria-hidden="true" />} eyebrow={tr({ ru: "Email не подтверждён", uz: "Email tasdiqlanmagan", en: "Email not confirmed" })} title={tr({ ru: "Получите новый код", uz: "Yangi kodni oling", en: "Get a new code" })} description={tr({ ru: `После проверки безопасности отправим код на ${masked}. Новый аккаунт создавать не нужно.`, uz: `Xavfsizlik tekshiruvidan so‘ng ${masked} manziliga kod yuboramiz. Yangi hisob yaratish shart emas.`, en: `After the security check, we will send a code to ${masked}. You do not need to create another account.` })} />
            <input className="auth-password-manager-username" name="username" type="email" value={challengeEmail} readOnly autoComplete="username" tabIndex={-1} aria-hidden="true" />
            {registrationRestartMessage ? <>
              <AuthNotice title={tr({ ru: "Продолжите регистрацию", uz: "Ro‘yxatdan o‘tishni davom ettiring", en: "Continue registration" })} body={registrationRestartMessage} tone="warning" />
              <Link className="auth-submit" href={registrationRestartHref}><ArrowRight aria-hidden="true" />{tr({ ru: "Продолжить без нового аккаунта", uz: "Yangi hisobsiz davom ettirish", en: "Continue without a new account" })}</Link>
            </> : <>
            <div className="auth-consents">
              <Consent name="accept-terms" checked={acceptTerms} onChange={setAcceptTerms} onTouched={() => setTermsTouched(true)} inputRef={termsInput} error={termsError} disabled={pending}>
                {tr({ ru: "Принимаю", uz: "", en: "I accept the" })}{locale === "uz" ? null : " "}
                <a href={`/legal/terms?lang=${legalLocale}`} target="_blank" rel="noreferrer">{tr({ ru: "Условия использования", uz: "Foydalanish shartlarini", en: "Terms of Use" })}</a>{locale === "uz" ? " qabul qilaman" : ""}
              </Consent>
              <Consent name="accept-privacy" checked={acceptPrivacy} onChange={setAcceptPrivacy} onTouched={() => setPrivacyTouched(true)} inputRef={privacyInput} error={privacyError} disabled={pending}>
                {tr({ ru: "Ознакомлен(а) с", uz: "Men", en: "I have read the" })}{" "}
                <a href={`/legal/privacy?lang=${legalLocale}`} target="_blank" rel="noreferrer">{tr({ ru: "Политикой конфиденциальности", uz: "Maxfiylik siyosati", en: "Privacy Policy" })}</a>{" "}
                {tr({ ru: "и согласен(на) на", uz: "bilan tanishdim va", en: "and consent to" })}{" "}
                <a href={`/legal/personal-data?lang=${legalLocale}`} target="_blank" rel="noreferrer">{tr({ ru: "обработку персональных данных", uz: "shaxsiy ma’lumotlarni qayta ishlashga", en: "personal data processing" })}</a>{locale === "uz" ? " roziman" : ""}.
              </Consent>
            </div>
            {emailAuthEnabled && turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} locale={locale} resetSignal={turnstileReset} onToken={setTurnstileToken} action="auth_registration_resend" /> : <p className="auth-error" role="status">{tr({ ru: "Повторная отправка временно недоступна.", uz: "Qayta yuborish vaqtincha mavjud emas.", en: "Resending is temporarily unavailable." })}</p>}
            <SubmitButton pending={pending} disabled={!emailAuthEnabled || !turnstileToken} label={tr({ ru: "Отправить новый код", uz: "Yangi kod yuborish", en: "Send a new code" })} />
            </>}
          </form>
        )}

        {step === "verification" && (
          <form onSubmit={verifyRegistration}>
            <BackButton onClick={returnToDetails} label={mode === "login" ? tr({ ru: "Назад ко входу", uz: "Kirishga qaytish", en: "Back to sign in" }) : tr({ ru: "Изменить данные", uz: "Ma’lumotlarni o‘zgartirish", en: "Edit details" })} disabled={pending} />
            <AuthHeading icon={<CheckCircle2 aria-hidden="true" />} eyebrow={tr({ ru: "Техническое подтверждение", uz: "Texnik tasdiqlash", en: "Technical confirmation" })} title={tr({ ru: "Подтвердите email", uz: "Emailni tasdiqlang", en: "Confirm your email" })} description={tr({ ru: `Код отправлен на ${masked} и действует 10 минут.`, uz: `Kod ${masked} manziliga yuborildi va 10 daqiqa amal qiladi.`, en: `We sent a code to ${masked}. It is valid for 10 minutes.` })} />
            <OtpField locale={locale} value={code} onChange={setCode} inputRef={otpInput} disabled={pending} />
            <SubmitButton pending={pending} disabled={code.length !== 6} label={tr({ ru: "Подтвердить и продолжить", uz: "Tasdiqlash va davom etish", en: "Confirm and continue" })} />
            <ResendControl locale={locale} pending={pending} cooldown={cooldown} enabled={Boolean(turnstileToken)} onResend={() => void requestEmailCode("registration_resend")} />
            {cooldown <= 0 && turnstileSiteKey && <TurnstileWidget siteKey={turnstileSiteKey} locale={locale} resetSignal={turnstileReset} onToken={setTurnstileToken} action="auth_registration_resend" />}
          </form>
        )}

        {step === "recovery-code" && (
          <form onSubmit={resetPassword}>
            <BackButton onClick={() => { requestGeneration.current += 1; clearFeedback(); setPending(false); setStep("recovery-request"); setChallengeId(""); setChallengeEmail(""); setCode(""); setCooldown(0); resetTurnstile(); }} label={tr({ ru: "Изменить email", uz: "Emailni o‘zgartirish", en: "Change email" })} disabled={pending} />
            <AuthHeading icon={<LockKeyhole aria-hidden="true" />} eyebrow={tr({ ru: "Код действует 10 минут", uz: "Kod 10 daqiqa amal qiladi", en: "Code valid for 10 minutes" })} title={tr({ ru: "Установите новый пароль", uz: "Yangi parol o‘rnating", en: "Set a new password" })} description={tr({ ru: `Введите код из письма для ${masked}.`, uz: `${masked} uchun xatdagi kodni kiriting.`, en: `Enter the code from the email sent to ${masked}.` })} />
            <input className="auth-password-manager-username" name="username" type="email" value={challengeEmail} readOnly autoComplete="username" tabIndex={-1} aria-hidden="true" />
            <OtpField locale={locale} value={code} onChange={setCode} inputRef={otpInput} disabled={pending} />
            <PasswordField locale={locale} id="reset-password" name="password" label={tr({ ru: "Новый пароль", uz: "Yangi parol", en: "New password" })} value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-strength" disabled={pending} />
            <PasswordStrength locale={locale} password={password} score={strength} />
            <PasswordField locale={locale} id="reset-password-confirm" name="password-confirmation" label={tr({ ru: "Подтвердите новый пароль", uz: "Yangi parolni tasdiqlang", en: "Confirm new password" })} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" describedBy="reset-password-match" invalid={Boolean(confirmPassword) && !passwordsMatch} disabled={pending} />
            {confirmPassword && <small id="reset-password-match" className={passwordsMatch ? "auth-valid" : "auth-field-error"}>{passwordsMatch ? tr({ ru: "Пароли совпадают", uz: "Parollar mos", en: "Passwords match" }) : tr({ ru: "Пароли не совпадают", uz: "Parollar mos emas", en: "Passwords do not match" })}</small>}
            <SubmitButton pending={pending} disabled={code.length !== 6 || !passwordValid || !passwordsMatch} label={tr({ ru: "Обновить пароль", uz: "Parolni yangilash", en: "Update password" })} />
            <ResendControl locale={locale} pending={pending} cooldown={cooldown} enabled={Boolean(turnstileToken)} onResend={() => void requestEmailCode("password_reset")} />
            {cooldown <= 0 && turnstileSiteKey && <TurnstileWidget siteKey={turnstileSiteKey} locale={locale} resetSignal={turnstileReset} onToken={setTurnstileToken} action="auth_password_reset_resend" />}
          </form>
        )}

        {step === "recovery-success" && (
          <div ref={successPanel} className="auth-success" role="status" tabIndex={-1}>
            <span><Check aria-hidden="true" /></span>
            <h2>{tr({ ru: "Пароль обновлён", uz: "Parol yangilandi", en: "Password updated" })}</h2>
            <p>{successMessage || tr({ ru: "Теперь можно войти с новым паролем.", uz: "Endi yangi parol bilan kirishingiz mumkin.", en: "You can now sign in with your new password." })}</p>
            <button type="button" className="auth-submit" onClick={returnToDetails}><ArrowRight aria-hidden="true" />{tr({ ru: "Перейти ко входу", uz: "Kirishga o‘tish", en: "Go to sign in" })}</button>
          </div>
        )}

        {step === "mfa" && (
          <form onSubmit={verifySecondFactor}>
            <BackButton onClick={returnToDetails} label={tr({ ru: "Начать вход заново", uz: "Kirishni qaytadan boshlash", en: "Start sign-in again" })} disabled={pending} />
            <AuthHeading icon={<ShieldCheck aria-hidden="true" />} eyebrow="2FA" title={tr({ ru: "Подтвердите второй фактор", uz: "Ikkinchi omilni tasdiqlang", en: "Confirm your second factor" })} description={tr({ ru: "Введите код из приложения-аутентификатора или один резервный код.", uz: "Autentifikator ilovasidagi kodni yoki bitta zaxira kodni kiriting.", en: "Enter a code from your authenticator app or one backup code." })} />
            <label htmlFor="mfa-code"><span>{tr({ ru: "Код подтверждения", uz: "Tasdiqlash kodi", en: "Verification code" })}</span><input ref={mfaInput} id="mfa-code" name="mfa-code" className="auth-code auth-mfa-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.toUpperCase().replace(/[^A-Z0-9 -]/gu, "").slice(0, 64))} required inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" maxLength={64} aria-describedby="mfa-hint" disabled={pending} /></label>
            <small id="mfa-hint" className="auth-hint">{tr({ ru: "TOTP-код содержит 6 цифр. Резервный код можно вводить с дефисами или без.", uz: "TOTP kodi 6 raqamdan iborat. Zaxira kodni chiziqcha bilan yoki chiziqchasiz kiriting.", en: "A TOTP code has 6 digits. Enter a backup code with or without hyphens." })}</small>
            <SubmitButton pending={pending} disabled={mfaCode.trim().length < 6} label={tr({ ru: "Завершить вход", uz: "Kirishni yakunlash", en: "Finish sign-in" })} />
          </form>
        )}

        {error && <div className="auth-error" role="alert"><span>{error}</span></div>}

        {step === "details" && <div className="auth-switch">
          {mode === "register"
            ? <>{tr({ ru: "Уже есть аккаунт?", uz: "Hisobingiz bormi?", en: "Already have an account?" })} <Link href={`/${locale}/auth/login${lawyerProduct ? "?accountType=lawyer" : ""}`}>{tr({ ru: "Войти", uz: "Kirish", en: "Sign in" })}</Link></>
            : <>{tr({ ru: "Нет аккаунта?", uz: "Hisob yo‘qmi?", en: "New to JURO?" })} <Link href={`/${locale}/auth/register?accountType=${accountType}`}>{tr({ ru: "Создать аккаунт", uz: "Hisob yaratish", en: "Create account" })}</Link></>}
        </div>}

        {step === "details" && (developmentAuthEnabled
          ? <a className="auth-secondary-login" href={`/api/auth/dev-login?returnTo=${encodeURIComponent(protectedReturnTo)}`}>{tr({ ru: "Локальный вход разработчика", uz: "Mahalliy dasturchi kirishi", en: "Local developer sign-in" })}</a>
          : platformAuthEnabled && <a className="auth-secondary-login" href={`/signin-with-chatgpt?return_to=${encodeURIComponent(protectedReturnTo)}`}>{tr({ ru: "Войти через защищённую учётную запись", uz: "Himoyalangan hisob orqali kirish", en: "Sign in with a secure account" })}</a>)}
      </section>
    </main>
  );
}

function AuthUtilities({ locale, hrefFor }: { locale: Locale; hrefFor: (locale: Locale) => string }) {
  return <div className="auth-utilities"><ThemeSwitcher locale={locale} compact persistAccount={false} /><LanguageSwitch locale={locale} hrefFor={hrefFor} /></div>;
}

function AuthHeading({ icon, eyebrow, title, description, titleId, titleRef }: { icon: React.ReactNode; eyebrow: string; title: string; description: string; titleId?: string; titleRef?: React.RefObject<HTMLHeadingElement | null> }) {
  return <header className="auth-heading"><span className="auth-heading-icon">{icon}</span><div><small>{eyebrow}</small><h2 id={titleId} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>{title}</h2><p>{description}</p></div></header>;
}

function AuthTextField({
  inputRef,
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  error,
  required = false,
  autoComplete,
  autoCapitalize,
  inputMode,
  enterKeyHint,
  placeholder,
  spellCheck,
  maxLength,
  disabled = false,
}: {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  id: string;
  name: string;
  label: string;
  type?: "text" | "email";
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  required?: boolean;
  autoComplete?: string;
  autoCapitalize?: React.HTMLAttributes<HTMLInputElement>["autoCapitalize"];
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>["enterKeyHint"];
  placeholder?: string;
  spellCheck?: boolean;
  maxLength?: number;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  return (
    <label className="auth-field" htmlFor={id}>
      <span>{label}</span>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        required={required}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        placeholder={placeholder}
        spellCheck={spellCheck}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
      />
      {error && <small id={errorId} className="auth-field-error" role="alert">{error}</small>}
    </label>
  );
}

function SubmitButton({ pending, disabled, label }: { pending: boolean; disabled: boolean; label: string }) {
  return <button className="auth-submit" disabled={pending || disabled} aria-busy={pending}>{pending ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}<span>{label}</span></button>;
}

function BackButton({ onClick, label, disabled = false }: { onClick: () => void; label: string; disabled?: boolean }) {
  return <button type="button" className="auth-back" onClick={onClick} disabled={disabled}><ArrowLeft aria-hidden="true" />{label}</button>;
}

function OtpField({ locale, value, onChange, inputRef, disabled = false }: { locale: Locale; value: string; onChange: (value: string) => void; inputRef: React.RefObject<HTMLInputElement | null>; disabled?: boolean }) {
  return <label htmlFor="otp-code"><span>{copy(locale, { ru: "Шестизначный код", uz: "Olti xonali kod", en: "Six-digit code" })}</span><input ref={inputRef} id="otp-code" name="one-time-code" className="auth-code" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/gu, "").slice(0, 6))} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-describedby="otp-hint" disabled={disabled} /><small id="otp-hint" className="auth-hint">{copy(locale, { ru: "Никому не сообщайте этот код. Сотрудники JURO никогда его не запрашивают.", uz: "Bu kodni hech kimga bermang. JURO xodimlari uni hech qachon so‘ramaydi.", en: "Never share this code. JURO staff will never ask for it." })}</small></label>;
}

function PasswordStrength({ locale, password, score }: { locale: Locale; password: string; score: number }) {
  const tooLong = password.length > 256;
  const labels = [
    copy(locale, { ru: "Минимум 8 символов", uz: "Kamida 8 ta belgi", en: "At least 8 characters" }),
    copy(locale, { ru: "Слабый", uz: "Zaif", en: "Weak" }),
    copy(locale, { ru: "Приемлемый", uz: "Qoniqarli", en: "Fair" }),
    copy(locale, { ru: "Надёжный", uz: "Ishonchli", en: "Strong" }),
    copy(locale, { ru: "Очень надёжный", uz: "Juda ishonchli", en: "Very strong" }),
  ];
  return <div className="auth-strength" id="password-strength" data-score={tooLong ? 0 : score}><span role="progressbar" aria-label={copy(locale, { ru: "Надёжность пароля", uz: "Parol ishonchliligi", en: "Password strength" })} aria-valuemin={0} aria-valuemax={4} aria-valuenow={tooLong ? 0 : score}><i /></span><small className={tooLong ? "auth-field-error" : undefined}>{tooLong ? copy(locale, { ru: "Пароль не должен превышать 256 символов — значение не было обрезано.", uz: "Parol 256 belgidan oshmasligi kerak — qiymat qisqartirilmadi.", en: "The password must not exceed 256 characters—the value was not truncated." }) : <>{password ? labels[score] : labels[0]}. {copy(locale, { ru: "Длинная фраза лучше сложного короткого пароля.", uz: "Uzun ibora murakkab qisqa paroldan yaxshiroq.", en: "A long passphrase is better than a short complex password." })}</>}</small></div>;
}

function AccountTypePicker({ locale, value, onChange, disabled = false }: { locale: Locale; value: AccountType; onChange: (value: AccountType) => void; disabled?: boolean }) {
  const options = [
    ["individual", UserRound, { ru: "Для себя", uz: "O‘zim uchun", en: "Personal" }],
    ["entrepreneur", BriefcaseBusiness, { ru: "Предприниматель", uz: "Tadbirkor", en: "Business owner" }],
    ["lawyer", Scale, { ru: "Юрист", uz: "Yurist", en: "Lawyer" }],
  ] as const;
  return <div className="auth-account-type" role="group" aria-label={copy(locale, { ru: "Тип профиля", uz: "Profil turi", en: "Profile type" })}>{options.map(([option, Icon, label]) => <button key={option} type="button" className={value === option ? "active" : ""} aria-pressed={value === option} onClick={() => onChange(option)} disabled={disabled}><Icon aria-hidden="true" /><span>{copy(locale, label)}</span></button>)}</div>;
}

function ResendControl({ locale, pending, cooldown, enabled, onResend }: { locale: Locale; pending: boolean; cooldown: number; enabled: boolean; onResend: () => void }) {
  return <button type="button" className="auth-resend" onClick={onResend} disabled={pending || cooldown > 0 || !enabled}><RotateCcw aria-hidden="true" />{cooldown > 0 ? copy(locale, { ru: `Повторить через ${cooldown} с`, uz: `${cooldown} s dan keyin`, en: `Resend in ${cooldown}s` }) : copy(locale, { ru: "Отправить код повторно", uz: "Kodni qayta yuborish", en: "Resend code" })}</button>;
}

function BrandPanel({ locale, mode, lawyerProduct }: { locale: Locale; mode: "login" | "register"; lawyerProduct: boolean }) {
  const headline = mode === "register"
    ? lawyerProduct
      ? { ru: "Практика начинается с доверия", uz: "Amaliyot ishonchdan boshlanadi", en: "Practice starts with trust" }
      : { ru: "Юридическая ясность — в одном пространстве", uz: "Huquqiy aniqlik — bitta makonda", en: "Legal clarity, in one workspace" }
    : lawyerProduct
      ? { ru: "Вернитесь к своей практике", uz: "Amaliyotingizga qayting", en: "Return to your practice" }
      : { ru: "Продолжайте с того места, где остановились", uz: "To‘xtagan joyingizdan davom eting", en: "Continue where you left off" };
  return (
    <section className="auth-brand" data-product={lawyerProduct ? "lawyer" : "client"}>
      <div className="auth-brand-top"><Link href={`https://juro.uz/${locale}`} aria-label="JURO"><Image src="/juro-logo-light.png" alt="JURO" width={1268} height={1240} priority unoptimized /></Link><span>{lawyerProduct ? copy(locale, { ru: "Кабинет юриста", uz: "Yurist kabineti", en: "Lawyer workspace" }) : "AI LegalTech"}</span></div>
      <div className="auth-brand-content">
        <span className="auth-brand-kicker"><ShieldCheck aria-hidden="true" />{copy(locale, { ru: "Защищённая платформа JURO", uz: "Himoyalangan JURO platformasi", en: "Secure JURO platform" })}</span>
        <h1>{copy(locale, headline)}</h1>
        <p>{lawyerProduct ? copy(locale, { ru: "Заявки, консультации и материалы клиентов доступны только после проверки профиля и явного разрешения клиента.", uz: "So‘rovlar, maslahatlar va mijoz materiallari faqat profil tekshiruvi va mijozning aniq ruxsatidan keyin ochiladi.", en: "Requests, consultations, and client materials open only after profile verification and explicit client permission." }) : copy(locale, { ru: "Документы, дела и AI-инструменты связаны с вашей учётной записью и защищены серверной проверкой сессии.", uz: "Hujjatlar, ishlar va AI vositalari hisobingizga bog‘langan va server sessiya tekshiruvi bilan himoyalangan.", en: "Documents, matters, and AI tools stay connected to your account and protected by server-side session checks." })}</p>
        <div className="auth-brand-features" aria-label={copy(locale, { ru: "Возможности", uz: "Imkoniyatlar", en: "Capabilities" })}><span><Check aria-hidden="true" />{copy(locale, { ru: "Документы", uz: "Hujjatlar", en: "Documents" })}</span><span><Check aria-hidden="true" />{copy(locale, { ru: "Правовой AI", uz: "Huquqiy AI", en: "Legal AI" })}</span><span><Check aria-hidden="true" />{copy(locale, { ru: "Юристы", uz: "Yuristlar", en: "Counsel" })}</span></div>
      </div>
      <div className="auth-orbit" aria-hidden="true"><i /><i /><i /><span>J</span></div>
      <small>{copy(locale, { ru: "JURO не является государственным органом или нотариусом.", uz: "JURO davlat organi yoki notarius emas.", en: "JURO is not a government authority or notary." })}</small>
    </section>
  );
}

function LanguageSwitch({ locale, hrefFor }: { locale: Locale; hrefFor: (value: Locale) => string }) {
  return <nav className="auth-language" aria-label={copy(locale, { ru: "Язык интерфейса", uz: "Interfeys tili", en: "Interface language" })}><Languages aria-hidden="true" />{(["ru", "uz", "en"] as const).map((value) => <Link key={value} href={hrefFor(value)} className={locale === value ? "active" : ""} aria-current={locale === value ? "page" : undefined} hrefLang={value}>{value.toUpperCase()}</Link>)}</nav>;
}

function Consent({ name, checked, onChange, onTouched, inputRef, error, disabled = false, children }: { name: string; checked: boolean; onChange: (value: boolean) => void; onTouched: () => void; inputRef: React.RefObject<HTMLInputElement | null>; error?: string | null; disabled?: boolean; children: React.ReactNode }) {
  const errorId = `${name}-error`;
  return <div className="auth-consent-field"><label className="auth-check"><input ref={inputRef} name={name} type="checkbox" checked={checked} onChange={(event) => { onTouched(); onChange(event.target.checked); }} onBlur={onTouched} required aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} disabled={disabled} /><span>{children}</span></label>{error && <small id={errorId} className="auth-field-error" role="alert">{error}</small>}</div>;
}

type AuthNoticeCopy = { title: string; body: string; tone: "info" | "warning" };

function authenticationNotice({
  locale,
  logout,
  session,
  handoff,
}: {
  locale: Locale;
  logout: string | null;
  session: string | null;
  handoff: string | null;
}): AuthNoticeCopy | null {
  if (logout === "server-unconfirmed") {
    return {
      tone: "warning",
      title: copy(locale, { ru: "Выход выполнен не полностью", uz: "Chiqish to‘liq tasdiqlanmadi", en: "Sign-out was not fully confirmed" }),
      body: copy(locale, {
        ru: "Переход к выходу выполнен, но сервер не подтвердил отзыв локальной сессии. Войдите снова только на доверенном устройстве и проверьте активные сессии в настройках безопасности.",
        uz: "Chiqish davom ettirildi, ammo server mahalliy sessiya bekor qilinganini tasdiqlamadi. Faqat ishonchli qurilmada qayta kiring va xavfsizlik sozlamalarida faol seanslarni tekshiring.",
        en: "Sign-out continued, but the server did not confirm local session revocation. Sign in again only on a trusted device and review active sessions in security settings.",
      }),
    };
  }
  if (["confirmed", "success", "1"].includes(logout ?? "")) {
    return {
      tone: "info",
      title: copy(locale, { ru: "Вы вышли из аккаунта", uz: "Hisobdan chiqdingiz", en: "You are signed out" }),
      body: copy(locale, { ru: "Сеанс безопасно завершён.", uz: "Seans xavfsiz yakunlandi.", en: "Your session ended securely." }),
    };
  }
  if (["expired", "session-expired"].includes(session ?? "")) {
    return {
      tone: "info",
      title: copy(locale, { ru: "Срок сеанса истёк", uz: "Seans muddati tugadi", en: "Your session expired" }),
      body: copy(locale, { ru: "Войдите снова, чтобы продолжить работу.", uz: "Ishni davom ettirish uchun qayta kiring.", en: "Sign in again to continue." }),
    };
  }
  if (["invalid", "expired", "unavailable"].includes(handoff ?? "")) {
    const unavailable = handoff === "unavailable";
    return {
      tone: "warning",
      title: copy(locale, { ru: "Не удалось перенести сеанс", uz: "Seansni ko‘chirib bo‘lmadi", en: "Session handoff did not complete" }),
      body: unavailable
        ? copy(locale, { ru: "Сервис временно недоступен. Войдите снова, чтобы продолжить безопасно.", uz: "Xizmat vaqtincha mavjud emas. Xavfsiz davom etish uchun qayta kiring.", en: "The service is temporarily unavailable. Sign in again to continue securely." })
        : copy(locale, { ru: "Ссылка переноса недействительна или истекла. Войдите снова.", uz: "Seansni ko‘chirish havolasi yaroqsiz yoki muddati tugagan. Qayta kiring.", en: "The session handoff link is invalid or expired. Sign in again." }),
    };
  }
  return null;
}

function AuthNotice({ title, body, tone }: AuthNoticeCopy) {
  return <aside className="auth-notice" data-tone={tone} role="status"><strong>{title}</strong><span>{body}</span></aside>;
}
