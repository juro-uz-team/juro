import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { createGuestAiSession, guestSessionCookie, reserveGuestAiRun, completeGuestAiRun } from "../lib/ai/guest-session";
import { handleGuestAnswerBootstrap } from "../lib/legal-answer-workflow/guest-bootstrap";

test("guest bootstrap decrypts only the authenticated session and clears invalid cookies", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const keyring = { activeVersion: "test", versions: new Map([["test", {
      aead: new Uint8Array(32).fill(7), hmac: new Uint8Array(32).fill(8),
    }]]) };
    const config = { db: fixture.d1, keyring, enabled: true, providerConfigured: true,
      siteKey: "public-challenge", publicOrigin: "https://juro.example" };
    const created = await createGuestAiSession({ ...config, connectingIp: "192.0.2.2", locale: "en" });
    const reservation = await reserveGuestAiRun({ ...config, session: created.session, idempotencyKey: "bootstrap-fixture",
      requestHash: "b".repeat(64), provider: "openai", model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28",
      instructionHash: "c".repeat(64), sourceVersionHash: "d".repeat(64), question: "Artificial question" });
    await completeGuestAiRun({ ...config, run: reservation.run, resultJson: JSON.stringify(fixture.input.response),
      responseKind: "clarification_required", provider: "openai", model: "gpt-6-luna", ...fixture.input.usage });
    const request = (token: string) => new Request(`${config.publicOrigin}/api/guest/ai`, {
      headers: { cookie: guestSessionCookie(created.session.id, token, config.publicOrigin).split(";")[0] },
    });
    const response = await handleGuestAnswerBootstrap(request(created.token), config);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body.result, fixture.input.response);
    assert.equal(body.session.state, "available");
    assert.equal(body.session.tokenHmac, undefined);
    const denied = await handleGuestAnswerBootstrap(request((created.token[0] === "a" ? "b" : "a") + created.token.slice(1)), config);
    assert.equal((await denied.json()).result, null);
    assert.match(denied.headers.get("set-cookie")!, /Max-Age=0/i);
    fixture.sqlite.prepare("UPDATE guest_ai_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(created.session.id);
    assert.equal((await (await handleGuestAnswerBootstrap(request(created.token), config)).json()).session, null);
  } finally { fixture.sqlite.close(); }
});
