import {LEGAL_CHAT_PROVIDER_TIMEOUT_MS,LEGAL_CHAT_RESERVATION_TTL_MS} from "../lib/legal-chat/execution-limits";
import {aiDatabase} from "./helpers/ai-run-database";
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveLegalEvidenceMode,
  legalChatResponseSchema,
} from "../lib/ai/legal-chat-schema";
import {
  AiRunConflictError,
  beginAiRunFinalization,
  failAiRun,
  completeAiRun,
  completeAiRunStatements,
  readAiRunStatus,
  reserveAiRun,
} from "../lib/ai/run-store";
import { readResponsesSse, ResponsesSseError } from "../lib/ai/responses-sse";

const validLegalResponse = {
  responseKind: "clarification_required" as const,
  summary: "Нужно уточнить дату события.",
  answer: "Без даты нельзя надёжно определить применимую редакцию нормы.",
  language: "ru" as const,
  jurisdiction: "UZ" as const,
  answerMode: "detailed" as const,
  reasoningMode: "fast" as const,
  clarificationQuestions: ["Когда произошло событие?"],
  confirmedFindings: [],
  assumptions: [{ statement: "Дата события пока неизвестна.", impact: "Срок и редакция нормы предварительны." }],
  risks: [],
  sources: [],
  requiredDocuments: [],
  actionPlan: [{ title: "Уточнить дату", description: "Найдите документ с датой события.", sourceIds: [] }],
  deadlines: [{ title: "Предварительный срок", dueDate: null, sourceDate: null, calculationMethod: "Нужна дата события.", confidence: "preliminary" as const, sourceIds: [] }],
  successOutlook: null,
  urgency: "normal" as const,
  suggestedDocument: null,
  suggestLawyer: false,
  legalDatabaseAsOf: "unavailable",
};

test("stored LegalChatResponse retains strict locale and jurisdiction fields", () => {
  assert.deepEqual(legalChatResponseSchema.parse(validLegalResponse), validLegalResponse);
  assert.equal(legalChatResponseSchema.safeParse({ ...validLegalResponse, jurisdiction: "US" }).success, false);
  assert.equal(legalChatResponseSchema.safeParse({ ...validLegalResponse, hidden: "not allowed" }).success, false);
});

test("legacy stored responses derive authority mode when the optional field is absent", () => {
  const official = {
    sourceId: "legacy-lex",
    actTitle: "Legacy Lex act",
    actIdentifier: "1",
    article: "1",
    excerpt: "A previously stored exact excerpt.",
    originalUrl: "https://lex.uz/ru/docs/1",
    status: "current" as const,
    effectiveDate: null,
    verifiedAt: "2026-01-01T00:00:00.000Z",
  };
  const web = {
    ...official,
    sourceId: "legacy-web",
    actIdentifier: null,
    originalUrl: "https://guidance.example/article",
    status: "unconfirmed" as const,
  };
  assert.equal(deriveLegalEvidenceMode({ sources: [official] }), "official");
  assert.equal(deriveLegalEvidenceMode({ sources: [web] }), "secondary_only");
  assert.equal(deriveLegalEvidenceMode({ sources: [official, web] }), "mixed");
  assert.equal(deriveLegalEvidenceMode({ sources: [] }), "none");
});

test("OpenAI Responses SSE parser handles split structured-output frames and reports bounded progress", async () => {
  const serialized = JSON.stringify(validLegalResponse);
  const stream = [
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: serialized.slice(0, 180) })}\r\n\r\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: serialized.slice(180) })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp-stream",
        model: "gpt-5.6-sol",
        status: "completed",
        output: [],
        usage: { input_tokens: 11, output_tokens: 22, input_tokens_details: { cached_tokens: 3 } },
      },
    })}\n\n`,
  ].join("");
  const bytes = new TextEncoder().encode(stream);
  const response = chunkedResponse(bytes, [7, 31, 89, 211]);
  const progress: number[] = [];
  const payload = await readResponsesSse(response, (event) => {
    if (event.stage === "provider_delta") progress.push(event.receivedCharacters);
  });
  const text = payload.output?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  assert.equal(text, serialized);
  assert.deepEqual(JSON.parse(text || "{}"), validLegalResponse);
  assert.ok(progress.length >= 1);
  assert.equal(progress.at(-1), serialized.length);
});

test("OpenAI Responses SSE exposes accumulated output only to the server-internal observer", async () => {
  const stream = [
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: '{"confirmed' })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: 'Findings":[]}' })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: { id: "resp-buffer", model: "gpt-5.6-terra", status: "completed", output: [] },
    })}\n\n`,
  ].join("");
  const buffers: string[] = [];
  await readResponsesSse(
    chunkedResponse(new TextEncoder().encode(stream), [17, 41]),
    () => undefined,
    { onOutputTextBuffer: (text) => { buffers.push(text); } },
  );
  assert.deepEqual(buffers, ['{"confirmed', '{"confirmedFindings":[]}']);
});

