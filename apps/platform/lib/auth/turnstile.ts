import { challengeSecretConfigured, verifyNativeChallenge } from "./native-challenge";
import { database } from "../storage/connection";

export const authTurnstileActions = {
  passwordLogin: "auth_password_login", registration: "auth_registration",
  registrationResend: "auth_registration_resend", passwordReset: "auth_password_reset",
  passwordResetResend: "auth_password_reset_resend",
} as const;
export type AuthTurnstileAction = typeof authTurnstileActions[keyof typeof authTurnstileActions];
export type TurnstileValidationResult = { status: "verified" | "invalid" | "unavailable" };

/** Retain the existing request contract while verifying challenges entirely in the native runtime. */
export async function validateTurnstile(input: {
  secretKey: string; token: string; remoteIp: string | null; expectedHostname: string;
  expectedAction: string | readonly string[]; fetcher?: typeof fetch;
}): Promise<TurnstileValidationResult> {
  if (process.env.PRIVATE_DEVELOPMENT !== "true") {
    if (!challengeSecretConfigured(input.secretKey)) return { status: "unavailable" };
    const verified = await verifyNativeChallenge({secret: input.secretKey, token: input.token, hostname: input.expectedHostname,
      actions: typeof input.expectedAction === "string" ? [input.expectedAction] : input.expectedAction,
      consume: async (id, expires) => {
        const pool = database().pool;
        await pool.query("DELETE FROM app.auth_challenge_redemptions WHERE expires_at < now()");
        const result = await pool.query("INSERT INTO app.auth_challenge_redemptions(id,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id", [id, expires]);
        return result.rowCount === 1;
      }});
    return { status: verified ? "verified" : "invalid" };
  }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(input.expectedHostname.toLowerCase())) return { status: "invalid" };
  const actions = typeof input.expectedAction === "string" ? [input.expectedAction] : input.expectedAction;
  if (!actions.length || actions.some(action => !/^[a-z][a-z0-9_]{2,31}$/.test(action))) return { status: "invalid" };
  return { status: input.secretKey === "private-local" && input.token === "private-local" ? "verified" : "invalid" };
}

export function validateAuthTurnstile(input: {
  secretKey: string; token: string; remoteIp: string | null; expectedHostname: string;
  expectedActions: readonly AuthTurnstileAction[]; fetcher?: typeof fetch;
}): Promise<TurnstileValidationResult> {
  return validateTurnstile({ ...input, expectedAction: input.expectedActions });
}
export const guestAiTurnstileAction = "guest_ai";
