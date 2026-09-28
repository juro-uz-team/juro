import { createChallenge, extractParams, verifySolution } from "altcha-lib/v1";
import { createHash } from "node:crypto";

export const nativeChallengeActions = ["auth_password_login", "auth_registration", "auth_registration_resend", "auth_password_reset", "auth_password_reset_resend", "guest_ai"] as const;
export const nativeChallengeLifetimeSeconds = 300;
export function challengeSecretConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && /^[a-f0-9]{64}$/i.test(secret);
}

export async function issueNativeChallenge(secret: string, hostname: string, action: string) {
  if (!challengeSecretConfigured(secret) || !(nativeChallengeActions as readonly string[]).includes(action)) throw new Error("Invalid challenge configuration");
  return createChallenge({ algorithm: "SHA-256", hmacKey: secret, maxnumber: 100_000,
    expires: new Date(Date.now() + nativeChallengeLifetimeSeconds * 1000), params: { hostname, action } });
}

export async function verifyNativeChallenge(input: {
  secret: string; token: string; hostname: string; actions: readonly string[];
  consume: (id: string, expires: Date) => Promise<boolean>;
}): Promise<boolean> {
  if (!challengeSecretConfigured(input.secret) || input.token.length > 2048) return false;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(input.token, "base64").toString("utf8"));
    if (!payload || payload.algorithm !== "SHA-256" || !Number.isSafeInteger(payload.number) || payload.number < 0 || payload.number > 100_000
      || typeof payload.salt !== "string" || payload.salt.length > 512 || !/^[a-f0-9]{64}$/.test(payload.challenge) || !/^[a-f0-9]{64}$/.test(payload.signature)) return false;
    const params = extractParams(payload);
    const expires = Number(params.expires);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expires) || expires <= now || expires > now + nativeChallengeLifetimeSeconds
      || params.hostname !== input.hostname || !input.actions.includes(params.action)) return false;
    if (!await verifySolution(payload, input.secret, true)) return false;
    return await input.consume(createHash("sha256").update(payload.signature).digest("hex"), new Date(expires * 1000));
  } catch { return false; }
}
