import { normalizeEmail } from "../../../../lib/auth/crypto";
import { localDevelopmentAuthEnabled } from "../../../../lib/auth/development-auth";
import {
  clearLogoutPendingCookie,
  sessionCookie,
} from "../../../../lib/auth/session";
import { createLocalDevelopmentSession } from "../../../../lib/auth/session-management";
import { getOrCreateUserProfile } from "../../../../lib/document-builder/storage/db";
import {
  requireD1,
  runtimeEnv,
} from "../../../../lib/document-builder/storage/runtime";

const DEFAULT_EMAIL = "developer@local.juro.uz";
const DEFAULT_FULL_NAME = "JURO Local Developer";

function isLoopbackDevelopmentHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "127.0.0.1"
    || host === "::1"
    || host === "terminal.local";
}

function safeReturnPath(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const target = new URL(value, "http://localhost");
    if (target.origin !== "http://localhost") return "/";
    if (/^\/(?:signin-with-chatgpt|signout-with-chatgpt|callback|api\/auth\/dev-login)\/?$/u.test(target.pathname)) {
      return "/";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

function configuredEmail(value: string | undefined): string {
  const email = normalizeEmail(value || DEFAULT_EMAIL).slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    ? email
    : DEFAULT_EMAIL;
}

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (
    !localDevelopmentAuthEnabled()
    || !isLoopbackDevelopmentHost(requestUrl.hostname)
  ) {
    return notFound();
  }

  const env = runtimeEnv();
  const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"));
  const accountType = requestUrl.searchParams.get("accountType")
    ?? (/^\/(ru|uz|en)\/lawyer(?:\/|$)/u.test(returnTo) ? "lawyer" : "individual");
  if (accountType !== "individual" && accountType !== "lawyer") {
    return Response.json({ error: "Unsupported local account type" }, { status: 400 });
  }
  const baseEmail = configuredEmail(env.LOCAL_AUTH_EMAIL);
  const separator = baseEmail.lastIndexOf("@");
  const email = accountType === "lawyer"
    ? `${baseEmail.slice(0, separator)}+lawyer${baseEmail.slice(separator)}`
    : baseEmail;
  const fullName = env.LOCAL_AUTH_FULL_NAME?.trim().slice(0, 160)
    || DEFAULT_FULL_NAME;
  const profile = await getOrCreateUserProfile({
    email,
    fullName: accountType === "lawyer" ? `${fullName} (Lawyer)` : fullName,
    displayName: accountType === "lawyer" ? `${fullName} (Lawyer)` : fullName,
  });
  const db = requireD1();
  const now = new Date().toISOString();
  const locale = /^\/(ru|uz|en)(?:\/|$)/u.exec(returnTo)?.[1] ?? "ru";
  // These fixtures are provisioned only after the local development and host guards.
  await db.prepare(`UPDATE user_profiles SET account_type=?,locale=?,
    onboarding_completed_at=COALESCE(onboarding_completed_at,?),updated_at=? WHERE id=?`)
    .bind(accountType, locale, now, now, profile.id).run();
  if (accountType === "lawyer") {
    await db.prepare(`INSERT INTO lawyer_profiles
      (id,user_id,display_name,status,marketplace_status,public_approved_at,created_at,updated_at)
      VALUES (?, ?, ?, 'public_approved', 'public_approved', ?, ?, ?)
      ON CONFLICT(user_id) DO NOTHING`)
      .bind(crypto.randomUUID(), profile.id, profile.fullName ?? fullName, now, now, now).run();
  }
  const session = await createLocalDevelopmentSession(requireD1(), {
    userId: profile.id,
    userAgent: request.headers.get("user-agent"),
  });
  const headers = new Headers({
    location: returnTo === "/" ? `/${locale}/${accountType}/dashboard` : returnTo,
    "cache-control": "private, no-store",
    pragma: "no-cache",
  });
  headers.append("set-cookie", clearLogoutPendingCookie());
  headers.append("set-cookie", sessionCookie(session.token));
  return new Response(null, { status: 303, headers });
}
