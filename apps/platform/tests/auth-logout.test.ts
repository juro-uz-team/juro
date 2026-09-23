import assert from "node:assert/strict";
import test from "node:test";
import { env } from "./helpers/runtime-env";

import {
  createLogoutAction,
  executeLogout,
  localizedSignOutPath,
} from "../app/_platform/logout-client";
import { POST as logoutRoute } from "../app/api/auth/logout/route";
import { handleLogout } from "../lib/auth/logout-handler";
import {
  replacementSessionCookies,
} from "../lib/auth/session";
import {
  createEmailOtpSession,
  localSessionFromCookie,
  revokeOneSession,
} from "../lib/auth/session-management";
import {
  logoutPendingCookie,
} from "../lib/auth/session-persistence";
import { LOGOUT_PENDING_COOKIE } from "../lib/auth/session-token";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

function logoutRequest(host = "app.juro.uz"): Request {
  return new Request(`https://${host}/api/auth/logout?locale=ru`, {
    method: "POST",
    headers: {
      cookie: `juro_session=${"a".repeat(43)}`,
      origin: `https://${host}`,
      "sec-fetch-site": "same-origin",
      "x-juro-csrf": "1",
    },
  });
}

function anonymousLogoutRequest(host = "app.juro.uz"): Request {
  return new Request(`https://${host}/api/auth/logout?locale=ru`, {
    method: "POST",
    headers: {
      origin: `https://${host}`,
      "sec-fetch-site": "same-origin",
      "x-juro-csrf": "1",
    },
  });
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return headers.getSetCookie?.()
    ?? [headers.get("set-cookie") ?? ""];
}

function applySetCookie(jar: Map<string, string>, setCookie: string): void {
  const [pair] = setCookie.split(";", 1);
  const separator = pair.indexOf("=");
  assert.ok(separator > 0, `invalid Set-Cookie: ${setCookie}`);
  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  if (/(?:^|;)\s*Max-Age=0(?:;|$)/iu.test(setCookie)) {
    jar.delete(name);
  } else {
    jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join("; ");
}

test("already signed-out logout is idempotent without touching D1", async () => {
  let databaseTouched = false;
  const response = await handleLogout(anonymousLogoutRequest(), {
    database() {
      databaseTouched = true;
      throw new Error("D1 must not be required without a session bearer");
    },
    sessionFromCookie: async () => null,
    revokeSession: async () => ({ revoked: false, revokedCurrent: false }),
    reportFailure() {
      assert.fail("idempotent anonymous logout must not report revocation failure");
    },
  });

  assert.equal(response.status, 204);
  assert.equal(databaseTouched, false);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("clear-site-data"), '"cache"');
  assert.match(setCookies(response).join("\n"), /juro_session=.*Max-Age=0/u);
});

test("the Next route context cannot replace logout dependencies", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const workerEnv = env as unknown as Record<string, unknown>;
  const previousDatabase = workerEnv.DB;
  const now = new Date();
  sqlite.prepare(
    `INSERT INTO user_profiles (id,email,locale,created_at,updated_at)
     VALUES ('route-user','route@example.test','ru',?,?)`,
  ).run(now.toISOString(), now.toISOString());
  const session = await createEmailOtpSession(d1, {
    userId: "route-user",
    userAgent: "Browser/route-context",
    now,
  });
  workerEnv.DB = d1;

  try {
    const request = new Request(
      "https://app.juro.uz/api/auth/logout?locale=ru",
      {
        method: "POST",
        headers: {
          cookie: `juro_session=${session.token}`,
          origin: "https://app.juro.uz",
          "sec-fetch-site": "same-origin",
          "x-juro-csrf": "1",
        },
      },
    );
    const route = logoutRoute as unknown as (
      request: Request,
      context: { params: Promise<Record<string, string>> },
    ) => Promise<Response>;
    const response = await route(request, { params: Promise.resolve({}) });

    assert.equal(response.status, 204);
    assert.match(setCookies(response).join("\n"), /juro_session=.*Max-Age=0/u);
    const persisted = sqlite.prepare(
      "SELECT revoked_at AS revokedAt FROM auth_sessions WHERE id=?",
    ).get(session.sessionId) as { revokedAt: string | null };
    assert.ok(persisted.revokedAt, "the active server session must be revoked");
    assert.equal(await localSessionFromCookie(
      d1,
      `juro_session=${session.token}`,
      { touch: false },
    ), null, "the old bearer must not authenticate after logout");
  } finally {
    if (previousDatabase === undefined) delete workerEnv.DB;
    else workerEnv.DB = previousDatabase;
    sqlite.close();
  }
});

