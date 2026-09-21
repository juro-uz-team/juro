import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchesGlob } from "node:path";

import { parseIdentityKeyring } from "../lib/auth/keyring";
import {
  AI_QUESTION_INTAKE_MAX_ACTIVE,
  AI_QUESTION_INTAKE_TTL_MS,
  finalizeQuestionIntake,
  issueQuestionIntake,
  openQuestionIntake,
  purgeExpiredQuestionIntakes,
  QuestionIntakeError,
} from "../lib/ai/question-intake";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const NOW = new Date("2026-09-01T08:00:00.000Z");
const SECRET_QUESTION = "SECRET_LEGAL_QUESTION_MARKER: как защитить права арендатора?";

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

function seedTenants(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]) {
  for (const [id, name] of [["workspace-a", "Tenant A"], ["workspace-b", "Tenant B"]]) {
    sqlite.prepare("INSERT INTO workspaces (id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'ru',?,?)")
      .run(id, name, NOW.toISOString(), NOW.toISOString());
  }
  for (const [id, email, workspace] of [
    ["user-a", "a@example.test", "workspace-a"],
    ["user-b", "b@example.test", "workspace-a"],
  ]) {
    sqlite.prepare("INSERT INTO user_profiles (id,email,full_name,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, email, id, "ru", "individual", workspace, NOW.toISOString(), NOW.toISOString());
  }
  for (const [id, workspace, user] of [
    ["member-a", "workspace-a", "user-a"],
    ["member-b", "workspace-a", "user-b"],
    ["member-a-b", "workspace-b", "user-a"],
  ]) {
    sqlite.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?,?)")
      .run(id, workspace, user, NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
  }
}

function unavailable(error: unknown) {
  return error instanceof QuestionIntakeError
    && error.code === "AI_QUESTION_INTAKE_UNAVAILABLE";
}

test("AI question intake stores only ciphertext and a handle digest, permits retryable delivery, then finalizes inside the tenant boundary", async () => {
  const fixture = sqliteD1Fixture();
  try {
    seedTenants(fixture.sqlite);
    const issued = await issueQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      question: SECRET_QUESTION,
      now: NOW,
    });
    assert.match(issued.handle, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(issued.expiresAt, new Date(NOW.getTime() + AI_QUESTION_INTAKE_TTL_MS).toISOString());

    const stored = fixture.sqlite.prepare(`
      SELECT token_hash AS tokenHash,question_ciphertext AS ciphertext,
        question_iv AS iv,question_key_version AS keyVersion,consumed_at AS consumedAt
      FROM ai_question_intakes
    `).get() as { tokenHash: string; ciphertext: string; iv: string; keyVersion: string; consumedAt: string | null };
    assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(stored.tokenHash, issued.handle);
    assert.doesNotMatch(stored.ciphertext, /SECRET_LEGAL_QUESTION_MARKER/);
    assert.equal(stored.iv.length, 16);
    assert.equal(stored.keyVersion, "v1");
    assert.equal(stored.consumedAt, null);

    await assert.rejects(openQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-b",
      handle: issued.handle,
      now: NOW,
    }), unavailable);
    await assert.rejects(openQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-b",
      userId: "user-a",
      handle: issued.handle,
      now: NOW,
    }), unavailable);

    assert.equal(await openQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      handle: issued.handle,
      now: NOW,
    }), SECRET_QUESTION);
    assert.equal(await openQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      handle: issued.handle,
      now: NOW,
    }), SECRET_QUESTION);
    await finalizeQuestionIntake({
      db: fixture.d1,
      workspaceId: "workspace-a",
      userId: "user-a",
      handle: issued.handle,
      now: NOW,
    });
    await finalizeQuestionIntake({
      db: fixture.d1,
      workspaceId: "workspace-a",
      userId: "user-a",
      handle: issued.handle,
      now: NOW,
    });
    const finalized = fixture.sqlite.prepare(`
      SELECT question_ciphertext AS ciphertext,question_iv AS iv,
        question_key_version AS keyVersion,consumed_at AS consumedAt
      FROM ai_question_intakes
    `).get() as { ciphertext: null; iv: null; keyVersion: null; consumedAt: string };
    assert.equal(finalized.ciphertext, null);
    assert.equal(finalized.iv, null);
    assert.equal(finalized.keyVersion, null);
    assert.equal(finalized.consumedAt, NOW.toISOString());
    await assert.rejects(openQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      handle: issued.handle,
      now: NOW,
    }), unavailable);
  } finally {
    fixture.sqlite.close();
  }
});

test("concurrent delivery is response-loss safe, expiry fails closed, and retention removes expired rows", async () => {
  const fixture = sqliteD1Fixture();
  try {
    seedTenants(fixture.sqlite);
    const issued = await issueQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      question: SECRET_QUESTION,
      now: NOW,
    });
    const attempts = await Promise.allSettled([1, 2].map(() => openQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      handle: issued.handle,
      now: NOW,
    })));
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 2);
    assert.ok(attempts.every((attempt) => attempt.status === "fulfilled" && attempt.value === SECRET_QUESTION));

    const expired = await issueQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      question: "Expired intake",
      now: NOW,
    });
    const afterExpiry = new Date(NOW.getTime() + AI_QUESTION_INTAKE_TTL_MS + 1);
    await assert.rejects(openQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      handle: expired.handle,
      now: afterExpiry,
    }), unavailable);
    assert.deepEqual(await purgeExpiredQuestionIntakes({
      db: fixture.d1,
      now: afterExpiry.toISOString(),
    }), { eligible: 2, purged: 2 });
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM ai_question_intakes").get()?.count, 0);
  } finally {
    fixture.sqlite.close();
  }
});

