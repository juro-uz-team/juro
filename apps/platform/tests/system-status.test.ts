import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appendStatusIncidentUpdate,
  createStatusIncident,
  createStatusIncidentSchema,
  readPublicStatus,
  readStatusIncidentAdminDashboard,
  SystemStatusError,
} from "../lib/operations/system-status";
import {
  dependencyHealthKeys,
  recordDependencyHealth,
} from "../lib/operations/dependency-health";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const now = new Date("2026-08-05T09:00:00.000Z");

function seedUser(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]): void {
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES ('status-admin','status-admin@example.test',?,?)")
    .run(now.toISOString(), now.toISOString());
}

async function seedOperationalDependencies(db: D1Database, checkedAt = now): Promise<void> {
  await Promise.all(dependencyHealthKeys.map((key) => recordDependencyHealth({
    db,
    now: checkedAt,
    value: {
      environment: "development",
      key,
      state: "operational",
      latencyMs: 12,
      evidenceKind: "probe",
    },
  })));
}

test("0083 publishes only trilingual public-safe incident state and resolves it immutably", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seedUser(sqlite);
    await seedOperationalDependencies(d1);
    const initial = await readPublicStatus({ db: d1, locale: "uz", environment: "development", now });
    assert.equal(initial.overallStatus, "operational");
    assert.equal(initial.components.length, 8);
    assert.equal(initial.activeIncidents.length, 0);
    const platformDependencies = initial.components.find((component) => component.key === "platform")?.dependencies;
    assert.deepEqual(platformDependencies?.map((dependency) => dependency.key), ["d1", "queues", "queue_dlq"]);
    assert.ok(platformDependencies?.every((dependency) => dependency.status === "operational" && dependency.latencyMs === 12));

    const created = await createStatusIncident({
      db: d1,
      actorUserId: "status-admin",
      now,
      value: {
        titleRu: "Задержка ответов AI-юриста",
        titleUz: "AI-yurist javoblarida kechikish",
        titleEn: "AI legal assistant response delays",
        summaryRu: "Часть запросов обрабатывается дольше обычного.",
        summaryUz: "Ayrim so‘rovlar odatdagidan uzoqroq qayta ishlanmoqda.",
        summaryEn: "Some requests are taking longer than usual to process.",
        messageRu: "Команда изучает рост времени ответа провайдера.",
        messageUz: "Jamoa provayder javob vaqti oshganini o‘rganmoqda.",
        messageEn: "The team is investigating increased provider response times.",
        startedAt: "2026-08-05T08:55:00.000Z",
        components: [
          { key: "ai", impact: "partial_outage" },
          { key: "document_analysis", impact: "degraded" },
        ],
      },
    });
    assert.match(created.publicReference, /^INC-[A-F0-9]{12}$/);

    const ru = await readPublicStatus({ db: d1, locale: "ru", environment: "development", now });
    const uz = await readPublicStatus({ db: d1, locale: "uz", environment: "development", now });
    const en = await readPublicStatus({ db: d1, locale: "en", environment: "development", now });
    assert.equal(ru.overallStatus, "partial_outage");
    assert.equal(ru.components.find((component) => component.key === "ai")?.status, "partial_outage");
    assert.equal(ru.components.find((component) => component.key === "platform")?.status, "operational");
    assert.equal(ru.activeIncidents[0].title, "Задержка ответов AI-юриста");
    assert.equal(uz.activeIncidents[0].title, "AI-yurist javoblarida kechikish");
    assert.equal(en.activeIncidents[0].title, "AI legal assistant response delays");
    assert.equal(en.components.find((component) => component.key === "document_analysis")?.label, "Document analysis");
    const serialized = JSON.stringify(ru);
    assert.doesNotMatch(serialized, /status-admin@example\.test|status-admin|createdBy|actorUserId|workspace|resource/i);

    await appendStatusIncidentUpdate({
      db: d1,
      actorUserId: "status-admin",
      now: new Date("2026-08-05T09:05:00.000Z"),
      value: {
        incidentId: created.id,
        state: "identified",
        messageRu: "Причина связана с повышенной задержкой внешнего AI-провайдера.",
        messageUz: "Sabab tashqi AI-provayder kechikishining oshishi bilan bog‘liq.",
        messageEn: "The cause is increased latency from the external AI provider.",
      },
    });
    await appendStatusIncidentUpdate({
      db: d1,
      actorUserId: "status-admin",
      now: new Date("2026-08-05T09:10:00.000Z"),
      value: {
        incidentId: created.id,
        state: "monitoring",
        messageRu: "Задержка снизилась, команда наблюдает за восстановлением.",
        messageUz: "Kechikish kamaydi, jamoa tiklanishni kuzatmoqda.",
        messageEn: "Latency has decreased and the team is monitoring recovery.",
      },
    });
    await seedOperationalDependencies(d1, new Date("2026-08-05T09:15:00.000Z"));
    await appendStatusIncidentUpdate({
      db: d1,
      actorUserId: "status-admin",
      now: new Date("2026-08-05T09:15:00.000Z"),
      value: {
        incidentId: created.id,
        state: "resolved",
        messageRu: "Время ответа вернулось к обычному уровню.",
        messageUz: "Javob vaqti odatdagi darajaga qaytdi.",
        messageEn: "Response times have returned to their normal level.",
      },
    });
    const resolved = await readPublicStatus({ db: d1, locale: "ru", environment: "development", now: new Date("2026-08-05T09:16:00.000Z") });
    assert.equal(resolved.overallStatus, "operational");
    assert.equal(resolved.activeIncidents.length, 0);
    assert.equal(resolved.recentIncidents[0].state, "resolved");
    assert.deepEqual(resolved.recentIncidents[0].updates.map((update) => update.state), ["resolved", "monitoring", "identified", "investigating"]);

    await assert.rejects(
      appendStatusIncidentUpdate({
        db: d1,
        actorUserId: "status-admin",
        value: {
          incidentId: created.id,
          state: "monitoring",
          messageRu: "Нельзя повторно открыть завершённый инцидент.",
          messageUz: "Yakunlangan hodisani qayta ochib bo‘lmaydi.",
          messageEn: "A resolved incident cannot be reopened.",
        },
      }),
      (error: unknown) => error instanceof SystemStatusError && error.code === "SYSTEM_STATUS_TRANSITION_INVALID",
    );
    assert.throws(() => sqlite.prepare("UPDATE system_status_updates SET message_ru='tampered text' WHERE incident_id=?").run(created.id), /SYSTEM_STATUS_UPDATE_IMMUTABLE/);
    assert.throws(() => sqlite.prepare("DELETE FROM system_status_incidents WHERE id=?").run(created.id), /SYSTEM_STATUS_INCIDENT_DELETE_FORBIDDEN/);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});

