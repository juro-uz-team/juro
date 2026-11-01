import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { createGuestAiSession, guestSessionCookie, revealGuestAiRunResult, latestGuestAiRun } from "../lib/ai/guest-session";
import { handleGuestAnswerHttp, GuestChallengeRequired } from "../lib/legal-answer-workflow/guest-http";

test("guest challenge failure remains a bad request and never opens answer dependencies", async () => {
  let opened = false;
  const response = await handleGuestAnswerHttp(new Request("https://juro.example/api/guest/ai", {
    method: "POST", headers: { origin: "https://juro.example", "content-type": "application/json", "x-juro-csrf": "1" },
    body: JSON.stringify({ question: "Artificial question", locale: "en", idempotencyKey: "challenge-fixture" }),
  }), { publicOrigin: "https://juro.example", deadlineMs: 30_000,
    authenticate: async () => { throw new GuestChallengeRequired(); },
    dependencies: async () => { opened = true; throw new Error("Unexpected dependencies"); } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "GUEST_CHALLENGE_REQUIRED");
  assert.equal(opened, false);
});

test("guest HTTP preserves the UI payload, session cookie and persisted streaming replay", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const keyring = { activeVersion: "test", versions: new Map([["test", {
      aead: new Uint8Array(32).fill(7), hmac: new Uint8Array(32).fill(8),
    }]]) };
    const { session, token } = await createGuestAiSession({ db: fixture.d1, keyring, connectingIp: "192.0.2.1", locale: "en" });
    let calls = 0, authenticated = 0;
    const config: Parameters<typeof handleGuestAnswerHttp>[1] = {
      publicOrigin: "https://juro.example", deadlineMs: 30_000,
      authenticate: async (_request, payload) => {
        authenticated++;
        assert.equal(payload.turnstileToken, "fixture-challenge");
        return { db: fixture.d1, keyring, session, cookie: guestSessionCookie(session.id, token, "https://juro.example") };
      },
      dependencies: async () => ({ model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: "fixture",
        createExecution: async ({ request }) => {
          assert.equal(request.mode, "fast");
          assert.equal(request.format, "detailed");
          return { model: legalEntryFixture({ complete: async ({ stage }) => {
            calls++;
            return stage === "interpret" ? { needsClarification: true, complexity: "simple", requirements: [{ id: "r", question: "Artificial rule?" }],
              queries: ["artificial rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: ["What happened in your case?"] }
              : { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "r", description: "Unavailable" }], actions: [] };
          } }), corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
            resolve: async () => null, get: async () => null }, citations: async () => [], usage: () => fixture.input.usage };
        } }),
    };
    const request = (extra = {}, origin = "https://juro.example") => new Request("https://juro.example/api/guest/ai", {
      method: "POST", headers: { origin, "content-type": "application/json", "x-juro-csrf": "1" },
      body: JSON.stringify({ question: "Artificial question", locale: "en", idempotencyKey: "guest-http-fixture",
        turnstileToken: "fixture-challenge", ...extra }),
    });
    assert.equal((await handleGuestAnswerHttp(request({}, "https://foreign.example"), config)).status, 403);
    assert.equal((await handleGuestAnswerHttp(request({ documentIds: ["private"] }), config)).status, 400);
    assert.equal(authenticated, 0);
    const response = await handleGuestAnswerHttp(request(), config);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
    const body = await response.text();
    assert.match(body, /interpreting/);
    assert.doesNotMatch(body, /focused_research|deeper_research/);
    const frame = body.split("\n\n").find(value => value.startsWith("event: result\n"));
    assert.ok(frame);
    const delivered = JSON.parse(frame.split("data: ")[1]);
    assert.deepEqual(delivered.result.clarificationQuestions, ["What happened in your case?"]);
    assert.equal(delivered.result.failureReason, undefined);
    const run = await latestGuestAiRun(fixture.d1, session.id);
    assert.ok(run);
    assert.deepEqual(delivered.result, JSON.parse(await revealGuestAiRunResult({ keyring, run })));
    assert.ok((await (await handleGuestAnswerHttp(request(), config)).text()).includes(frame));
    assert.equal(calls, 1);
  } finally { fixture.sqlite.close(); }
});
