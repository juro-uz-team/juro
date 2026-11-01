import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertOperationalFeatureEnabled,
  operationalEnvironment,
  operationalLocaleFromRequest,
  OperationalFeatureError,
  readOperationalFeatureDashboard,
  setOperationalFeature,
  setOperationalFeatureSchema,
  verifyOperationalFeatureHistory,
} from "../lib/operations/operational-feature-flags";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const now = new Date("2026-08-05T10:00:00.000Z");

function seedUser(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]): void {
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES ('feature-admin','feature-admin@example.test',?,?)")
    .run(now.toISOString(), now.toISOString());
}

test("0084 stores immutable tamper-evident operational feature history", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seedUser(sqlite);
    const initial = await readOperationalFeatureDashboard({ db: d1, environment: "staging" });
    assert.equal(initial.integrity.valid, true);
    assert.equal(initial.history.length, 0);
    assert.equal(initial.features.every((feature) => feature.enabled && feature.version === 0), true);

    const disabled = await setOperationalFeature({
      db: d1,
      environment: "staging",
      actorUserId: "feature-admin",
      now,
      value: { key: "ai_chat", enabled: false, reason: "Provider incident requires a temporary operator stop." },
    });
    assert.equal(disabled.version, 1);
    assert.match(disabled.eventHash ?? "", /^[A-F0-9]{64}$/);
    await assert.rejects(
      assertOperationalFeatureEnabled({ db: d1, environment: "staging", key: "ai_chat" }),
      (error: unknown) => error instanceof OperationalFeatureError && error.code === "OPERATIONAL_FEATURE_DISABLED",
    );

    const enabled = await setOperationalFeature({
      db: d1,
      environment: "staging",
      actorUserId: "feature-admin",
      now: new Date("2026-08-05T10:05:00.000Z"),
      value: { key: "ai_chat", enabled: true, reason: "Provider health and request probes have recovered." },
    });
    assert.equal(enabled.version, 2);
    assert.equal(enabled.previousEventHash, disabled.eventHash);
    await assert.doesNotReject(assertOperationalFeatureEnabled({ db: d1, environment: "staging", key: "ai_chat" }));
    assert.deepEqual(await verifyOperationalFeatureHistory(d1, "staging"), { valid: true, checked: 2 });

    assert.throws(() => sqlite.prepare("UPDATE operational_feature_flag_versions SET reason='tampered reason' WHERE id=?").run(enabled.id), /OPERATIONAL_FEATURE_IMMUTABLE/);
    assert.throws(() => sqlite.prepare("DELETE FROM operational_feature_flag_versions WHERE id=?").run(disabled.id), /OPERATIONAL_FEATURE_IMMUTABLE/);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});

test("0084 rejects no-op, invalid input and missing operators", async () => {
  assert.equal(setOperationalFeatureSchema.safeParse({ key: "ai_chat", enabled: false, reason: "short" }).success, false);
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seedUser(sqlite);
    await assert.rejects(
      setOperationalFeature({ db: d1, environment: "staging", actorUserId: "feature-admin", value: { key: "voice_mode", enabled: true, reason: "No state transition should be written here." } }),
      (error: unknown) => error instanceof OperationalFeatureError && error.code === "OPERATIONAL_FEATURE_NO_CHANGE",
    );
    await assert.rejects(
      setOperationalFeature({ db: d1, environment: "staging", actorUserId: "missing-user", value: { key: "voice_mode", enabled: false, reason: "Disable voice during an operational incident." } }),
      (error: unknown) => error instanceof OperationalFeatureError && error.code === "OPERATIONAL_FEATURE_CONFLICT",
    );
    assert.equal((await readOperationalFeatureDashboard({ db: d1, environment: "staging" })).history.length, 0);
  } finally { sqlite.close(); }
});

