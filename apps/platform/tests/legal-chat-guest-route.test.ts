import assert from "node:assert/strict";
import test from "node:test";
import { env } from "./helpers/runtime-env";
import { GET, POST } from "../app/api/guest/ai/route";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";


test("native guest challenge precedes session creation and streams configuration failure without provider work", async () => {
  const fixture = await legalAnswerStorageFixture();
  const previousEnv = { ...env }, previousFetch = globalThis.fetch;
  const previousConfig = process.env.LEGAL_ANSWER_RUNTIME_CONFIG;
  const previousDevelopment = process.env.PRIVATE_DEVELOPMENT, previousPreview = process.env.LOCAL_AUTH_PREVIEW;
  process.env.PRIVATE_DEVELOPMENT = "true"; delete process.env.LOCAL_AUTH_PREVIEW;
  delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG;
  Object.assign(env, { DB: fixture.d1, APP_URL: "http://localhost:3000", APP_ENV: "development",
    GUEST_AI_ENABLED: "true", TURNSTILE_SECRET_KEY: "private-local",
    IDENTITY_KEYRING: JSON.stringify({ active: "fixture", versions: { fixture: {
      aead: Buffer.alloc(32, 7).toString("base64url"), hmac: Buffer.alloc(32, 8).toString("base64url"),
    } } }) });
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("Unexpected network work"); };
  const request = (token: string) => new Request("http://localhost:3000/api/guest/ai", { method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-juro-csrf": "1", "x-juro-client-ip": "192.0.2.1" },
    body: JSON.stringify({ question: "Artificial source question", locale: "en", idempotencyKey: "native-guest-fixture", turnstileToken: token }) });
  try {
    const rejected = await POST(request("rejected-fixture"));
    assert.equal(rejected.status, 400);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM guest_ai_sessions").get()?.n, 0);
    const accepted = await POST(request("private-local"));
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get("content-type")!, /text\/event-stream/);
    const cookie = accepted.headers.get("set-cookie");
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    const stream = await accepted.text();
    assert.match(stream, /event: error/);
    assert.doesNotMatch(stream, /event: result/);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM guest_ai_sessions").get()?.n, 1);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM guest_ai_runs").get()?.n, 0);
    const bootstrap = await GET(new Request("http://localhost:3000/api/guest/ai", { headers: { cookie: cookie.split(";", 1)[0] } }));
    assert.equal(bootstrap.status, 200);
    const saved = await bootstrap.json();
    assert.equal(saved.result, null);
    assert.equal(saved.providerConfigured, false);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(env)) delete env[key];
    Object.assign(env, previousEnv);
    if (previousConfig === undefined) delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG; else process.env.LEGAL_ANSWER_RUNTIME_CONFIG = previousConfig;
    if (previousDevelopment === undefined) delete process.env.PRIVATE_DEVELOPMENT; else process.env.PRIVATE_DEVELOPMENT = previousDevelopment;
    if (previousPreview === undefined) delete process.env.LOCAL_AUTH_PREVIEW; else process.env.LOCAL_AUTH_PREVIEW = previousPreview;
    fixture.sqlite.close();
  }
});

