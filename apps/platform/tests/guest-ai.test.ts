import assert from "node:assert/strict";
import test from "node:test";

import { parseIdentityKeyring } from "../lib/auth/keyring";
import {
  GUEST_AI_MAX_SESSIONS_PER_IP,
  GuestAiError,
  completeGuestAiRun,
  createGuestAiSession,
  guestSessionCookie,
  latestGuestAiClarificationRun,
  purgeExpiredGuestAiSessions,
  reserveGuestAiRun,
  renewGuestAiReservation,
  resolveGuestAiSession,
  revealGuestAiRunQuestion,
  revealGuestAiRunResult,
} from "../lib/ai/guest-session";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const NOW = "2026-08-03T12:00:00.000Z";
const HASH = "a".repeat(64);

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function keyring() {
  return parseIdentityKeyring(JSON.stringify({
    active: "v1",
    versions: { v1: { aead: encodedKey(1), hmac: encodedKey(33) } },
  }));
}

function requestForCookie(cookie: string): Request {
  return new Request("https://staging.app.juro.uz/api/guest/ai", {
    headers: { cookie: cookie.split(";", 1)[0] },
  });
}

function reservationInput(
  db: D1Database,
  session: Awaited<ReturnType<typeof resolveGuestAiSession>>,
  identityKeyring: ReturnType<typeof keyring>,
  idempotencyKey: string,
  question: string,
  now = NOW,
) {
  return {
    db,
    session,
    keyring: identityKeyring,
    idempotencyKey,
    requestHash: HASH,
    provider: "openai",
    model: "synthetic-model",
    legalDatabaseAsOf: NOW,
    instructionHash: "b".repeat(64),
    sourceVersionHash: "c".repeat(64),
    question,
    now,
  };
}

test("guest AI stores no plaintext, preserves encrypted clarification context, and consumes one final answer", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const identityKeyring = keyring();
    const created = await createGuestAiSession({
      db: d1,
      keyring: identityKeyring,
      connectingIp: "203.0.113.10",
      locale: "ru",
      now: NOW,
    });
    const cookie = guestSessionCookie(
      created.session.id,
      created.token,
      "https://staging.app.juro.uz/api/guest/ai",
    );
    let session = await resolveGuestAiSession({
      db: d1,
      keyring: identityKeyring,
      request: requestForCookie(cookie),
      now: NOW,
    });
    const sensitiveQuestion = "Работодатель задерживает зарплату два месяца";
    const clarification = await reserveGuestAiRun(reservationInput(
      d1,
      session,
      identityKeyring,
      "guest-request-0001",
      sensitiveQuestion,
    ));
    assert.equal(clarification.kind, "created");
    if (clarification.kind !== "created") return;
    await completeGuestAiRun({
      db: d1,
      keyring: identityKeyring,
      run: clarification.run,
      resultJson: JSON.stringify({ clarificationQuestions: ["Когда должна была быть выплата?"] }),
      responseKind: "clarification_required",
      provider: "openai",
      model: "synthetic-model",
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      attempts: 1,
      latencyMs: 25,
      now: NOW,
    });

    const stored = sqlite.prepare(
      "SELECT request_ciphertext AS question,result_ciphertext AS result,request_hash AS hash FROM guest_ai_runs WHERE id=?",
    ).get(clarification.run.id) as { question: string; result: string; hash: string };
    assert.doesNotMatch(stored.question, /Работодатель|зарплату/iu);
    assert.doesNotMatch(stored.result, /Когда|выплата/iu);
    assert.equal(stored.hash, HASH);
    assert.equal(await revealGuestAiRunQuestion({ keyring: identityKeyring, run: clarification.run }), sensitiveQuestion);
    assert.deepEqual(
      JSON.parse(await revealGuestAiRunResult({ keyring: identityKeyring, run: {
        ...clarification.run,
        status: "completed",
        responseKind: "clarification_required",
        resultCiphertext: stored.result,
        resultIv: String(sqlite.prepare("SELECT result_iv FROM guest_ai_runs WHERE id=?").get(clarification.run.id)?.result_iv),
        resultKeyVersion: "v1",
      } })),
      { clarificationQuestions: ["Когда должна была быть выплата?"] },
    );
    assert.equal((await latestGuestAiClarificationRun(d1, session.id))?.id, clarification.run.id);

    session = await resolveGuestAiSession({
      db: d1,
      keyring: identityKeyring,
      request: requestForCookie(cookie),
      now: NOW,
    });
    assert.equal(session.state, "available");
    const answer = await reserveGuestAiRun(reservationInput(
      d1,
      session,
      identityKeyring,
      "guest-request-0002",
      `${sensitiveQuestion}\nОтвет: 15 июля`,
    ));
    assert.equal(answer.kind, "created");
    if (answer.kind !== "created") return;
    await completeGuestAiRun({
      db: d1,
      keyring: identityKeyring,
      run: answer.run,
      resultJson: JSON.stringify({ summary: "Итоговый ответ" }),
      responseKind: "answer",
      provider: "openai",
      model: "synthetic-model",
      inputTokens: 20,
      outputTokens: 10,
      cachedInputTokens: 0,
      attempts: 1,
      latencyMs: 50,
      sourceVersionHash: "d".repeat(64),
      legalDatabaseAsOf: "2026-08-02T12:00:00.000Z",
      now: NOW,
    });
    const replay = await reserveGuestAiRun(reservationInput(d1, session, identityKeyring,
      "guest-request-0002", `${sensitiveQuestion}\nОтвет: 15 июля`));
    assert.equal(replay.kind, "completed");
    assert.equal(replay.run.legalDatabaseAsOf, "2026-08-02T12:00:00.000Z");
    assert.equal(sqlite.prepare("SELECT source_version_hash FROM guest_ai_runs WHERE id=?").get(answer.run.id)?.source_version_hash, "d".repeat(64));
    session = await resolveGuestAiSession({
      db: d1,
      keyring: identityKeyring,
      request: requestForCookie(cookie),
      now: NOW,
    });
    assert.deepEqual(
      { state: session.state, requestCount: session.requestCount, answerCount: session.answerCount },
      { state: "consumed", requestCount: 2, answerCount: 1 },
    );
    await assert.rejects(
      reserveGuestAiRun(reservationInput(
        d1,
        session,
        identityKeyring,
        "guest-request-0003",
        "Ещё один вопрос",
      )),
      (error: unknown) => error instanceof GuestAiError && error.code === "GUEST_SESSION_CONSUMED",
    );
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("guest AI session creation is HMAC-bound and rate limited per IP", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const identityKeyring = keyring();
    for (let index = 0; index < GUEST_AI_MAX_SESSIONS_PER_IP; index += 1) {
      await createGuestAiSession({
        db: d1,
        keyring: identityKeyring,
        connectingIp: "203.0.113.20",
        locale: "uz",
        now: new Date(Date.parse(NOW) + index).toISOString(),
      });
    }
    await assert.rejects(
      createGuestAiSession({
        db: d1,
        keyring: identityKeyring,
        connectingIp: "203.0.113.20",
        locale: "uz",
        now: NOW,
      }),
      (error: unknown) => error instanceof GuestAiError && error.code === "GUEST_RATE_LIMIT",
    );
    const serialized = JSON.stringify(sqlite.prepare("SELECT * FROM guest_ai_sessions").all());
    assert.doesNotMatch(serialized, /203\.0\.113\.20/);
  } finally {
    sqlite.close();
  }
});