test("0112 never publishes operational status without dependency evidence", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const snapshot = await readPublicStatus({ db: d1, locale: "ru", environment: "development", now });
    assert.equal(snapshot.overallStatus, "unknown");
    assert.equal(snapshot.components.length, 8);
    assert.ok(snapshot.components.every((component) => component.status === "unknown"));
    assert.ok(snapshot.components.every((component) => component.lastCheckedAt === null));
    assert.ok(snapshot.components.every((component) => component.dependencies.every((dependency) => dependency.status === "unknown" && dependency.checkedAt === null)));
  } finally { sqlite.close(); }
});

test("0112 publishes unknown rather than stale when a mandatory dependency has no evidence", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    await recordDependencyHealth({
      db: d1,
      now: new Date("2026-08-05T08:49:00.000Z"),
      value: {
        environment: "development",
        key: "d1",
        state: "operational",
        latencyMs: 8,
        evidenceKind: "probe",
      },
    });
    const snapshot = await readPublicStatus({ db: d1, locale: "ru", environment: "development", now });
    assert.equal(snapshot.overallStatus, "unknown");
    assert.ok(snapshot.components.every((component) => component.status === "unknown"));
  } finally { sqlite.close(); }
});

test("admin status keeps actionable provider diagnostics while public status redacts billing detail", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    await seedOperationalDependencies(d1);
    await recordDependencyHealth({
      db: d1,
      now: new Date("2026-08-05T09:01:00.000Z"),
      value: {
        environment: "development",
        key: "anthropic",
        state: "degraded",
        latencyMs: 509,
        safeErrorCode: "PROVIDER_CREDIT_BALANCE_LOW",
        evidenceKind: "synthetic_probe",
      },
    });
    const admin = await readStatusIncidentAdminDashboard({
      db: d1,
      environment: "development",
      now: new Date("2026-08-05T09:02:00.000Z"),
    });
    assert.equal(admin.dependencies.find((dependency) => dependency.key === "anthropic")?.safeErrorCode, "PROVIDER_CREDIT_BALANCE_LOW");
    assert.equal(admin.generatedAt, "2026-08-05T09:02:00.000Z");

    const publicStatus = await readPublicStatus({
      db: d1,
      locale: "ru",
      environment: "development",
      now: new Date("2026-08-05T09:02:00.000Z"),
    });
    const publicAnthropic = publicStatus.components
      .flatMap((component) => component.dependencies)
      .find((dependency) => dependency.key === "anthropic");
    assert.equal(publicAnthropic?.safeErrorCode, "PROVIDER_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(publicStatus), /PROVIDER_CREDIT_BALANCE_LOW/);
  } finally { sqlite.close(); }
});

