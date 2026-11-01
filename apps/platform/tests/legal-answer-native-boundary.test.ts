import assert from "node:assert/strict";
import test from "node:test";
import { env } from "./helpers/runtime-env";
import { platformLegalAnswerPost, guestLegalAnswerPost, guestLegalAnswerGet } from "../lib/legal-answer-workflow/platform-entry";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { setOperationalFeature } from "../lib/operations/operational-feature-flags";

for (const setting of ["false", undefined]) test(`guest setting ${setting} returns the unavailable-route status before storage or provider work`, async () => {
  const previous = env.GUEST_AI_ENABLED;
  if (setting === undefined) delete env.GUEST_AI_ENABLED; else env.GUEST_AI_ENABLED = setting;
  try {
    const response = await guestLegalAnswerPost(new Request("https://juro.example/api/guest/ai", {
      method: "POST", headers: { origin: "https://juro.example", "content-type": "application/json", "x-juro-csrf": "1" }, body: "{}",
    }));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const bootstrap = await guestLegalAnswerGet(new Request("https://juro.example/api/guest/ai"));
    assert.equal(bootstrap.status, 404);
    assert.equal((await bootstrap.json()).code, "GUEST_AI_DISABLED");
  } finally { if (previous === undefined) delete env.GUEST_AI_ENABLED; else env.GUEST_AI_ENABLED = previous; }
});

test("native request rejection does not depend on corpus or provider configuration", async () => {
  const previousOrigin = process.env.APP_URL, previousConfig = process.env.LEGAL_ANSWER_RUNTIME_CONFIG;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.APP_URL = "https://juro.example";
  delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG;
  Object.assign(env, { APP_URL: "https://juro.example", GUEST_AI_ENABLED: "true" });
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
  try {
    for (const handler of [platformLegalAnswerPost, guestLegalAnswerPost]) {
      const request = (origin: string, type = "application/json") => new Request("https://juro.example/api/ai", {
        method: "POST", headers: { origin, "content-type": type, "x-juro-csrf": "1" }, body: "{}",
      });
      assert.equal((await handler(request("https://foreign.example"))).status, 403);
      assert.equal((await handler(request("https://juro.example", "text/plain"))).status, 415);
      assert.equal((await handler(new Request("https://juro.example/api/ai"))).status, 405);
      assert.equal((await handler(request("https://juro.example"))).status, 503);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousOrigin;
    if (previousConfig === undefined) delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG; else process.env.LEGAL_ANSWER_RUNTIME_CONFIG = previousConfig;
    delete env.APP_URL; delete env.GUEST_AI_ENABLED;
  }
});

for (const pausedFeature of ["ai_chat", "ai_openai_primary", "ai_lex_web_discovery"] as const)
test(`operator pause ${pausedFeature} precedes corpus startup, authentication work and guest challenge`, async () => {
  const fixture = await legalAnswerStorageFixture();
  const previousOrigin = process.env.APP_URL, previousConfig = process.env.LEGAL_ANSWER_RUNTIME_CONFIG;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.APP_URL = "https://juro.example";
  delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG;
  Object.assign(env, { DB: fixture.d1, APP_URL: "https://juro.example", APP_ENV: "development", GUEST_AI_ENABLED: "true" });
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
  try {
    await setOperationalFeature({ db: fixture.d1, environment: "development", actorUserId: "u",
      value: { key: pausedFeature, enabled: false, reason: "Artificial maintenance pause" } });
    const before = fixture.sqlite.prepare("SELECT count(*) AS n FROM ai_runs").get()?.n;
    for (const handler of [platformLegalAnswerPost, guestLegalAnswerPost]) {
      const response = await handler(new Request("https://juro.example/api/ai", { method: "POST",
        headers: { origin: "https://juro.example", "content-type": "application/json", "x-juro-csrf": "1" }, body: "{}" }));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "OPERATIONAL_FEATURE_DISABLED");
    }
    assert.equal(calls, 0);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM ai_runs").get()?.n, before);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM guest_ai_sessions").get()?.n, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousOrigin;
    if (previousConfig === undefined) delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG; else process.env.LEGAL_ANSWER_RUNTIME_CONFIG = previousConfig;
    delete env.DB; delete env.APP_URL; delete env.APP_ENV; delete env.GUEST_AI_ENABLED;
    fixture.sqlite.close();
  }
});

test("guest malformed payload is rejected before corpus configuration or challenge dispatch", async () => {
  const fixture = await legalAnswerStorageFixture();
  const previousConfig = process.env.LEGAL_ANSWER_RUNTIME_CONFIG, previousFetch = globalThis.fetch;
  delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG;
  Object.assign(env, { DB: fixture.d1, APP_URL: "https://juro.example", APP_ENV: "development", GUEST_AI_ENABLED: "true" });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
  try {
    const response = await guestLegalAnswerPost(new Request("https://juro.example/api/guest/ai", { method: "POST",
      headers: { origin: "https://juro.example", "content-type": "application/json", "x-juro-csrf": "1" }, body: "{}" }));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM guest_ai_sessions").get()?.n, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfig === undefined) delete process.env.LEGAL_ANSWER_RUNTIME_CONFIG; else process.env.LEGAL_ANSWER_RUNTIME_CONFIG = previousConfig;
    delete env.DB; delete env.APP_URL; delete env.APP_ENV; delete env.GUEST_AI_ENABLED;
    fixture.sqlite.close();
  }
});