test("0084 fails closed and refuses to extend a corrupted history", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seedUser(sqlite);
    const first = await setOperationalFeature({
      db: d1,
      environment: "staging",
      actorUserId: "feature-admin",
      now,
      value: { key: "lawyer_handoff", enabled: false, reason: "Pause handoff while an access incident is investigated." },
    });
    sqlite.exec("DROP TRIGGER operational_feature_no_update");
    sqlite.prepare("UPDATE operational_feature_flag_versions SET reason=? WHERE id=?")
      .run("History was altered outside the protected application path.", first.id);
    assert.deepEqual(await verifyOperationalFeatureHistory(d1, "staging", "lawyer_handoff"), { valid: false, checked: 1 });
    await assert.rejects(
      assertOperationalFeatureEnabled({ db: d1, environment: "staging", key: "lawyer_handoff" }),
      (error: unknown) => error instanceof OperationalFeatureError && error.code === "OPERATIONAL_FEATURE_INTEGRITY_FAILED",
    );
    await assert.rejects(
      setOperationalFeature({
        db: d1,
        environment: "staging",
        actorUserId: "feature-admin",
        value: { key: "lawyer_handoff", enabled: true, reason: "This write must not extend a corrupted history chain." },
      }),
      (error: unknown) => error instanceof OperationalFeatureError && error.code === "OPERATIONAL_FEATURE_INTEGRITY_FAILED",
    );
  } finally { sqlite.close(); }
});

test("operational environment and locale parsing do not silently cross environments", () => {
  assert.equal(operationalEnvironment(undefined), "development");
  assert.equal(operationalEnvironment("staging"), "staging");
  assert.throws(() => operationalEnvironment("prod"), /OPERATIONAL_FEATURE_INVALID/);
  assert.equal(operationalLocaleFromRequest(new Request("https://app.juro.uz/api", {
    headers: { referer: "https://app.juro.uz/uz/individual/dashboard" },
  })), "uz");
  assert.equal(operationalLocaleFromRequest(new Request("https://app.juro.uz/api", {
    headers: { referer: "https://app.juro.uz/en/individual/dashboard" },
  })), "en");
  assert.equal(operationalLocaleFromRequest(new Request("https://app.juro.uz/api", {
    headers: { "accept-language": "ru-RU,ru;q=0.9" },
  })), "ru");
});

test("operational controls use fresh MFA and enforce server-side route boundaries", () => {
  const adminRoute = readFileSync(new URL("../app/api/platform/admin/feature-flags/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/[locale]/admin/feature-flags/page.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../app/_staff/FeatureFlagConsole.tsx", import.meta.url), "utf8");
  const routePaths = [
    "../app/api/guest/ai/route.ts",
    "../app/api/platform/ai/route.ts",
    "../app/api/platform/document-analysis/uploads/route.ts",
    "../app/api/platform/document-analysis/uploads/[analysisId]/route.ts",
    "../app/api/platform/document-analysis/uploads/[analysisId]/finalize/route.ts",
    "../app/api/platform/document-analysis/url-import/route.ts",
    "../app/api/platform/lawyer-requests/route.ts",
    "../app/api/platform/voice/recordings/route.ts",
    "../app/api/platform/voice/recordings/[recordingId]/route.ts",
    "../app/api/platform/voice/recordings/[recordingId]/finalize/route.ts",
    "../app/api/platform/voice/recordings/[recordingId]/transcribe/route.ts",
    "../app/api/platform/voice/speech/route.ts",
  ];
  const routeSources = new Map(routePaths.map((path) => [path, readFileSync(new URL(path, import.meta.url), "utf8")]));
  const routes = [...routeSources.values()].join("\n");
  assert.match(adminRoute, /requirePlatformStaffRequest\(request, "staff\.operations\.manage", \{ freshMfaWithinMs: 15 \* 60 \* 1_000 \}\)/);
  assert.match(adminRoute, /assertSafeWrite\(request\)/);
  assert.doesNotMatch(adminRoute, /actorUserId:\s*parsed\.data/);
  assert.match(page, /requirePlatformStaffAccess\(runtime\.DB, session, "staff\.operations\.manage"/);
  for (const path of routePaths.slice(0, 2)) assert.match(readFileSync(new URL("../lib/legal-answer-workflow/platform-entry.ts", import.meta.url), "utf8"), /"ai_chat"/);
  for (const path of routePaths.slice(2, 6)) assert.match(routeSources.get(path) ?? "", /key: "document_analysis_upload"/);
  assert.match(routeSources.get(routePaths[6]) ?? "", /key: "lawyer_handoff"/);
  for (const path of routePaths.slice(7)) assert.match(routeSources.get(path) ?? "", /key: "voice_mode"/);
  assert.match(routes, /operationalFeatureMessage/);
  assert.doesNotMatch(ui, /dangerouslySetInnerHTML|transition:\s*all|window\.confirm/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /staff-skip/);
  assert.match(ui, /en:\s*\{/);
  assert.match(ui, /nextLocale/);
  assert.match(ui, /hrefLang=/);
  assert.match(ui, /minLength=\{10\}/);
});