test("database guard bounds all unexpired question intakes even after delivery and finalization", async () => {
  const fixture = sqliteD1Fixture();
  try {
    seedTenants(fixture.sqlite);
    for (let index = 0; index < AI_QUESTION_INTAKE_MAX_ACTIVE; index += 1) {
      const issued = await issueQuestionIntake({
        db: fixture.d1,
        keyring: keyring(),
        workspaceId: "workspace-a",
        userId: "user-a",
        question: `Question ${index}`,
        now: new Date(NOW.getTime() + index),
      });
      assert.equal(await openQuestionIntake({
        db: fixture.d1,
        keyring: keyring(),
        workspaceId: "workspace-a",
        userId: "user-a",
        handle: issued.handle,
        now: new Date(NOW.getTime() + index),
      }), `Question ${index}`);
      await finalizeQuestionIntake({
        db: fixture.d1,
        workspaceId: "workspace-a",
        userId: "user-a",
        handle: issued.handle,
        now: new Date(NOW.getTime() + index),
      });
    }
    await assert.rejects(issueQuestionIntake({
      db: fixture.d1,
      keyring: keyring(),
      workspaceId: "workspace-a",
      userId: "user-a",
      question: "Question over capacity",
      now: new Date(NOW.getTime() + 10),
    }), (error) => error instanceof QuestionIntakeError
      && error.code === "AI_QUESTION_INTAKE_CAPACITY_EXCEEDED");
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM ai_question_intakes").get()?.count, AI_QUESTION_INTAKE_MAX_ACTIVE);
  } finally {
    fixture.sqlite.close();
  }
});

test("dashboard-to-chat wiring carries only the opaque intake handle", () => {
  const dashboard = readFileSync(new URL("../app/_platform/DashboardClient.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/_platform/AiLawyerClient.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../app/_platform/PlatformShell.tsx", import.meta.url), "utf8");
  const createRoute = readFileSync(new URL("../app/api/platform/ai/intake/route.ts", import.meta.url), "utf8");
  const consumeRoute = readFileSync(new URL("../app/api/platform/ai/intake/consume/route.ts", import.meta.url), "utf8");
  const finalizeRoute = readFileSync(new URL("../app/api/platform/ai/intake/finalize/route.ts", import.meta.url), "utf8");
  const routeContext = readFileSync(new URL("../app/_platform/PlatformRouteContext.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(dashboard, /ai-chat\?prompt=/);
  assert.match(dashboard, /fetch\("\/api\/platform\/ai\/intake"/);
  assert.match(dashboard, /ai-chat\?intake=/);
  assert.match(dashboard, /maxLength=\{4_000\}/);
  assert.doesNotMatch(client, /searchParams\.get\("prompt"\)/);
  assert.match(client, /sanitized\.delete\("prompt"\)/);
  assert.match(client, /window\.history\.replaceState/);
  assert.match(client, /requestJson<\{question:string\}>\("\/api\/platform\/ai\/intake\/consume"/);
  assert.match(client, /requestJson\("\/api\/platform\/ai\/intake\/finalize"/);
  assert.match(client, /body:JSON\.stringify\(\{handle:intakeHandle,workspaceId\}\)/);
  assert.doesNotMatch(client, /window\.location\.assign\(params\.size/);
  assert.match(shell, /nextParams\.delete\("prompt"\)/);
  assert.doesNotMatch(shell, /nextParams\.delete\("intake"\)/);
  assert.match(routeContext, /PlatformWorkspaceIdContext/);
  // Authentication, CSRF, ownership and cache headers are exercised through the real routes
  // in legal-chat-intake-route.test.ts; this check protects the UI and route wiring only.
  assert.match(createRoute, /questionIntakeRoute\("create"\)/);
  assert.match(consumeRoute, /questionIntakeRoute\("consume"\)/);
  assert.match(finalizeRoute, /questionIntakeRoute\("finalize"\)/);
});

test("migration registers encrypted retryable handoff storage and production deployment includes it", () => {
  const migration = readFileSync(new URL("../drizzle/0149_ai_question_intakes.sql", import.meta.url), "utf8");
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ tag: string }> };
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

  assert.ok(journal.entries.some((entry) => entry.tag === "0149_ai_question_intakes"));
  assert.match(migration, /CREATE TABLE `ai_question_intakes`/);
  assert.match(migration, /question_ciphertext/);
  assert.match(migration, /token_hash/);
  assert.match(migration, /consumed_at/);
  assert.match(migration, /AI_QUESTION_INTAKE_ACCESS_DENIED/);
  assert.match(migration, /AI_QUESTION_INTAKE_CAPACITY_EXCEEDED/);
  assert.doesNotMatch(migration, /intake\.`consumed_at` IS NULL/);
  const pattern = /"migrations_pattern":\s*"([^"]+)"/.exec(wrangler)?.[1];
  assert.ok(pattern);
  assert.equal(matchesGlob("./drizzle/0149_ai_question_intakes.sql", pattern), true);
});