test("logout expires browser auth cookies even when D1 is unavailable", async () => {
  const failures: string[] = [];
  const response = await handleLogout(logoutRequest(), {
    database() {
      throw new Error("D1 unavailable");
    },
    sessionFromCookie: async () => null,
    revokeSession: async () => ({ revoked: false, revokedCurrent: false }),
    reportFailure(error) {
      failures.push(error instanceof Error ? error.message : String(error));
    },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("clear-site-data"), '"cache"');
  const cookies = setCookies(response).join("\n");
  assert.match(cookies, /juro_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0/u);
  assert.match(cookies, /juro_session=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Domain=\.juro\.uz/u);
  assert.match(cookies, /juro_mfa_challenge=; Path=\/api\/auth\/verify-mfa; HttpOnly; Secure; SameSite=Strict; Max-Age=0/u);
  assert.match(cookies, /__Host-juro_logout_pending=; Path=\/; Secure; SameSite=Lax; Max-Age=0/u);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "SESSION_REVOCATION_DEFERRED",
    clientSessionCleared: true,
    serverSessionRevoked: false,
  });
  assert.deepEqual(failures, ["D1 unavailable"]);
});

test("lookup and revocation failures retain the same cookie-expiry boundary", async t => {
  for (const phase of ["lookup", "revoke"] as const) {
    await t.test(phase, async () => {
      const database = {} as D1Database;
      const response = await handleLogout(logoutRequest(), {
        database: () => database,
        sessionFromCookie: async () => {
          if (phase === "lookup") throw new Error("lookup failed");
          return {
            userId: "user-1",
            sessionId: "session-1",
          } as Awaited<ReturnType<NonNullable<Parameters<typeof handleLogout>[1]>["sessionFromCookie"]>>;
        },
        revokeSession: async () => {
          throw new Error("revoke failed");
        },
        reportFailure() {},
      });

      assert.equal(response.status, 503);
      const cookies = setCookies(response).join("\n");
      assert.match(cookies, /juro_session=.*Max-Age=0/u);
      assert.match(cookies, /juro_mfa_challenge=.*Max-Age=0/u);
      await response.body?.cancel();
    });
  }
});

test("unsafe cross-origin logout is rejected before cookies or D1 are touched", async () => {
  let databaseTouched = false;
  const request = logoutRequest();
  request.headers.set("origin", "https://attacker.invalid");
  await assert.rejects(
    handleLogout(request, {
      database() {
        databaseTouched = true;
        return {} as D1Database;
      },
      sessionFromCookie: async () => null,
      revokeSession: async () => ({ revoked: false, revokedCurrent: false }),
      reportFailure() {},
    }),
    (error: unknown) => Boolean(
      error instanceof Error
      && "status" in error
      && error.status === 403
    ),
  );
  assert.equal(databaseTouched, false);
});

