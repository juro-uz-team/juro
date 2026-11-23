import { z } from "zod";
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "./password-policy";

const emailInput = z.string().trim().min(3).max(254);
const localeInput = z.enum(["ru", "uz", "en"]).default("ru");
const authLocaleInput = z.enum(["ru", "uz", "en"]).default("ru");
const passwordInput = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const returnToInput = z.string().max(2048).optional();
// Ordinary authentication is password-first. Public email-code endpoints are
// limited to registration confirmation and password recovery; an internal
// OTP row may still be used as a foreign-key bridge for password + MFA.
const purposeInput = z.literal("register");
const otpRequestPurposeInput = z.literal("password_reset");
const accountTypeInput = z.enum([
  "individual",
  "entrepreneur",
  "lawyer",
]).default(
  "individual",
);

const otpRequestBase = {
  email: emailInput,
  locale: authLocaleInput,
  accountType: accountTypeInput,
  turnstileToken: z.string().trim().min(1).max(2_048),
};

export const requestOtpInputSchema = z.discriminatedUnion("purpose", [
  z.object({
    ...otpRequestBase,
    purpose: otpRequestPurposeInput,
  }).strict(),
  z.object({
    ...otpRequestBase,
    purpose: z.literal("register"),
    password: passwordInput,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).optional(),
    acceptTerms: z.literal(true),
    acceptPrivacy: z.literal(true),
    acceptPersonalData: z.literal(true),
    marketing: z.boolean().default(false),
  }).strict(),
  z.object({
    ...otpRequestBase,
    purpose: z.literal("registration_resend"),
    password: passwordInput,
    acceptTerms: z.literal(true),
    acceptPrivacy: z.literal(true),
    acceptPersonalData: z.literal(true),
  }).strict(),
]);

export const verifyOtpInputSchema = z.object({
  challengeId: z.string().uuid(),
  email: emailInput,
  code: z.string().regex(/^\d{6}$/),
  purpose: purposeInput,
  locale: authLocaleInput,
  accountType: accountTypeInput.optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  acceptTerms: z.boolean().optional(),
  acceptPrivacy: z.boolean().optional(),
  acceptPersonalData: z.boolean().optional(),
  marketing: z.boolean().optional(),
  rememberMe: z.boolean().default(false),
  returnTo: returnToInput,
}).strict();

const mfaCodeInput = z.string().trim().min(6).max(64);

export const verifyMfaInputSchema = z.object({
  code: mfaCodeInput,
  locale: authLocaleInput,
  rememberMe: z.boolean().default(false),
  returnTo: returnToInput,
}).strict();

export const passwordLoginInputSchema = z.object({
  email: emailInput,
  password: passwordInput,
  locale: authLocaleInput,
  rememberMe: z.boolean().default(false),
  returnTo: returnToInput,
  turnstileToken: z.string().trim().min(1).max(2_048),
}).strict();

export const resetPasswordInputSchema = z.object({
  challengeId: z.string().uuid(),
  email: emailInput,
  code: z.string().regex(/^\d{6}$/),
  password: passwordInput,
  locale: authLocaleInput,
}).strict();

export const confirmTotpEnrollmentInputSchema = z.object({
  credentialId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  locale: localeInput,
}).strict();

export const manageMfaInputSchema = z.object({
  code: mfaCodeInput,
  locale: localeInput,
}).strict();

export const accountDeletionInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request_code"),
    locale: localeInput,
  }).strict(),
  z.object({
    action: z.literal("confirm"),
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    confirmation: z.literal("DELETE"),
    deletionMode: z.enum(["immediate", "recoverable_30d"])
      .default("recoverable_30d"),
    reason: z.string().trim().max(500).optional(),
    locale: localeInput,
  }).strict(),
  z.object({
    action: z.literal("cancel"),
    requestId: z.string().uuid(),
    locale: localeInput,
  }).strict(),
  z.object({
    action: z.literal("retry"),
    requestId: z.string().uuid(),
    locale: localeInput,
  }).strict(),
]);

export const emailChangeInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request_codes"),
    newEmail: emailInput,
    locale: localeInput,
  }).strict(),
  z.object({
    action: z.literal("confirm"),
    challengeId: z.string().uuid(),
    currentCode: z.string().regex(/^\d{6}$/),
    newCode: z.string().regex(/^\d{6}$/),
    locale: localeInput,
  }).strict(),
  z.object({
    action: z.literal("cancel"),
    challengeId: z.string().uuid(),
    locale: localeInput,
  }).strict(),
]);

export type JsonRequestError =
  | "invalid_content_type"
  | "invalid_json"
  | "invalid_input"
  | "payload_too_large";

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel("payload_too_large");
      } catch {
        // The size decision remains authoritative even if transport cleanup fails.
      }
      return { ok: false };
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export async function parseJsonRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 4_096,
): Promise<
  | { ok: true; data: T }
  | { ok: false; error: JsonRequestError }
> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase().startsWith("application/json")) {
    return { ok: false, error: "invalid_content_type" };
  }
  const declaredLengthHeader = request.headers.get("content-length");
  const declaredLength = declaredLengthHeader === null
    ? null
    : Number(declaredLengthHeader);
  if (
    declaredLength !== null
    && Number.isFinite(declaredLength)
    && declaredLength > maxBytes
  ) {
    return { ok: false, error: "payload_too_large" };
  }
  const body = await readBoundedRequestBody(request, maxBytes);
  if (!body.ok) {
    return { ok: false, error: "payload_too_large" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body.text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: "invalid_input" };
}