test("OpenAI Responses SSE parser records the first actual non-empty provider delta once", async () => {
  const stream = [
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "" })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "{" })}\n\n`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "}" })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp-first-delta",
        model: "gpt-5.6-sol",
        status: "completed",
        output: [],
      },
    })}\n\n`,
  ].join("");
  let clock = 1_000;
  const firstDeltas: Array<{ elapsedMs: number; receivedCharacters: number }> = [];
  await readResponsesSse(
    chunkedResponse(new TextEncoder().encode(stream), [13, 37, 89]),
    () => undefined,
    {
      startedAt: 975,
      now: () => {
        clock += 10;
        return clock;
      },
      onFirstDelta: (timing) => {
        firstDeltas.push(timing);
      },
    },
  );
  assert.deepEqual(firstDeltas, [{
    startedAt: 975,
    firstDeltaAt: 1_010,
    elapsedMs: 35,
    receivedCharacters: 1,
  }]);
});

test("OpenAI Responses SSE parser fails closed on malformed provider events", async () => {
  const response = chunkedResponse(new TextEncoder().encode("event: response.output_text.delta\ndata: {not-json}\n\n"), [9]);
  await assert.rejects(
    readResponsesSse(response, () => undefined),
    (error: unknown) => error instanceof ResponsesSseError && error.code === "INVALID_AI_OUTPUT",
  );
});
test("cancelled AI run releases reserved usage and records no charge", async () => {
  const { sqlite, d1 } = aiDatabase();
  const reserved = await reserveAiRun(reservationInput(d1, "cancelled-request", 1));
  assert.equal(reserved.kind, "reserved");
  if (reserved.kind !== "reserved") return;

  await failAiRun({
    db: d1,
    runId: reserved.runId,
    ledgerId: reserved.ledgerId,
    workspaceId: "workspace-1",
    userId: "user-1",
    idempotencyKey: "cancelled-request",
    errorCode: "AI_CANCELLED",
  });

  const run = sqlite.prepare("SELECT status,error_code AS errorCode FROM ai_runs WHERE id=?")
    .get(reserved.runId) as { status: string; errorCode: string };
  const ledger = sqlite.prepare("SELECT status FROM ai_usage_ledger WHERE id=?")
    .get(reserved.ledgerId) as { status: string };
  const idempotency = sqlite.prepare("SELECT status FROM idempotency_keys WHERE key=?")
    .get("legal-chat:workspace-1:user-1:cancelled-request") as { status: string };
  assert.equal(run.status, "failed");
  assert.equal(run.errorCode, "AI_CANCELLED");
  assert.equal(ledger.status, "released");
  assert.equal(idempotency.status, "failed");

  const terminalReplay = await reserveAiRun(reservationInput(d1, "cancelled-request", 1));
  assert.equal(terminalReplay.kind, "failed");
  if (terminalReplay.kind === "failed") {
    assert.equal(terminalReplay.runId, reserved.runId);
    assert.equal(terminalReplay.errorCode, "AI_CANCELLED");
  }
  assert.deepEqual(await readAiRunStatus({
    db: d1,
    workspaceId: "workspace-1",
    userId: "user-1",
    idempotencyKey: "cancelled-request",
  }), { kind: "failed", runId: reserved.runId, errorCode: "AI_CANCELLED" });
  assert.deepEqual(await readAiRunStatus({
    db: d1,
    workspaceId: "workspace-1",
    userId: "user-2",
    idempotencyKey: "cancelled-request",
  }), { kind: "missing" });
});


function chunkedResponse(bytes: Uint8Array, boundaries: number[]): Response {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const boundary of boundaries) {
    const end = Math.min(boundary, bytes.length);
    if (end > offset) chunks.push(bytes.slice(offset, end));
    offset = end;
  }
  if (offset < bytes.length) chunks.push(bytes.slice(offset));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), {
    headers: { "content-type": "text/event-stream" },
  });
}

