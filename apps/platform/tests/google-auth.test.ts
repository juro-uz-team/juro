import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { env } from "./helpers/runtime-env";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";
import { GET as callback } from "../app/api/auth/google/callback/route";
import { POST as start } from "../app/api/auth/google/start/route";
import { POST as complete } from "../app/api/auth/google/complete/route";
import { POST as verifyMfa } from "../app/api/auth/verify-mfa/route";
import { identityKeyring } from "../lib/auth/mfa-http";
import { beginTotpEnrollment, confirmTotpEnrollment } from "../lib/auth/mfa-service";
import { createPrimarySessionIfMfaDisabled } from "../lib/auth/session-management";
import { totpCode } from "../lib/auth/totp";
import { googleOAuthConfig, readGoogleFlow } from "../lib/auth/google-oauth";

const origin = "https://staging.app.juro.uz";
const clientId = "test.apps.googleusercontent.com";

function request(path: string, data: unknown, cookie?: string) {
  return new Request(origin + path, {
    method: "POST",
    headers: {
      origin, "content-type": "application/json", "x-juro-csrf": "1",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(data),
  });
}

function cookieFrom(response: Response, name: string) {
  const value = response.headers.getSetCookie().find(value => value.startsWith(name + "="));
  assert.ok(value);
  assert.match(value, /; HttpOnly; Secure; SameSite=Lax;/);
  return value.split(";")[0];
}

test("Google signup, repeat sign-in, explicit existing-account linking and callback failures", async t => {
  const { sqlite, d1 } = sqliteD1Fixture();
  t.after(() => sqlite.close());
  const migration = readFileSync(new URL("../postgres/0068-google-account-sign-in.sql", import.meta.url), "utf8");
  sqlite.exec(migration.split("CREATE FUNCTION", 1)[0].replaceAll("app.", ""));
  Object.assign(env, { DB: d1, APP_ENV: "development", IDENTITY_PROTECTION_MODE: "legacy" });
  const configEnv = { APP_URL: origin, GOOGLE_AUTH_CLIENT_ID: clientId, GOOGLE_AUTH_CLIENT_SECRET: "test-google-secret" };
  const previousConfig = Object.fromEntries(Object.keys(configEnv).map(name => [name, process.env[name]]));
  Object.assign(process.env, configEnv);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previousConfig)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "fixture-key", alg: "RS256" };
  let jwt = "", ver = "", exchanges = 0;
  globalThis.fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : input.toString());
    if (target.hostname === "www.googleapis.com") return Response.json({ keys: [jwk] });
    assert.equal(target.href, "https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("redirect_uri"), origin + "/api/auth/google/callback");
    assert.equal(body.get("code_verifier"), ver);
    assert.equal(body.get("client_secret"), configEnv.GOOGLE_AUTH_CLIENT_SECRET);
    exchanges++;
    return Response.json({ id_token: jwt });
  };

  async function begin() {
    const result = await start(request("/api/auth/google/start", {
      locale: "en", mode: "login", returnTo: "/en/workspace/document-analysis",
    }));
    assert.equal(result.status, 200);
    const url = new URL((await result.json()).authorizationUrl);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const flowCookie = cookieFrom(result, "__Host-juro_google_flow");
    const flow = readGoogleFlow(googleOAuthConfig()!, flowCookie);
    assert.ok(flow);
    ver = flow.verifier;
    return { url, flowCookie };
  }
  async function googleCallback(email: string, subject: string, invalidNonce = false) {
    const { url, flowCookie } = await begin();
    jwt = await new SignJWT({
      email, email_verified: true, name: "Google QA",
      nonce: invalidNonce ? "different-nonce" : url.searchParams.get("nonce"),
    }).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .setSubject(subject).setIssuer("https://accounts.google.com")
      .setAudience(clientId).setIssuedAt().setExpirationTime("5m").sign(privateKey);
    return callback(new Request(`${origin}/api/auth/google/callback?state=${url.searchParams.get("state")}&code=test-code`, {
      headers: { cookie: flowCookie },
    }));
  }

  assert.equal((await start(new Request(origin + "/api/auth/google/start", { method: "POST" }))).status, 403);
  const missing = await callback(new Request(origin + "/api/auth/google/callback?state=fake&code=test"));
  assert.equal(missing.headers.get("location"), origin + "/en/auth/login?google=failed");
  assert.equal(exchanges, 0);
  const wrongNonce = await googleCallback("newuser@gmail.com", "google-new", true);
  assert.match(wrongNonce.headers.get("location")!, /google=failed/);
  const nonGoogleEmail = await googleCallback("newuser@example.test", "google-other");
  assert.match(nonGoogleEmail.headers.get("location")!, /google=email/);

  const first = await googleCallback("newuser@gmail.com", "google-new");
  assert.equal(first.status, 303);
  assert.equal(first.headers.get("location"), origin + "/en/auth/google");
  const proof = cookieFrom(first, "__Host-juro_google_proof");
  const signup = { kind: "signup", name: "Google QA", accountType: "individual", acceptTerms: true, acceptPrivacy: true, acceptPersonalData: true };
  assert.equal((await complete(request("/api/auth/google/complete", { ...signup, acceptPrivacy: false }, proof))).status, 400);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM user_profiles").get()?.n, 0);
  const registered = await complete(request("/api/auth/google/complete", signup, proof));
  assert.equal(registered.status, 200);
  assert.equal((await registered.json()).redirectTo, "/en/workspace/document-analysis");
  assert.match(registered.headers.getSetCookie().join(" "), /juro_session=\S+/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM user_acceptances WHERE auth_source='google'").get()?.n, 3);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM auth_sessions WHERE auth_method='google'").get()?.n, 1);
  assert.equal((await complete(request("/api/auth/google/complete", signup, proof))).status, 409);

  const again = cookieFrom(await googleCallback("changed@gmail.com", "google-new"), "__Host-juro_google_proof");
  assert.equal((await complete(request("/api/auth/google/complete", { kind: "login" }, again))).status, 200);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM user_profiles").get()?.n, 1);

  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO user_profiles (id,email,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run("existing-user", "existing@gmail.com", now, now, now);
  const existing = cookieFrom(await googleCallback("existing@gmail.com", "google-existing"), "__Host-juro_google_proof");
  assert.equal((await complete(request("/api/auth/google/complete", { kind: "login" }, existing))).status, 400);
  assert.equal((await complete(request("/api/auth/google/complete", { kind: "link" }, existing))).status, 403);
  const oldSession = await createPrimarySessionIfMfaDisabled(d1, { userId: "existing-user", userAgent: null, authMethod: "password" });
  assert.ok(oldSession);
  const linked = await complete(request("/api/auth/google/complete", { kind: "link" }, `${existing}; juro_session=${oldSession.token}`));
  assert.equal(linked.status, 200);
  const returning = cookieFrom(await googleCallback("existing@gmail.com", "google-existing"), "__Host-juro_google_proof");
  assert.equal((await complete(request("/api/auth/google/complete", { kind: "login" }, returning))).status, 200);

  env.IDENTITY_KEYRING = JSON.stringify({
    active: "test", versions: { test: { aead: Buffer.alloc(32, 1).toString("base64url"), hmac: Buffer.alloc(32, 2).toString("base64url") } },
  });
  const enrollment = await beginTotpEnrollment(d1, identityKeyring(), {
    userId: "existing-user", sessionId: oldSession.sessionId, email: "existing@gmail.com",
  });
  const confirmed = await confirmTotpEnrollment(d1, identityKeyring(), {
    userId: "existing-user", sessionId: oldSession.sessionId, currentToken: oldSession.token,
    credentialId: enrollment.credentialId, code: (await totpCode(enrollment.secret, new Date())).code,
  });
  const mfaProof = cookieFrom(await googleCallback("existing@gmail.com", "google-existing"), "__Host-juro_google_proof");
  const mfa = await complete(request("/api/auth/google/complete", { kind: "login" }, mfaProof));
  assert.equal(mfa.status, 200);
  assert.equal((await mfa.json()).requiresTwoFactor, true);
  assert.ok(!mfa.headers.getSetCookie().some(value => value.startsWith("juro_session=")));
  const mfaCookie = mfa.headers.getSetCookie().find(value => value.startsWith("juro_mfa_challenge="))?.split(";")[0];
  assert.ok(mfaCookie);
  const verifiedMfa = await verifyMfa(request("/api/auth/verify-mfa", {
    code: confirmed.backupCodes[0], locale: "en", returnTo: "/en/workspace/document-analysis",
  }, mfaCookie));
  assert.equal(verifiedMfa.status, 200);
  assert.equal((await verifiedMfa.json()).redirectTo, "/en/workspace/document-analysis");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM auth_sessions WHERE auth_method='google+backup_code'").get()?.n, 1);

  sqlite.prepare(`UPDATE user_profiles
    SET lifecycle_status='deleted',email='deleted.existing@invalid.juro',deletion_completed_at=?
    WHERE id='existing-user'`).run(now);
  const deleted = cookieFrom(await googleCallback("existing@gmail.com", "google-existing"), "__Host-juro_google_proof");
  assert.equal((await complete(request("/api/auth/google/complete", { kind: "login" }, deleted))).status, 403);
});
