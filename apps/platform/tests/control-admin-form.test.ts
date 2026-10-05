import assert from "node:assert/strict";
import test from "node:test";
import admin from "../../admin/src/worker";

const origin = "https://admin.juro.uz";

test("admin form retains browser Origin and validates its CSRF cookie", async () => {
  let requests = 0;
  const env = {
    APP_ENV: "production", PLATFORM_ORIGIN: "https://app.juro.uz",
    ADMIN_INTERNAL_TOKEN: "synthetic-internal-token-at-least-32-characters",
    ADMIN_CONSOLE_TOKEN: "synthetic-console-token-at-least-32-characters",
    PLATFORM_ADMIN_API: { fetch: async () => {
      requests++;
      return Response.json({ challengeId: crypto.randomUUID() });
    } },
  } as Env;
  const login = await admin.fetch(new Request(origin + "/login"), env);
  assert.equal(login.headers.get("referrer-policy"), "same-origin");
  const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;
  const token = (await login.text()).match(/name="_csrf" value="([A-Za-z0-9_-]{43})"/)![1]!;
  const submit = (source: string, withCookie = true) => admin.fetch(new Request(origin + "/login", {
    method: "POST",
    headers: { origin: source, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded", ...(withCookie ? { cookie } : {}) },
    body: new URLSearchParams({ _csrf: token, action: "request", email: "unallowed@example.org" }),
  }), env);
  assert.equal((await submit(origin)).status, 200);
  assert.equal(requests, 1);
  assert.equal((await submit("null")).status, 403);
  assert.equal((await submit("https://other.example")).status, 403);
  assert.equal((await submit(origin, false)).status, 403);
  assert.equal(requests, 1, "Rejected forms cannot request an email");
});
