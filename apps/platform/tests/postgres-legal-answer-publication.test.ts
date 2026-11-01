import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { withPostgresRollback } from "./helpers/postgres-rollback";
import { reserveAiRun } from "../lib/ai/run-store";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";
import type { PostgresDatabase } from "../lib/storage/postgres";
import { deleteAiConversation } from "../lib/ai/branch-store";
import { updateLegalFact, LegalFactUnavailable } from "../lib/legal-answer-workflow/facts";
import { loadCaseContext } from "../lib/legal-answer-workflow/case-context";
import { answerAllowanceAvailable } from "../lib/legal-answer-workflow/answer-allowance";

test("PostgreSQL early allowance handles aggregate values and preserves replay at the limit", async () => {
  await withPostgresRollback(async database => {
    const input = await publicationFixture(database);
    const admission = { ...input, idempotencyKey: randomUUID(), monthlyLimit: 1 };
    assert.equal(await answerAllowanceAvailable(admission), false);
    assert.equal(await answerAllowanceAvailable({ ...admission, monthlyLimit: 2 }), true);
    assert.equal(await answerAllowanceAvailable({ ...admission, idempotencyKey: input.idempotencyKey }), true);
  });
});

async function publicationFixture(database: PostgresDatabase) {
  const db = database as unknown as D1Database;
  const userId = randomUUID(), workspaceId = randomUUID(), now = new Date().toISOString();
  await database.batch([
    database.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES(?,?,?,?)")
      .bind(userId, `${userId}@example.test`, now, now),
    database.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES(?,'individual','Publication fixture',?,?)")
      .bind(workspaceId, now, now),
    database.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES(?,?,?,'owner','active',?,?,?)`).bind(randomUUID(), workspaceId, userId, now, now, now),
  ]);
  const request = { question: "Artificial question", language: "en" as const, format: "detailed" as const,
    mode: "deep" as const, actor: { tenantId: workspaceId, userId }, submittedAt: Date.now(),
    deadlineMs: 30_000, history: [], privateDocuments: [] };
  const input = { db, workspaceId, userId, idempotencyKey: randomUUID(), requestHash: randomUUID(),
    conversationId: null, provider: "openai", model: "gpt-6-luna", answerMode: request.format,
    reasoningMode: request.mode, legalDatabaseAsOf: "2026-10-28", instructionHash: "fixture", sourceVersionHash: "fixture" };
  const reservation = await reserveAiRun(input);
  if (reservation.kind !== "reserved") throw new Error("Expected reserved fixture");
  const response = serializeLegalOutcome({ kind: "insufficient_evidence", checkedEvidence: [], clarificationQuestions: [],
    gaps: [{ requirementId: "rule", description: "Artificial missing rule." }] }, request,
  { sources: [], legalDatabaseAsOf: input.legalDatabaseAsOf });
  return { ...input, ...reservation, ...request, response, signal: new AbortController().signal,
    usage: { providerResponseId: null, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, attempts: 0, latencyMs: 1 } };
}

test("PostgreSQL fact confirmation rejects foreign owners and revoked membership", async () => {
  await withPostgresRollback(async database => {
    const input = await publicationFixture(database), saved = await persistSignedInAnswer(input);
    const factId = randomUUID(), now = new Date().toISOString();
    await database.prepare(`INSERT INTO confirmed_facts(id,conversation_id,statement,status,created_at,updated_at)
      VALUES(?,?,'Artificial PostgreSQL fact','proposed',?,?)`).bind(factId, saved.conversationId, now, now).run();
    const update = { ...input, factId, status: "confirmed" as const };
    await assert.rejects(() => updateLegalFact({ ...update, userId: randomUUID() }), LegalFactUnavailable);
    assert.deepEqual(await updateLegalFact(update), { factId, status: "confirmed" });
    await database.prepare("UPDATE workspace_members SET status='suspended' WHERE workspace_id=? AND user_id=?")
      .bind(input.workspaceId, input.userId).run();
    await assert.rejects(() => updateLegalFact({ ...update, status: "rejected" }), LegalFactUnavailable);
    const fact = await database.prepare("SELECT status,confirmed_by_user_id AS owner FROM confirmed_facts WHERE id=?")
      .bind(factId).first<{status: string; owner: string}>();
    assert.deepEqual(fact, { status: "confirmed", owner: input.userId });
  });
});

test("PostgreSQL publication rolls back when a supplied case fact changes after interpretation", async () => {
  await withPostgresRollback(async database => {
    const input = await publicationFixture(database), root = await persistSignedInAnswer(input);
    const factId = randomUUID(), now = new Date().toISOString();
    await database.prepare(`INSERT INTO confirmed_facts(id,conversation_id,statement,status,created_at,updated_at)
      VALUES(?,?,'Artificial case date','confirmed',?,?)`).bind(factId, root.conversationId, now, now).run();
    const context = await loadCaseContext({ ...input, conversationId: root.conversationId });
    const next = { ...input, conversationId: root.conversationId, idempotencyKey: randomUUID(), requestHash: randomUUID() };
    const reservation = await reserveAiRun(next);
    if (reservation.kind !== "reserved") throw new Error("Expected follow-up reservation");
    await database.prepare("UPDATE confirmed_facts SET status='rejected' WHERE id=?").bind(factId).run();
    await assert.rejects(() => persistSignedInAnswer({ ...next, ...reservation, caseContext: context.receipt,
      branch: { operation: "follow_up", responseMessageId: root.responseMessageId } }), /CASE_CONTEXT_CHANGED/);
    const run = await database.prepare("SELECT status FROM ai_runs WHERE id=?").bind(reservation.runId).first<{status: string}>();
    assert.equal(run?.status, "reserved");
    const messages = await database.prepare("SELECT count(*) AS count FROM conversation_messages WHERE conversation_id=?")
      .bind(root.conversationId).first<{count: number}>();
    assert.equal(messages?.count, 2);
  });
});

test("PostgreSQL publication commits replayable messages under the retained transaction guards", async () => {
  await withPostgresRollback(async database => {
    const input = await publicationFixture(database);
    const saved = await persistSignedInAnswer(input);
    const replay = await reserveAiRun(input);
    assert.equal(replay.kind, "completed");
    if (replay.kind !== "completed") throw new Error("Expected completed replay");
    assert.equal(replay.responseMessageId, saved.responseMessageId);
    assert.deepEqual(replay.response, input.response);
  });
});

test("PostgreSQL publication checks live time after delayed statements and rolls back every write", async () => {
  await withPostgresRollback(async database => {
    const input = await publicationFixture(database);
    const batch = database.batch.bind(database);
    database.batch = statements => batch([
      ...statements.slice(0, -1), database.prepare("SELECT pg_sleep(0.12)"), statements.at(-1)!,
    ]);
    await assert.rejects(() => persistSignedInAnswer({ ...input,
      deadlineMs: Date.now() - input.submittedAt + 90 }), /PUBLICATION_DEADLINE_EXCEEDED/);
    const run = await database.prepare("SELECT status FROM ai_runs WHERE id=?").bind(input.runId).first<{status: string}>();
    assert.equal(run?.status, "reserved");
    const messages = await database.prepare(`SELECT count(*) AS count FROM conversation_messages m
      JOIN conversations c ON c.id=m.conversation_id WHERE c.owner_user_id=?`).bind(input.userId).first<{count: number}>();
    assert.equal(messages?.count, 0);
  });
});

test("PostgreSQL conversation deletion rejects revoked membership and preserves branch storage", async () => {
  await withPostgresRollback(async database => {
    const input = await publicationFixture(database);
    const saved = await persistSignedInAnswer(input);
    const batch = database.batch.bind(database);
    database.batch = async statements => {
      await database.prepare("UPDATE workspace_members SET status='suspended' WHERE workspace_id=? AND user_id=?")
        .bind(input.workspaceId, input.userId).run();
      return batch(statements);
    };
    await assert.rejects(() => deleteAiConversation({ ...input, conversationId: saved.conversationId }), /CONVERSATION_DELETE_FENCE_FAILED/);
    const branches = await database.prepare("SELECT count(*) AS count FROM message_branches WHERE conversation_id=?")
      .bind(saved.conversationId).first<{count: number}>();
    assert.equal(branches?.count, 1);
    const messages = await database.prepare("SELECT count(*) AS count FROM conversation_messages WHERE conversation_id=?")
      .bind(saved.conversationId).first<{count: number}>();
    assert.equal(messages?.count, 2);
  });
});

test("PostgreSQL owned conversation deletion clears immutable dependants in one transaction", async () => {
  await withPostgresRollback(async database => {
    const input = await publicationFixture(database);
    const saved = await persistSignedInAnswer(input);
    assert.equal(await deleteAiConversation({ ...input, conversationId: saved.conversationId }), "deleted");
    assert.equal(await database.prepare("SELECT id FROM conversations WHERE id=?").bind(saved.conversationId).first(), null);
    const run = await database.prepare(`SELECT status,conversation_id AS conversationId,
      request_message_id AS requestMessageId,response_message_id AS responseMessageId FROM ai_runs WHERE id=?`)
      .bind(input.runId).first();
    assert.deepEqual(run, { status: "completed", conversationId: null, requestMessageId: null, responseMessageId: null });
    const usage = await database.prepare("SELECT count(*) AS count FROM ai_usage_ledger WHERE ai_run_id=?")
      .bind(input.runId).first<{count: number}>();
    assert.equal(usage?.count, 1);
  });
});
