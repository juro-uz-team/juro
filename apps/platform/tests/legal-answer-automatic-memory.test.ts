import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { listUserMemories, memoryKeyring } from "../lib/ai/user-memory";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { reserveAiRun } from "../lib/ai/run-store";
import { loadCaseContext } from "../lib/legal-answer-workflow/case-context";

const keyring = memoryKeyring(JSON.stringify({ active: "fixture", versions: { fixture: {
  aead: Buffer.alloc(32, 5).toString("base64url"), hmac: Buffer.alloc(32, 6).toString("base64url"),
} } }));

test("publication saves an encrypted safe preference with chat provenance and later context compatibility", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input, question: "Please always answer in English.", memoryKeyring: keyring });
    const memories = await listUserMemories({ db: fixture.d1, keyring, userId: "u", workspaceId: "w" });
    assert.equal(memories.length, 1);
    assert.equal(memories[0].category, "language");
    assert.equal(memories[0].statement, "Preferred answer language: English.");
    assert.equal(memories[0].scope, "workspace");
    assert.equal(memories[0].sourceKind, "automatic");
    assert.equal(memories[0].source?.conversationId, saved.conversationId);
    assert.equal(memories[0].source?.messageId, saved.requestMessageId);
    const raw = fixture.sqlite.prepare("SELECT ciphertext FROM user_memories").get();
    assert.ok(raw && !String(raw.ciphertext).includes("English"));
    const later = await loadCaseContext({ db: fixture.d1, keyring, userId: "u", workspaceId: "w",
      conversationId: null, signal: new AbortController().signal });
    assert.equal(later.context.memories[0].statement, memories[0].statement);
  } finally { fixture.sqlite.close(); }
});

test("automatic memory respects opt-out at commit and stores no sensitive or quoted content", async () => {
  for (const scenario of ["disabled", "concurrent-opt-out", "sensitive", "quoted"]) {
    const fixture = await legalAnswerStorageFixture();
    try {
      fixture.sqlite.exec("INSERT INTO user_memory_settings VALUES('u',1,'2026-01-01','2026-01-01')");
      if (scenario === "disabled") fixture.sqlite.exec("UPDATE user_memory_settings SET automatic_enabled=0");
      const db = new Proxy(fixture.d1, { get(target, property) {
        if (property === "batch") return async (statements: D1PreparedStatement[]) => {
          if (scenario === "concurrent-opt-out") fixture.sqlite.exec("UPDATE user_memory_settings SET automatic_enabled=0");
          return target.batch(statements);
        };
        return Reflect.get(target, property);
      } });
      const question = scenario === "sensitive" ? "My password is secret-example. My card is 4111111111111111. I have a medical condition."
        : scenario === "quoted" ? 'A document says:\n"Please always answer in English."' : "Please always answer in English.";
      await persistSignedInAnswer({ ...fixture.input, db, question, memoryKeyring: keyring });
      assert.deepEqual(await listUserMemories({ db: fixture.d1, keyring, userId: "u", workspaceId: "w" }), [], scenario);
      assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM memory_sources").get()?.n, 0);
    } finally { fixture.sqlite.close(); }
  }
});

test("explicit nonsensitive stable facts survive publication in RU UZ and EN and reach later context", async () => {
  for (const question of ["My name is Alex Example. My company is Example Works LLC.",
    "Меня зовут Алекс Пример. Моя компания — Пример ООО.",
    "Mening ismim Aziz Misol. Mening kompaniyam Misol MChJ."]) {
    const fixture = await legalAnswerStorageFixture();
    try {
      await persistSignedInAnswer({ ...fixture.input, question, memoryKeyring: keyring });
      const memories = await listUserMemories({ db: fixture.d1, keyring, userId: "u", workspaceId: "w" });
      assert.deepEqual(memories.map(memory => memory.category).sort(), ["company", "profile_name"]);
      assert.ok(memories.every(memory => question.includes(memory.statement)));
      const later = await loadCaseContext({ db: fixture.d1, keyring, userId: "u", workspaceId: "w",
        conversationId: null, signal: new AbortController().signal });
      assert.deepEqual(later.context.memories.map(memory => memory.statement).sort(), memories.map(memory => memory.statement).sort());
    } finally { fixture.sqlite.close(); }
  }
});

test("publication failure and cancellation leave no automatic memories; repeated publication cannot duplicate them", async () => {
  for (const scenario of ["failure", "cancelled", "repeat"]) {
    const fixture = await legalAnswerStorageFixture();
    try {
      const input = { ...fixture.input, question: "Предпочитаю краткие ответы.", memoryKeyring: keyring };
      if (scenario === "failure") {
        fixture.sqlite.exec("CREATE TRIGGER reject_memory BEFORE INSERT ON memory_sources BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
        await assert.rejects(persistSignedInAnswer(input), /fixture failure/);
      } else if (scenario === "cancelled") {
        await assert.rejects(persistSignedInAnswer({ ...input, signal: AbortSignal.abort() }));
      } else {
        await persistSignedInAnswer(input);
        await assert.rejects(persistSignedInAnswer(input));
        const second = await reserveAiRun({ ...fixture.input, idempotencyKey: "next-preference", requestHash: "next-preference" });
        assert.equal(second.kind, "reserved");
        if (second.kind !== "reserved") throw new Error("Expected reservation");
        await persistSignedInAnswer({ ...input, ...second, idempotencyKey: "next-preference" });
      }
      const memories = await listUserMemories({ db: fixture.d1, keyring, userId: "u", workspaceId: "w" });
      assert.equal(memories.length, scenario === "repeat" ? 1 : 0);
      assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM memory_sources").get()?.n, scenario === "repeat" ? 1 : 0);
      if (scenario !== "repeat") assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 0);
    } finally { fixture.sqlite.close(); }
  }
});

test("reported facts and specific non-retention instructions never become automatic memories", async () => {
  const questions = [
    "A witness wrote the following.\nMy name is Alex Example.",
    "Do not save this information. My name is Alex Example.",
    "Свидетель написал следующее. Меня зовут Алекс Пример.",
    "Не сохраняйте эту информацию. Меня зовут Алекс Пример.",
    "Guvoh quyidagilarni yozdi. Mening ismim Aziz Misol.",
    "Bu ma’lumotni saqlamang. Mening ismim Aziz Misol.",
    "My name is Alex Example?",
    "Меня зовут Алекс Пример?",
    "Mening ismim Aziz Misol?",
  ];
  const fixture = await legalAnswerStorageFixture();
  try {
    for (const [index, question] of questions.entries()) {
      const idempotencyKey = `attribution-${index}`;
      const reserved = await reserveAiRun({ ...fixture.input, idempotencyKey, requestHash: idempotencyKey });
      if (reserved.kind !== "reserved") throw new Error("Expected reservation");
      await persistSignedInAnswer({ ...fixture.input, ...reserved, idempotencyKey, question, memoryKeyring: keyring });
    }
    assert.deepEqual(await listUserMemories({ db: fixture.d1, keyring, userId: "u", workspaceId: "w" }), []);
  } finally { fixture.sqlite.close(); }
});
