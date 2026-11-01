import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { reserveAiRun } from "../lib/ai/run-store";
import { createGuestAiSession, reserveGuestAiRun, completeGuestAiRun } from "../lib/ai/guest-session";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";

test("signed reservation replay and publication remain owned during extended execution", async context => {
  const now = Date.now();
  context.mock.timers.enable({ apis: ["Date"], now });
  const fixture = await legalAnswerStorageFixture();
  try {
    context.mock.timers.tick(230_000);
    assert.equal((await reserveAiRun(fixture.input)).kind, "processing");
    const saved = await persistSignedInAnswer({ ...fixture.input, submittedAt: now, deadlineMs: 240_000 });
    const replay = await reserveAiRun(fixture.input);
    assert.equal(replay.kind, "completed");
    if (replay.kind === "completed") assert.equal(replay.responseMessageId, saved.responseMessageId);
  } finally { fixture.sqlite.close(); context.mock.timers.reset(); }
});

test("guest reservation permits late publication and completed replay within the request ceiling", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const now = new Date(), later = new Date(now.getTime() + 230_000);
    const keyring = { activeVersion: "test", versions: new Map([["test", {
      aead: new Uint8Array(32).fill(7), hmac: new Uint8Array(32).fill(8),
    }]]) };
    const { session } = await createGuestAiSession({ db: fixture.d1, keyring, connectingIp: "192.0.2.1", locale: "en", now });
    const input = { db: fixture.d1, session, keyring, now, idempotencyKey: "extended-guest", requestHash: "a".repeat(64),
      provider: "openai", model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", instructionHash: "fixture",
      sourceVersionHash: "fixture", question: "Artificial permit question" };
    const reservation = await reserveGuestAiRun(input);
    assert.equal(reservation.kind, "created");
    if (reservation.kind !== "created") throw new Error("Expected reservation");
    await completeGuestAiRun({ db: fixture.d1, keyring, run: reservation.run, resultJson: JSON.stringify(fixture.input.response),
      responseKind: "clarification_required", provider: "openai", model: "gpt-6-luna", inputTokens: 0, outputTokens: 0,
      cachedInputTokens: 0, attempts: 0, latencyMs: 230_000, now: later });
    assert.equal((await reserveGuestAiRun({ ...input, now: later })).kind, "completed");
  } finally { fixture.sqlite.close(); }
});