test("0083 rejects duplicate components and exposes no client-supplied actor", async () => {
  assert.equal(createStatusIncidentSchema.safeParse({
    titleRu: "Тестовый инцидент",
    titleUz: "Sinov hodisasi",
    titleEn: "Test incident",
    summaryRu: "Достаточно длинное публичное описание.",
    summaryUz: "Yetarlicha uzun ochiq tavsif matni.",
    summaryEn: "A sufficiently long public description.",
    messageRu: "Достаточно длинное первое обновление.",
    messageUz: "Yetarlicha uzun birinchi yangilanish.",
    messageEn: "A sufficiently long first incident update.",
    startedAt: now.toISOString(),
    components: [{ key: "ai", impact: "degraded" }, { key: "ai", impact: "outage" }],
  }).success, false);

  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seedUser(sqlite);
    await assert.rejects(
      createStatusIncident({
        db: d1,
        actorUserId: "missing-user",
        now,
        value: {
          titleRu: "Тестовый инцидент",
          titleUz: "Sinov hodisasi",
          titleEn: "Test incident",
          summaryRu: "Достаточно длинное публичное описание.",
          summaryUz: "Yetarlicha uzun ochiq tavsif matni.",
          summaryEn: "A sufficiently long public description.",
          messageRu: "Достаточно длинное первое обновление.",
          messageUz: "Yetarlicha uzun birinchi yangilanish.",
          messageEn: "A sufficiently long first incident update.",
          startedAt: now.toISOString(),
          components: [{ key: "platform", impact: "degraded" }],
        },
      }),
      (error: unknown) => error instanceof SystemStatusError && error.code === "SYSTEM_STATUS_PERSISTENCE_FAILED",
    );
    assert.equal((await readStatusIncidentAdminDashboard({
      db: d1,
      environment: "development",
      now,
    })).incidents.length, 0);
  } finally { sqlite.close(); }
});

test("status routes use a fresh-MFA operations boundary and a narrow public host surface", () => {
  const route = readFileSync(new URL("../app/api/platform/admin/system-status/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/[locale]/admin/system-status/page.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../app/_staff/SystemStatusConsole.tsx", import.meta.url), "utf8");
  const publicUi = readFileSync(new URL("../app/_status/PublicStatusPage.tsx", import.meta.url), "utf8");
  const publicApi = readFileSync(new URL("../app/api/status/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(route, /requirePlatformStaffRequest\(request, "staff\.operations\.manage", \{ freshMfaWithinMs: 15 \* 60 \* 1_000 \}\)/);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.doesNotMatch(route, /actorUserId:\s*parsed\.data/);
  assert.match(page, /requirePlatformStaffAccess\(runtime\.DB, session, "staff\.operations\.manage"/);
  assert.match(page + route, /dependencyHealthEnvironment\(runtime(?:Env\(\))?\.APP_ENV\)/);
  assert.match(publicApi, /STATUS_TEMPORARILY_UNAVAILABLE/);
  assert.match(publicApi, /isLocale\(requestedLocale\)/);
  assert.match(publicApi, /s-maxage=30/);
  assert.match(worker, /nativeHttpConfiguration\(process\.env, "platform"\)/);
  assert.match(worker, /normalizeNativeRequest\(request, privateAdminRequest \? internalConfig : config\)/);
  assert.match(worker, /listen\(port, "127\.0\.0\.1"/);
  assert.doesNotMatch(ui + publicUi, /dangerouslySetInnerHTML|transition:\s*all|window\.confirm/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /status-dependency-health/);
  assert.match(ui, /PROVIDER_CREDIT_BALANCE_LOW/);
  assert.match(ui, /titleEn/);
  assert.match(ui, /messageEn/);
  assert.match(publicUi, /role="status"/);
  assert.match(publicUi, /public-status-dependencies/);
  assert.match(publicUi, /dependency\.safeErrorCode/);
  assert.match(publicUi, /className="public-status-shell" lang=\{locale\}/);
  assert.match(publicUi, /en-GB/);
});
