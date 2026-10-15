import { requireD1 } from "../document-builder/storage/runtime";
import { assertSafeWrite } from "./safe-write";
import { logoutResponseHeaders } from "./logout-response";
import {
  localSessionFromCookie,
  revokeOneSession,
} from "./session-management";
import { sessionTokenFromCookie } from "./session-token";

type LogoutDependencies = {
  database: typeof requireD1;
  sessionFromCookie: typeof localSessionFromCookie;
  revokeSession: typeof revokeOneSession;
  reportFailure: (error: unknown) => void;
};

const defaultDependencies: LogoutDependencies = {
  database: requireD1,
  sessionFromCookie: localSessionFromCookie,
  revokeSession: revokeOneSession,
  reportFailure(error) {
    console.warn("JURO logout server revocation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  },
};

function localizedNavigationTarget(
  request: Request,
  serverConfirmed: boolean,
): string {
  const url = new URL(request.url);
  const requestedLocale = url.searchParams.get("locale");
  const locale = requestedLocale === "uz" || requestedLocale === "en"
    ? requestedLocale
    : "ru";
  const login = serverConfirmed
    ? `/${locale}/auth/login`
    : `/${locale}/auth/login?reauth=1&logout=server-unconfirmed`;
  return login;
}

function isSameOriginNavigation(request: Request): boolean {
  if (request.method !== "POST") return false;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return false;
  }
  const requestOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;
  try {
    const canonicalOrigin = new URL(suppliedOrigin).origin;
    if (suppliedOrigin !== canonicalOrigin || canonicalOrigin !== requestOrigin) {
      return false;
    }
  } catch {
    return false;
  }
  return request.headers.get("sec-fetch-site") === "same-origin"
    && request.headers.get("sec-fetch-mode") === "navigate"
    && request.headers.get("sec-fetch-dest") === "document";
}

function navigationResponse(
  request: Request,
  headers: Headers,
  serverConfirmed: boolean,
): Response {
  headers.set("location", localizedNavigationTarget(request, serverConfirmed));
  return new Response(null, { status: 303, headers });
}

export async function handleLogout(
  request: Request,
  dependencies: LogoutDependencies = defaultDependencies,
): Promise<Response> {
  const navigation = request.headers.get("x-juro-csrf") !== "1";
  if (navigation) {
    if (!isSameOriginNavigation(request)) {
      // Reuse the canonical error shape without weakening the normal API
      // boundary for fetch/XHR requests.
      assertSafeWrite(request);
    }
  } else {
    assertSafeWrite(request);
  }
  const headers = logoutResponseHeaders(request.url);
  const raw = request.headers.get("cookie") ?? "";
  // An already signed-out browser has no server session to revoke. Avoid
  // turning an idempotent logout into a 503 merely because D1 is unavailable
  // (or its runtime binding cannot be resolved) when no bearer exists.
  if (!sessionTokenFromCookie(raw)) {
    if (navigation) {
      return navigationResponse(request, headers, true);
    }
    return new Response(null, { status: 204, headers });
  }
  try {
    const db = dependencies.database();
    const session = await dependencies.sessionFromCookie(db, raw, {
      touch: false,
      // This is the sole lookup allowed to see through the client marker: the
      // logout endpoint still needs the old bearer in order to revoke it.
      allowLogoutPending: true,
    });
    if (session) {
      await dependencies.revokeSession(db, {
        userId: session.userId,
        sessionId: session.sessionId,
        currentSessionId: session.sessionId,
        revokeDeviceContinuity: false,
      });
    }
  } catch (error) {
    try {
      dependencies.reportFailure(error);
    } catch {
      // Telemetry is best-effort and must never prevent local cookie expiry.
    }
    if (navigation) {
      return navigationResponse(request, headers, false);
    }
    return Response.json(
      {
        ok: false,
        code: "SESSION_REVOCATION_DEFERRED",
        clientSessionCleared: true,
        serverSessionRevoked: false,
      },
      { status: 503, headers },
    );
  }
  if (navigation) {
    return navigationResponse(request, headers, true);
  }
  return new Response(null, { status: 204, headers });
}