test("AI run reservation is idempotent and clarification does not consume a cycle", async () => {
  const { sqlite, d1 } = aiDatabase();
  const input = reservationInput(d1, "request-one", 1);
  const first = await reserveAiRun(input);
  assert.equal(first.kind, "reserved");
  if (first.kind !== "reserved") return;
  assert.deepEqual(await readAiRunStatus({
    db: d1,
    workspaceId: "workspace-1",
    userId: "user-1",
    idempotencyKey: "request-one",
  }), { kind: "processing", runId: first.runId });

  const inProgress = await reserveAiRun(input);
  assert.equal(inProgress.kind, "processing");
  if (inProgress.kind === "processing") assert.equal(inProgress.runId, first.runId);

  sqlite.prepare("INSERT INTO conversations(id) VALUES (?)").run("conversation-1");
  sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,structured_json) VALUES (?,?,?)")
    .run("assistant-1", "conversation-1", JSON.stringify(validLegalResponse));
  await completeAiRun({
    db: d1, runId: first.runId, ledgerId: first.ledgerId,
    workspaceId: "workspace-1", userId: "user-1", idempotencyKey: "request-one",
    conversationId: "conversation-1", requestMessageId: "user-1-message", responseMessageId: "assistant-1",
    providerResponseId: "resp-1", model: "gpt-5.6-sol", inputTokens: 100,
    provider: "openai",
    fallbackFromProvider: null,
    outputTokens: 50, cachedInputTokens: 10, attempts: 1, latencyMs: 200,
    sourceVersionHash: "d".repeat(64), legalDatabaseAsOf: "2026-08-02T12:00:00.000Z",
    chargeable: false,
  });
  assert.deepEqual({...sqlite.prepare("SELECT source_version_hash,legal_database_as_of FROM ai_runs WHERE id=?").get(first.runId)}, {
    source_version_hash: "d".repeat(64), legal_database_as_of: "2026-08-02T12:00:00.000Z",
  });

  const replay = await reserveAiRun(input);
  assert.equal(replay.kind, "completed");
  if (replay.kind === "completed") {
    assert.equal(replay.conversationId, "conversation-1");
    assert.deepEqual(replay.response, validLegalResponse);
  }
  const ledger = sqlite.prepare("SELECT status,input_tokens AS inputTokens FROM ai_usage_ledger WHERE id=?")
    .get(first.ledgerId) as { status: string; inputTokens: number };
  assert.equal(ledger.status, "released");
  assert.equal(ledger.inputTokens, 100);
  const completedStatus = await readAiRunStatus({
    db: d1,
    workspaceId: "workspace-1",
    userId: "user-1",
    idempotencyKey: "request-one",
  });
  assert.equal(completedStatus.kind, "completed");
  if (completedStatus.kind === "completed") {
    assert.equal(completedStatus.runId, first.runId);
    assert.equal(completedStatus.conversationId, "conversation-1");
    assert.equal(completedStatus.responseMessageId, "assistant-1");
    assert.equal(completedStatus.branchId, null);
  }
});

test("AI completion persists the actual fallback provider and model", async () => {
  const { sqlite, d1 } = aiDatabase();
  const reserved = await reserveAiRun(reservationInput(d1, "fallback-request", 2));
  assert.equal(reserved.kind, "reserved");
  if (reserved.kind !== "reserved") return;
  sqlite.prepare("INSERT INTO conversations(id) VALUES (?)").run("conversation-fallback");
  sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,structured_json) VALUES (?,?,?)").run("assistant-fallback", "conversation-fallback", JSON.stringify(validLegalResponse));
  await completeAiRun({ db: d1, runId: reserved.runId, ledgerId: reserved.ledgerId, workspaceId: "workspace-1", userId: "user-1", idempotencyKey: "fallback-request", conversationId: "conversation-fallback", requestMessageId: "user-fallback", responseMessageId: "assistant-fallback", providerResponseId: "msg-fallback", provider: "anthropic", fallbackFromProvider: "openai", model: "claude-sonnet-4-6", inputTokens: 80, outputTokens: 40, cachedInputTokens: 0, attempts: 1, latencyMs: 150, chargeable: true });
  const run = sqlite.prepare("SELECT provider,model,fallback_from_provider AS fallbackFromProvider FROM ai_runs WHERE id=?").get(reserved.runId) as Record<string, string>;
  assert.equal(run.provider, "anthropic");
  assert.equal(run.model, "claude-sonnet-4-6");
  assert.equal(run.fallbackFromProvider, "openai");
  const ledger = sqlite.prepare("SELECT provider,model,status FROM ai_usage_ledger WHERE id=?").get(reserved.ledgerId) as Record<string, string>;
  assert.equal(ledger.provider, "anthropic");
  assert.equal(ledger.model, "claude-sonnet-4-6");
  assert.equal(ledger.status, "consumed");
});

