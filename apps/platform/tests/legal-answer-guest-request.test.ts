import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { createGuestAiSession } from "../lib/ai/guest-session";
import { executeGuestAnswer } from "../lib/legal-answer-workflow/guest-request";
import type { LegalRequest } from "../lib/legal-answer-workflow/contracts";

test("guest execution encrypts delivery, replays and carries only its own clarification history", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const keyring = { activeVersion: "test", versions: new Map([["test", {
      aead: new Uint8Array(32).fill(7), hmac: new Uint8Array(32).fill(8),
    }]]) };
    const { session } = await createGuestAiSession({ db: fixture.d1, keyring, connectingIp: "192.0.2.1", locale: "en" });
    let calls = 0, revokeDuringAssessment = false;
    const histories: LegalRequest["history"][] = [];
    const dependencies: Parameters<typeof executeGuestAnswer>[1] = {
      model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: "fixture",
      createExecution: async ({ request }) => {
        histories.push(request.history);
        assert.deepEqual(request.privateDocuments, []);
        return { model: legalEntryFixture({ complete: async ({ stage }) => {
          calls++;
          if (stage === "write" && revokeDuringAssessment) {
            fixture.sqlite.prepare("UPDATE guest_ai_sessions SET token_hmac=? WHERE id=?").run("revoked", session.id);
          }
          return stage === "interpret" ? { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Artificial rule?" }],
            queries: ["artificial rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] }
            : { decision: "insufficient_evidence", content: null, gaps: [{ requirementId: "r", description: "Unavailable" }], actions: [] };
        } }), corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
          resolve: async () => null, get: async () => null }, citations: async () => [], usage: () => fixture.input.usage };
      },
    };
    const input = { db: fixture.d1, keyring, session, question: "Artificial guest question",
      language: "en" as const, format: "detailed" as const, mode: "fast" as const,
      idempotencyKey: "guest-fixture-1", submittedAt: Date.now(), deadlineMs: 30_000, signal: new AbortController().signal };
    const delivered = await executeGuestAnswer(input, dependencies);
    assert.equal(delivered.kind, "completed");
    assert.deepEqual(await executeGuestAnswer(input, dependencies), delivered);
    assert.equal(calls, 2);
    const rows = fixture.sqlite.prepare("SELECT request_ciphertext,result_ciphertext FROM guest_ai_runs").all();
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes(input.question));
    assert.ok(!JSON.stringify(rows).includes("Unavailable"));
    await executeGuestAnswer({ ...input, question: "Additional artificial fact", idempotencyKey: "guest-fixture-2" }, dependencies);
    assert.equal(histories[0].length, 0);
    assert.equal(histories[1].length, 2);
    assert.equal(histories[1][0].content, input.question);
    await assert.rejects(() => executeGuestAnswer({ ...input, session: { ...session, tokenHmac: "foreign" } }, dependencies), /GUEST_SESSION_UNAVAILABLE/);
    assert.equal(calls, 4);
    const cancelled = new AbortController();
    cancelled.abort(new Error("TEST_CANCELLED"));
    await assert.rejects(() => executeGuestAnswer({ ...input, signal: cancelled.signal,
      idempotencyKey: "guest-cancelled" }, dependencies), /TEST_CANCELLED/);
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM guest_ai_runs").get()?.n, 2);
    revokeDuringAssessment = true;
    await assert.rejects(() => executeGuestAnswer({ ...input, idempotencyKey: "guest-revoked" }, dependencies));
    const failed = fixture.sqlite.prepare("SELECT status,result_ciphertext FROM guest_ai_runs WHERE idempotency_key='guest-revoked'").get();
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.result_ciphertext, null);
  } finally { fixture.sqlite.close(); }
});