test("same-origin form navigation clears HttpOnly state and replaces the protected page", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const now = new Date();
  sqlite.prepare(
    `INSERT INTO user_profiles (id,email,locale,created_at,updated_at)
     VALUES ('navigation-user','navigation@example.test','en',?,?)`,
  ).run(now.toISOString(), now.toISOString());
  const session = await createEmailOtpSession(d1, {
    userId: "navigation-user",
    userAgent: "Browser/navigation",
    now,
  });
  const request = new Request(
    "https://app.juro.uz/api/auth/logout?locale=en",
    {
      method: "POST",
      headers: {
        cookie: `juro_session=${session.token}; ${LOGOUT_PENDING_COOKIE}=1`,
        origin: "https://app.juro.uz",
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
      },
      body: "logout=1",
    },
  );
  try {
    const response = await handleLogout(request, {
      database: () => d1,
      sessionFromCookie: localSessionFromCookie,
      revokeSession: revokeOneSession,
      reportFailure() {},
    });
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      "/signout-with-chatgpt?return_to=%2Fen%2Fauth%2Flogin",
    );
    assert.match(setCookies(response).join("\n"), /juro_session=.*Max-Age=0/u);
    assert.match(
      setCookies(response).join("\n"),
      /__Host-juro_logout_pending=.*Max-Age=0/u,
    );
    assert.equal(await localSessionFromCookie(
      d1,
      `juro_session=${session.token}`,
      { touch: false, now: new Date(now.getTime() + 1_000) },
    ), null);
  } finally {
    sqlite.close();
  }
});

test("logout revokes the current server session without forgetting device continuity", async () => {
  const database = {} as D1Database;
  let revokedInput: Parameters<NonNullable<Parameters<typeof handleLogout>[1]>["revokeSession"]>[1] | null = null;
  const response = await handleLogout(logoutRequest("lawyer.juro.uz"), {
    database: () => database,
    sessionFromCookie: async () => ({
      userId: "user-1",
      sessionId: "session-1",
    }) as Awaited<ReturnType<NonNullable<Parameters<typeof handleLogout>[1]>["sessionFromCookie"]>>,
    revokeSession: async (_db, input) => {
      revokedInput = input;
      return { revoked: true, revokedCurrent: true };
    },
    reportFailure() {
      assert.fail("successful logout must not report a revocation failure");
    },
  });

  assert.equal(response.status, 204);
  assert.deepEqual(revokedInput, {
    userId: "user-1",
    sessionId: "session-1",
    currentSessionId: "session-1",
    revokeDeviceContinuity: false,
  });
  assert.match(setCookies(response).join("\n"), /Domain=\.juro\.uz/u);
});

test("client logout is single-flight, bounded, and replaces history with localized signout", async () => {
  let fetchCalls = 0;
  let releaseFetch!: (response: Response) => void;
  const fetched = new Promise<Response>(resolve => {
    releaseFetch = resolve;
  });
  const replacements: string[] = [];
  let sensitiveStateClears = 0;
  const events: string[] = [];
  const runtime = {
    fetch: async () => {
      events.push("fetch");
      fetchCalls += 1;
      return fetched;
    },
    replace: (url: string) => replacements.push(url),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    markLogoutPending: () => events.push("marker"),
    clearSensitiveState: () => {
      sensitiveStateClears += 1;
    },
  };
  const logout = createLogoutAction(() => runtime);

  const first = logout("uz");
  const second = logout("uz");
  assert.equal(first, second);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(events, ["marker", "fetch"]);
  releaseFetch(new Response(null, { status: 204 }));
  await first;

  assert.deepEqual(replacements, [localizedSignOutPath("uz")]);
  assert.equal(sensitiveStateClears, 1);
  assert.equal(replacements[0], "/signout-with-chatgpt?return_to=%2Fuz%2Fauth%2Flogin");
});

test("client logout still replaces the page without an auth redirect loop after server failure", async () => {
  const replacements: string[] = [];
  await executeLogout("ru", {
    fetch: async () => Response.json(
      { code: "SESSION_REVOCATION_DEFERRED" },
      { status: 503 },
    ),
    replace: url => replacements.push(url),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    markLogoutPending: () => undefined,
  });

  assert.deepEqual(replacements, [localizedSignOutPath("ru", false)]);
  const redirect = new URL(replacements[0], "https://app.juro.uz");
  assert.equal(redirect.pathname, "/signout-with-chatgpt");
  assert.equal(
    redirect.searchParams.get("return_to"),
    "/ru/auth/login?reauth=1&logout=server-unconfirmed",
  );
});

