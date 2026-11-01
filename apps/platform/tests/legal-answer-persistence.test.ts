import assert from "node:assert/strict";
import test from "node:test";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";
import { reserveAiRun } from "../lib/ai/run-store";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";

test("a persisted answer can be replayed through the retained reservation interface", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES(?,?,?,?)").run("u", "fixture@example.test", now, now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES(?,?,?,?,?)").run("w", "individual", "Fixture", now, now);
  sqlite.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
    VALUES('member','w','u','owner','active',?,?,?)`).run(now, now, now);
  const reservationInput = { db: d1, submittedAt: Date.now(), deadlineMs: 30_000,
    workspaceId: "w", userId: "u", idempotencyKey: "fixture-key", requestHash: "fixture-hash",
    conversationId: null, provider: "openai", model: "gpt-6-luna", answerMode: "detailed" as const,
    reasoningMode: "deep" as const, legalDatabaseAsOf: "2026-10-28", instructionHash: "instructions", sourceVersionHash: "sources" };
  const reservation = await reserveAiRun(reservationInput);
  assert.equal(reservation.kind, "reserved");
  if (reservation.kind !== "reserved") throw new Error("Fixture reservation failed");
  const response = serializeLegalOutcome({ kind: "insufficient_evidence", checkedEvidence: [], clarificationQuestions: [],
    gaps: [{ requirementId: "r", description: "Artificial rule unavailable." }] },
  { question: "Artificial question", language: "en", format: "detailed", mode: "deep", actor: { tenantId: "w", userId: "u" },
    submittedAt: Date.now(), deadlineMs: 30_000, history: [], privateDocuments: [] },
  { sources: [], legalDatabaseAsOf: "2026-10-28" });
  try {
    const saved = await persistSignedInAnswer({ ...reservationInput, ...reservation,
      question: "Artificial question", response, signal: new AbortController().signal,
      usage: { providerResponseId: null, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, attempts: 0, latencyMs: 10 },
    });
    const replay = await reserveAiRun(reservationInput);
    assert.equal(replay.kind, "completed");
    if (replay.kind !== "completed") throw new Error("Expected completed replay");
    assert.equal(replay.responseMessageId, saved.responseMessageId);
    assert.deepEqual(replay.response, response);
  } finally { sqlite.close(); }
});