test("AI completion cannot commit its ledger when an earlier conversation write fails", async () => {
  const { sqlite, d1 } = aiDatabase();
  const reserved = await reserveAiRun(reservationInput(d1, "atomic-completion-request", 2));
  assert.equal(reserved.kind, "reserved");
  if (reserved.kind !== "reserved") return;

  await assert.rejects(d1.batch([
    d1.prepare("INSERT INTO conversations(id) VALUES (?)").bind("conversation-atomic"),
    d1.prepare("INSERT INTO conversations(id) VALUES (?)").bind("conversation-atomic"),
    ...completeAiRunStatements({
      db: d1, runId: reserved.runId, ledgerId: reserved.ledgerId,
      workspaceId: "workspace-1", userId: "user-1", idempotencyKey: "atomic-completion-request",
      conversationId: "conversation-atomic", requestMessageId: "request-atomic", responseMessageId: "response-atomic",
      providerResponseId: "response-provider-atomic", provider: "openai", fallbackFromProvider: null,
      model: "gpt-5.6-sol", inputTokens: 10, outputTokens: 20, cachedInputTokens: 0,
      attempts: 1, latencyMs: 100, chargeable: true,
    }),
  ]));

  const run = sqlite.prepare("SELECT status FROM ai_runs WHERE id=?").get(reserved.runId) as { status: string };
  const ledger = sqlite.prepare("SELECT status FROM ai_usage_ledger WHERE id=?").get(reserved.ledgerId) as { status: string };
  const idempotency = sqlite.prepare("SELECT status FROM idempotency_keys WHERE key=?")
    .get("legal-chat:workspace-1:user-1:atomic-completion-request") as { status: string };
  assert.equal(run.status, "reserved");
  assert.equal(ledger.status, "reserved");
  assert.equal(idempotency.status, "started");
});

test("a genuinely stale AI reservation releases its cycle and requires a fresh idempotency key", async () => {
  const { sqlite, d1 } = aiDatabase();
  const input = reservationInput(d1, "stale-reservation-request", 2);
  const reserved = await reserveAiRun(input);
  assert.equal(reserved.kind, "reserved");
  if (reserved.kind !== "reserved") return;
  const staleAt = new Date(Date.now() - 17 * 60 * 1_000).toISOString();
  sqlite.prepare("UPDATE ai_runs SET updated_at=? WHERE id=?").run(staleAt, reserved.runId);
  sqlite.prepare("UPDATE idempotency_keys SET updated_at=? WHERE key=?")
    .run(staleAt, "legal-chat:workspace-1:user-1:stale-reservation-request");

  const replay = await reserveAiRun(input);
  assert.equal(replay.kind, "expired");
  if (replay.kind === "expired") assert.equal(replay.runId, reserved.runId);
  const run = sqlite.prepare("SELECT status,error_code AS errorCode FROM ai_runs WHERE id=?").get(reserved.runId) as { status: string; errorCode: string };
  const ledger = sqlite.prepare("SELECT status FROM ai_usage_ledger WHERE id=?").get(reserved.ledgerId) as { status: string };
  const idempotency = sqlite.prepare("SELECT status FROM idempotency_keys WHERE key=?")
    .get("legal-chat:workspace-1:user-1:stale-reservation-request") as { status: string };
  assert.equal(run.status, "failed");
  assert.equal(run.errorCode, "AI_RUN_EXPIRED");
  assert.equal(ledger.status, "released");
  assert.equal(idempotency.status, "failed");

});

test("timed-out AI run releases reserved usage before a retry can be offered", async () => {
  const { sqlite, d1 } = aiDatabase();
  const reserved = await reserveAiRun(reservationInput(d1, "timed-out-request", 1));
  assert.equal(reserved.kind, "reserved");
  if (reserved.kind !== "reserved") return;

  await failAiRun({
    db: d1,
    runId: reserved.runId,
    ledgerId: reserved.ledgerId,
    workspaceId: "workspace-1",
    userId: "user-1",
    idempotencyKey: "timed-out-request",
    errorCode: "PROVIDER_TIMEOUT",
  });

  const ledger = sqlite.prepare("SELECT status FROM ai_usage_ledger WHERE id=?")
    .get(reserved.ledgerId) as { status: string };
  const run = sqlite.prepare("SELECT status,error_code AS errorCode FROM ai_runs WHERE id=?")
    .get(reserved.runId) as { status: string; errorCode: string };
  assert.equal(run.status, "failed");
  assert.equal(run.errorCode, "PROVIDER_TIMEOUT");
  assert.equal(ledger.status, "released");
});