test("guest lease renewal fences wrong owners and expired runs without consuming an answer", async () => {
  const {sqlite,d1}=sqliteD1Fixture();
  try {
    const identityKeyring=keyring();
    const created=await createGuestAiSession({db:d1,keyring:identityKeyring,connectingIp:"203.0.113.31",locale:"en",now:NOW});
    const reserved=await reserveGuestAiRun(reservationInput(d1,created.session,identityKeyring,"guest-lease-request","Synthetic question"));
    assert.equal(reserved.kind,"created");
    if(reserved.kind!=="created")throw Error("Reservation required");
    const owner={db:d1,session:created.session,runId:reserved.run.id};
    const now=Date.parse(NOW)+15*60_000;
    assert.equal(await renewGuestAiReservation({...owner,session:{...created.session,tokenHmac:"wrong"},now}),false);
    assert.equal(await renewGuestAiReservation({...owner,now}),true);
    assert.deepEqual(await purgeExpiredGuestAiSessions({db:d1,now:"2026-08-03T12:17:00.000Z"}),
      {eligible:0,purged:0,reservationsReleased:0});
    assert.equal(await renewGuestAiReservation({...owner,now:Date.parse(NOW)+32*60_000}),false);
    sqlite.exec("CREATE TABLE saved_lease_marker(value TEXT)");
    await assert.rejects(completeGuestAiRun({db:d1,keyring:identityKeyring,run:reserved.run,
      resultJson:JSON.stringify({summary:"Late result"}),responseKind:"answer",provider:"openai",model:"synthetic-model",
      inputTokens:0,outputTokens:0,cachedInputTokens:0,attempts:1,latencyMs:0,now:"2026-08-03T12:32:00.000Z",
      additionalStatements:[d1.prepare("INSERT INTO saved_lease_marker VALUES ('late')")]}));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM saved_lease_marker").get()?.count,0);
    assert.equal(sqlite.prepare("SELECT answer_count FROM guest_ai_sessions WHERE id=?").get(created.session.id)?.answer_count,0);
  } finally {sqlite.close();}
});

test("guest retention releases stale reservations and cascades expired encrypted content", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const identityKeyring = keyring();
    const created = await createGuestAiSession({
      db: d1,
      keyring: identityKeyring,
      connectingIp: "203.0.113.30",
      locale: "ru",
      now: NOW,
    });
    const reserved = await reserveGuestAiRun(reservationInput(
      d1,
      created.session,
      identityKeyring,
      "guest-request-0004",
      "Синтетический вопрос для очистки",
    ));
    assert.equal(reserved.kind, "created");
    assert.deepEqual(await purgeExpiredGuestAiSessions({
      db: d1,
      now: "2026-08-03T12:17:00.000Z",
    }), { eligible: 0, purged: 0, reservationsReleased: 1 });
    assert.equal(sqlite.prepare("SELECT state FROM guest_ai_sessions WHERE id=?").get(created.session.id)?.state, "available");
    assert.equal(sqlite.prepare("SELECT status FROM guest_ai_runs WHERE session_id=?").get(created.session.id)?.status, "expired");

    assert.deepEqual(await purgeExpiredGuestAiSessions({
      db: d1,
      now: "2026-08-04T12:00:01.000Z",
    }), { eligible: 1, purged: 1, reservationsReleased: 0 });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM guest_ai_sessions").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM guest_ai_runs").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("guest retention is inert before migration 0065", async () => {
  let inspected = "";
  const db = {
    prepare(sql: string) {
      inspected = sql;
      return { async first() { return { count: 0 }; } };
    },
  } as unknown as D1Database;
  assert.deepEqual(await purgeExpiredGuestAiSessions({ db, now: NOW }), {
    eligible: 0,
    purged: 0,
    reservationsReleased: 0,
  });
  assert.match(inspected, /sqlite_master/);
});