test("client logout aborts a stalled revocation request and still exits", async () => {
  const replacements: string[] = [];
  const navigationSubmissions: string[] = [];
  let fetchSawAbort = false;
  let markerWritten = false;
  await executeLogout("uz", {
    fetch: async (_input, init) => {
      fetchSawAbort = init.signal?.aborted === true;
      throw new DOMException("The operation was aborted", "AbortError");
    },
    replace: url => replacements.push(url),
    setTimeout: ((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 1;
    }) as typeof globalThis.setTimeout,
    clearTimeout: () => undefined,
    markLogoutPending: () => {
      markerWritten = true;
    },
    submitLogoutNavigation: locale => navigationSubmissions.push(locale),
  });

  assert.equal(markerWritten, true);
  assert.equal(fetchSawAbort, true);
  assert.deepEqual(replacements, []);
  assert.deepEqual(navigationSubmissions, ["uz"]);
});

test("total-offline logout blocks the surviving bearer until a fresh session clears the marker", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const now = new Date("2026-09-04T13:00:00.000Z");
  sqlite.prepare(
    `INSERT INTO user_profiles (id,email,locale,created_at,updated_at)
     VALUES ('offline-user','offline@example.test','uz',?,?)`,
  ).run(now.toISOString(), now.toISOString());
  const oldSession = await createEmailOtpSession(d1, {
    userId: "offline-user",
    userAgent: "Browser/offline",
    rememberMe: true,
    now,
  });
  const jar = new Map<string, string>([["juro_session", oldSession.token]]);
  let navigationAttempts = 0;
  try {
    await executeLogout("uz", {
      fetch: async () => {
        throw new TypeError("network offline");
      },
      replace: () => assert.fail("no response exists for a redirect"),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      markLogoutPending: () => applySetCookie(jar, logoutPendingCookie()),
      submitLogoutNavigation: () => {
        // A real browser queues this navigation, then renders its network
        // error page. No Set-Cookie response exists during the outage.
        navigationAttempts += 1;
      },
    });
    assert.equal(navigationAttempts, 1);
    const markedCookies = cookieHeader(jar);
    assert.match(markedCookies, /__Host-juro_logout_pending=1/u);

    // Connectivity returns, but ordinary protected-session resolution must
    // fail before hashing or querying the still-live server bearer.
    assert.equal(await localSessionFromCookie(d1, markedCookies, {
      touch: false,
      now: new Date(now.getTime() + 1_000),
    }), null);
    assert.equal(await localSessionFromCookie(
      d1,
      `${LOGOUT_PENDING_COOKIE}=tampered; juro_session=${oldSession.token}; ${LOGOUT_PENDING_COOKIE}=`,
      { touch: false, now: new Date(now.getTime() + 1_000) },
    ), null, "duplicate or malformed marker values remain fail-closed");
    assert.equal(
      (await localSessionFromCookie(d1, markedCookies, {
        allowLogoutPending: true,
        touch: false,
        now: new Date(now.getTime() + 1_000),
      }))?.sessionId,
      oldSession.sessionId,
      "only the canonical logout revoke path may see through the marker",
    );

    const freshSession = await createEmailOtpSession(d1, {
      userId: "offline-user",
      userAgent: "Browser/recovered",
      rememberMe: false,
      now: new Date(now.getTime() + 2_000),
    });
    for (const cookie of replacementSessionCookies(
      freshSession.token,
      false,
      "app.juro.uz",
    )) applySetCookie(jar, cookie);

    const recoveredCookies = cookieHeader(jar);
    assert.doesNotMatch(recoveredCookies, new RegExp(LOGOUT_PENDING_COOKIE, "u"));
    assert.equal(
      (await localSessionFromCookie(d1, recoveredCookies, {
        touch: false,
        now: new Date(now.getTime() + 3_000),
      }))?.sessionId,
      freshSession.sessionId,
    );
  } finally {
    sqlite.close();
  }
});