test("AI reservations remain active through a provider window and recover after lease expiry", async () => {
  const { sqlite, d1 } = aiDatabase();
  const reserved = await reserveAiRun(reservationInput(d1, "interactive-stale-window", 1));
  assert.equal(reserved.kind, "reserved");
  if (reserved.kind !== "reserved") return;

  const providerWindowStart = new Date(Date.now() - LEGAL_CHAT_PROVIDER_TIMEOUT_MS).toISOString();
  sqlite.prepare("UPDATE idempotency_keys SET updated_at=? WHERE key=?")
    .run(providerWindowStart, "legal-chat:workspace-1:user-1:interactive-stale-window");
  sqlite.prepare("UPDATE ai_runs SET updated_at=? WHERE id=?")
    .run(providerWindowStart, reserved.runId);
  const active = await reserveAiRun(reservationInput(d1, "interactive-stale-window", 1));
  assert.equal(active.kind, "processing");

  const staleAt = new Date(Date.now() - (LEGAL_CHAT_RESERVATION_TTL_MS + 1_000)).toISOString();
  sqlite.prepare("UPDATE idempotency_keys SET updated_at=? WHERE key=?")
    .run(staleAt, "legal-chat:workspace-1:user-1:interactive-stale-window");
  sqlite.prepare("UPDATE ai_runs SET updated_at=? WHERE id=?")
    .run(staleAt, reserved.runId);

  const retry = await reserveAiRun(reservationInput(d1, "interactive-stale-window", 1));
  assert.equal(retry.kind, "expired");
  const ledger = sqlite.prepare("SELECT status FROM ai_usage_ledger WHERE id=?").get(reserved.ledgerId) as { status: string };
  assert.equal(ledger.status, "released");
});

test("a finalizing AI run cannot be expired by an old idempotency timestamp", async () => {
  const { sqlite, d1 } = aiDatabase();
  const input = reservationInput(d1, "finalizing-reservation-request", 2);
  const reserved = await reserveAiRun(input);
  assert.equal(reserved.kind, "reserved");
  if (reserved.kind !== "reserved") return;
  assert.equal(await beginAiRunFinalization({
    db: d1, runId: reserved.runId, workspaceId: "workspace-1", userId: "user-1",
  }), true);
  const staleAt = new Date(Date.now() - 16 * 60 * 1_000).toISOString();
  sqlite.prepare("UPDATE idempotency_keys SET updated_at=? WHERE key=?")
    .run(staleAt, "legal-chat:workspace-1:user-1:finalizing-reservation-request");

  const replay = await reserveAiRun(input);
  assert.equal(replay.kind, "processing");
  const run = sqlite.prepare("SELECT status FROM ai_runs WHERE id=?").get(reserved.runId) as { status: string };
  const ledger = sqlite.prepare("SELECT status FROM ai_usage_ledger WHERE id=?").get(reserved.ledgerId) as { status: string };
  assert.equal(run.status, "finalizing");
  assert.equal(ledger.status, "reserved");
});

test("AI usage reservation enforces a monthly limit and request hash binding", async () => {
  const { d1 } = aiDatabase();
  const firstInput = reservationInput(d1, "request-one", 1);
  await reserveAiRun(firstInput);
  await assert.rejects(
    reserveAiRun({ ...firstInput, idempotencyKey: "request-two", requestHash: "hash-two" }),
    (error: unknown) => error instanceof AiRunConflictError && error.code === "PLAN_LIMIT",
  );
  await assert.rejects(
    reserveAiRun({ ...firstInput, requestHash: "different-hash" }),
    (error: unknown) => error instanceof AiRunConflictError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("AI usage reservation is unmetered when the local limit is explicitly disabled", async () => {
  const { d1 } = aiDatabase();
  const first = await reserveAiRun(reservationInput(d1, "unmetered-request-one", null));
  const second = await reserveAiRun({
    ...reservationInput(d1, "unmetered-request-two", null),
    requestHash: "hash-two",
  });
  assert.equal(first.kind, "reserved");
  assert.equal(second.kind, "reserved");
});

function reservationInput(db: D1Database, idempotencyKey: string, monthlyLimit: number | null) {
  return {
    db,
    workspaceId: "workspace-1",
    userId: "user-1",
    idempotencyKey,
    requestHash: "hash-one",
    conversationId: null,
    provider: "openai",
    model: "gpt-5.6-sol",
    answerMode: "detailed" as const,
    reasoningMode: "fast" as const,
    legalDatabaseAsOf: "unavailable",
    instructionHash: "instruction-hash",
    sourceVersionHash: "source-hash",
    monthlyLimit,
  };
}
