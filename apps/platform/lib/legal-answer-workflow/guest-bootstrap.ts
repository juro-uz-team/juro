import type { IdentityKeyring } from "../auth/keyring";
import { clearGuestSessionCookie, GuestAiError, latestGuestAiRun, resolveGuestAiSession,
  revealGuestAiRunResult } from "../ai/guest-session";
import { withinSignal } from "./lifetime";

/** Saved guest content is returned unchanged; no current-law judgment or generation occurs on refresh. */
export async function handleGuestAnswerBootstrap(request: Request, configuration: {
  db: D1Database; keyring: IdentityKeyring; enabled: boolean; providerConfigured: boolean;
  siteKey: string | null; publicOrigin: string;
}): Promise<Response> {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request.method !== "GET") return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405, headers });
  const base = { enabled: configuration.enabled, providerConfigured: configuration.providerConfigured,
    siteKey: configuration.siteKey, session: null, result: null };
  if (!configuration.enabled) return Response.json(base, { headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  try {
    const session = await withinSignal(signal, () => resolveGuestAiSession({ ...configuration, request }));
    const run = await withinSignal(signal, () => latestGuestAiRun(configuration.db, session.id));
    const result: unknown = run ? JSON.parse(await withinSignal(signal, () => revealGuestAiRunResult({
      keyring: configuration.keyring, run }))) : null;
    // Recheck the bearer after storage/decryption, before releasing any saved content.
    const current = await withinSignal(signal, () => resolveGuestAiSession({ ...configuration, request }));
    if (current.id !== session.id) throw new Error("GUEST_SESSION_CHANGED");
    return Response.json({ ...base, result, session: { state: current.state, requestCount: current.requestCount,
      answerCount: current.answerCount, expiresAt: current.expiresAt } }, { headers });
  } catch (error) {
    if (error instanceof GuestAiError && ["GUEST_SESSION_REQUIRED", "GUEST_SESSION_INVALID", "GUEST_SESSION_EXPIRED"].includes(error.code)) {
      return Response.json(base, { headers: { ...headers,
        ...(error.code === "GUEST_SESSION_REQUIRED" ? {} : { "set-cookie": clearGuestSessionCookie(configuration.publicOrigin) }) } });
    }
    return Response.json({ code: "GUEST_SAVED_RESULT_UNAVAILABLE" }, { status: 503, headers });
  }
}
