export const authTurnstileActions = {
  passwordLogin: "auth_password_login", registration: "auth_registration",
  registrationResend: "auth_registration_resend", passwordReset: "auth_password_reset",
  passwordResetResend: "auth_password_reset_resend",
} as const;
export type AuthTurnstileAction = typeof authTurnstileActions[keyof typeof authTurnstileActions];
export type TurnstileValidationResult = { status: "verified" | "invalid" | "unavailable" };

/** Private deployments are protected by their SSH-only listener, not an external challenge service. */
export async function validateTurnstile(input: {
  secretKey: string; token: string; remoteIp: string | null; expectedHostname: string;
  expectedAction: string | readonly string[]; fetcher?: typeof fetch;
}): Promise<TurnstileValidationResult> {
  if (process.env.PRIVATE_DEVELOPMENT !== "true") return { status: "unavailable" };
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
