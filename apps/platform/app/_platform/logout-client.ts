"use client";

import { logoutPendingCookie } from "../../lib/auth/session-persistence";
import type { PlatformLocale } from "../../lib/platform/routing";

const LOGOUT_TIMEOUT_MS = 8_000;

type LogoutRuntime = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  replace: (url: string) => void;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  markLogoutPending: () => void;
  clearSensitiveState?: () => void;
  submitLogoutNavigation?: (locale: PlatformLocale) => void;
};

const SENSITIVE_SESSION_KEYS = new Set([
  "juro-document-builder-draft-v1",
  "juro-document-builder-test-draft",
]);

function clearSensitiveBrowserState(): void {
  try {
    const keys = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.key(index),
    ).filter((key): key is string => Boolean(key));
    for (const key of keys) {
      if (
        SENSITIVE_SESSION_KEYS.has(key)
        || key.startsWith("juro-configured-draft-")
      ) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Navigation and cookie expiry remain authoritative when browser storage
    // is blocked by privacy mode.
  }
}

export function localizedLoginPath(locale: PlatformLocale): string {
  return `/${locale}/auth/login`;
}

export function localizedSignOutPath(
  locale: PlatformLocale,
  serverConfirmed = true,
): string {
  const login = serverConfirmed
    ? localizedLoginPath(locale)
    : `${localizedLoginPath(locale)}?reauth=1&logout=server-unconfirmed`;
  return login;
}

function browserRuntime(): LogoutRuntime {
  return {
    fetch: window.fetch.bind(window),
    replace: url => window.location.replace(url),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    markLogoutPending() {
      window.document.cookie = logoutPendingCookie();
    },
    clearSensitiveState: clearSensitiveBrowserState,
    submitLogoutNavigation(locale) {
      const action = `/api/auth/logout?locale=${encodeURIComponent(locale)}`;
      // Replace the protected history entry before the navigation. If the
      // network is offline, the browser leaves the sensitive document for its
      // navigation error page; once reachable, the POST receives authoritative
      // HttpOnly expiry headers and a 303 to the localized sign-in flow.
      window.history.replaceState(
        null,
        "",
        localizedSignOutPath(locale, false),
      );
      const form = window.document.createElement("form");
      form.method = "post";
      form.action = action;
      form.hidden = true;
      window.document.body.appendChild(form);
      form.submit();
    },
  };
}

export async function executeLogout(
  locale: PlatformLocale,
  runtime: LogoutRuntime,
): Promise<void> {
  // Establish the server-visible fail-closed state synchronously, before any
  // request can stall or fail. Cookie assignment errors must not prevent the
  // reachable-server logout path from still clearing the HttpOnly bearer.
  try {
    runtime.markLogoutPending();
  } catch {
    // Best effort only when the browser refuses all client cookie writes.
  }
  const controller = new AbortController();
  const timeout = runtime.setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
  let serverConfirmed = false;
  let responseReceived = false;
  try {
    const response = await runtime.fetch(
      `/api/auth/logout?locale=${encodeURIComponent(locale)}`,
      {
        method: "POST",
        headers: { "x-juro-csrf": "1" },
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        signal: controller.signal,
      },
    );
    responseReceived = true;
    serverConfirmed = response.status === 204;
    await response.body?.cancel().catch(() => undefined);
  } catch {
    serverConfirmed = false;
  } finally {
    runtime.clearTimeout(timeout);
    try {
      runtime.clearSensitiveState?.();
    } catch {
      // A storage failure must never trap the user inside an authenticated UI.
    }
  }
  if (!responseReceived && runtime.submitLogoutNavigation) {
    runtime.submitLogoutNavigation(locale);
    return;
  }
  runtime.replace(localizedSignOutPath(locale, serverConfirmed));
}

export function createLogoutAction(
  runtimeFactory: () => LogoutRuntime,
): (locale: PlatformLocale) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return locale => {
    if (!inFlight) inFlight = executeLogout(locale, runtimeFactory());
    return inFlight;
  };
}

const browserLogout = createLogoutAction(browserRuntime);

export function performLogout(locale: PlatformLocale): Promise<void> {
  return browserLogout(locale);
}
