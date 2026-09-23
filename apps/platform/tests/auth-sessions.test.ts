import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareDeviceContinuity,
} from "../lib/auth/device-continuity";
import { parseIdentityKeyring } from "../lib/auth/keyring";
import {
  authRequestSecurityContext,
  prepareAuthRequestSecurityEvidence,
} from "../lib/auth/request-security-evidence";
import {
  batchWithSecurityEvent,
  verifySecurityEventChain,
  type SecurityEventInput,
  type SecurityEventRecord,
} from "../lib/auth/security-events";
import {
  createEmailOtpSession,
  createLocalDevelopmentSession,
  deviceDisplayName,
  localSessionFromCookie,
  revokeOneSession,
  revokeSessions,
} from "../lib/auth/session-management";
import { rotatePeriodicSessionToken } from "../lib/auth/session-rotation";
import {
  clearLogoutPendingCookie,
  clearSessionCookie,
  replacementSessionCookies,
  replacementSessionCookiesUntil,
} from "../lib/auth/session";
import {
  logoutPendingCookie,
  sessionCookie,
  sessionCookieUntil,
  sharedAuthCookieDomain,
} from "../lib/auth/session-persistence";


function encodedKey(seed: number): string {
  const bytes = Uint8Array.from(
    { length: 32 },
    (_, index) => (seed + index) % 256,
  );
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function securityEvidenceKeyring() {
  return parseIdentityKeyring(JSON.stringify({
    active: "v1",
    versions: {
      v1: { aead: encodedKey(1), hmac: encodedKey(65) },
    },
  }));
}

type SqliteBinding = null | number | bigint | string;

class SqliteStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.database, this.sql, values);
  }

  private bindings(): SqliteBinding[] {
    return this.values.map((value) => {
      if (
        value === null
        || typeof value === "number"
        || typeof value === "bigint"
        || typeof value === "string"
      ) {
        return value;
      }
      throw new TypeError("Unsupported test binding.");
    });
  }

  execute<T>(): {
    results: T[];
    success: true;
    meta: { changes: number };
  } {
    const statement = this.database.prepare(this.sql);
    if (
      /^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(this.sql)
      || /\bRETURNING\b/i.test(this.sql)
    ) {
      const results = statement.all(...this.bindings()) as T[];
      const changes = Number(
        (
          this.database.prepare("SELECT changes() AS value").get() as {
            value: number | bigint;
          }
        ).value,
      );
      return { results, success: true, meta: { changes } };
    }
    const result = statement.run(...this.bindings());
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  async first<T>(): Promise<T | null> {
    return (
      this.database.prepare(this.sql).get(...this.bindings()) as T | undefined
    ) ?? null;
  }

  async all<T>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: number };
  }> {
    return this.execute<T>();
  }

  async run<T>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: number };
  }> {
    return this.execute<T>();
  }
}

function databaseFixture(): {
  sqlite: DatabaseSync;
  d1: D1Database;
} {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE user_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      email_ciphertext TEXT,
      email_iv TEXT,
      email_key_version TEXT,
      email_lookup_hash TEXT,
      email_lookup_key_version TEXT,
      phone TEXT,
      phone_ciphertext TEXT,
      phone_iv TEXT,
      phone_key_version TEXT,
      phone_lookup_hash TEXT,
      phone_lookup_key_version TEXT,
      full_name TEXT
    );

    CREATE TABLE auth_device_continuities (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      token_hmac TEXT NOT NULL,
      key_version TEXT NOT NULL,
      first_country_code TEXT,
      first_region_code TEXT,
      last_country_code TEXT,
      last_region_code TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      UNIQUE (user_id,key_version,token_hmac),
      FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE auth_devices (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      continuity_id TEXT,
      display_name TEXT NOT NULL,
      user_agent_hash TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (continuity_id) REFERENCES auth_device_continuities(id)
    );

    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      auth_method TEXT NOT NULL DEFAULT 'email_otp',
      assurance_level TEXT NOT NULL DEFAULT 'primary',
      authenticated_at TEXT,
      mfa_verified_at TEXT,
      expires_at TEXT NOT NULL,
      idle_expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES auth_devices(id) ON DELETE SET NULL
    );

    CREATE TABLE auth_session_token_history (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      rotation_reason TEXT NOT NULL,
      rotated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE auth_session_token_replays (
      id TEXT PRIMARY KEY NOT NULL,
      token_history_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      action TEXT NOT NULL,
      FOREIGN KEY (token_history_id)
        REFERENCES auth_session_token_history(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE security_events (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      device_id TEXT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      auth_source TEXT,
      assurance_level TEXT,
      ip_hash TEXT,
      user_agent_hash TEXT,
      metadata_json TEXT,
      previous_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL
        CONSTRAINT security_events_hash_uidx UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX security_events_chain_uidx
      ON security_events(user_id, previous_hash);

    CREATE TRIGGER security_events_no_update
    BEFORE UPDATE ON security_events
    BEGIN
      SELECT RAISE(ABORT, 'security_events are append-only');
    END;

    CREATE TRIGGER security_events_no_delete
    BEFORE DELETE ON security_events
    BEGIN
      SELECT RAISE(ABORT, 'security_events are append-only');
    END;
  `);
  const d1 = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) =>
          (statement as unknown as SqliteStatement).execute()
        );
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { sqlite, d1 };
}

function insertUser(
  sqlite: DatabaseSync,
  id: string,
  email = `${id}@example.test`,
  fullName: string | null = `User ${id}`,
) {
  sqlite.prepare(
    "INSERT INTO user_profiles (id,email,full_name) VALUES (?,?,?)",
  ).run(id, email, fullName);
}

function sessionRow(sqlite: DatabaseSync, sessionId: string) {
  return sqlite.prepare(`
    SELECT
      user_id AS userId,
      device_id AS deviceId,
      token_hash AS tokenHash,
      auth_method AS authMethod,
      assurance_level AS assuranceLevel,
      authenticated_at AS authenticatedAt,
      expires_at AS expiresAt,
      idle_expires_at AS idleExpiresAt,
      revoked_at AS revokedAt,
      created_at AS createdAt,
      last_seen_at AS lastSeenAt
    FROM auth_sessions
    WHERE id=?
  `).get(sessionId) as {
    userId: string;
    deviceId: string | null;
    tokenHash: string;
    authMethod: string;
    assuranceLevel: string;
    authenticatedAt: string | null;
    expiresAt: string;
    idleExpiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    lastSeenAt: string;
  };
}

function deviceRow(sqlite: DatabaseSync, deviceId: string) {
  return sqlite.prepare(`
    SELECT
      user_id AS userId,
      display_name AS displayName,
      user_agent_hash AS userAgentHash,
      first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt,
      revoked_at AS revokedAt
    FROM auth_devices
    WHERE id=?
  `).get(deviceId) as {
    userId: string;
    displayName: string;
    userAgentHash: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    revokedAt: string | null;
  };
}

type StoredSecurityEvent = SecurityEventInput
  & SecurityEventRecord
  & { eventType: string };

function securityEventsFor(
  sqlite: DatabaseSync,
  userId: string,
): StoredSecurityEvent[] {
  const rows = sqlite.prepare(`
    SELECT
      id,
      user_id AS userId,
      session_id AS sessionId,
      device_id AS deviceId,
      event_type AS eventType,
      severity,
      auth_source AS authSource,
      assurance_level AS assuranceLevel,
      ip_hash AS ipHash,
      user_agent_hash AS userAgentHash,
      metadata_json AS metadataJson,
      previous_hash AS previousHash,
      event_hash AS eventHash,
      created_at AS createdAt
    FROM security_events
    WHERE user_id=?
    ORDER BY created_at,id
  `).all(userId) as Array<
    Omit<StoredSecurityEvent, "metadata"> & { metadataJson: string | null }
  >;
  return rows.map((row) => ({
    ...row,
    metadata: row.metadataJson
      ? JSON.parse(row.metadataJson) as Record<string, unknown>
      : null,
  }));
}

test("device display names are deterministic and avoid raw user-agent output", () => {
  assert.equal(deviceDisplayName(null), "Unknown device");
  assert.equal(deviceDisplayName("   "), "Unknown device");
  assert.equal(
    deviceDisplayName(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      + "AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0",
    ),
    "Microsoft Edge · Windows",
  );
  assert.equal(
    deviceDisplayName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      + "AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
    ),
    "Safari · macOS",
  );
  assert.equal(
    deviceDisplayName(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
      + "AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1",
    ),
    "Chrome · iOS",
  );
  assert.equal(
    deviceDisplayName("custom-client/1.0"),
    "Browser · Unknown device",
  );
  assert.doesNotMatch(
    deviceDisplayName("custom-client/1.0"),
    /custom-client/,
  );
});

test("session request evidence stores only keyed hashes and coarse location", async () => {
  const request = new Request("https://app.juro.uz/api/auth/verify-otp", {
    headers: {
      "x-juro-client-ip": "203.0.113.18",
      "user-agent": "Browser/9.0 private-build",
    },
  });
  Object.defineProperty(request, "cf", {
    value: { country: "uz", regionCode: "tk" },
  });
  const context = authRequestSecurityContext(request);
  assert.deepEqual(context, {
    connectingIp: "203.0.113.18",
    userAgent: "Browser/9.0 private-build",
    countryCode: null,
    regionCode: null,
  });
  const evidence = await prepareAuthRequestSecurityEvidence(
    securityEvidenceKeyring(),
    "user-evidence",
    context,
  );
  assert.ok(evidence);
  assert.match(evidence.ipHash ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.match(evidence.userAgentHash ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(evidence.ipHash, context.connectingIp);
  assert.notEqual(evidence.userAgentHash, context.userAgent);
  assert.equal(await prepareAuthRequestSecurityEvidence(
    null,
    "user-evidence",
    context,
  ), null);
  assert.deepEqual(await prepareAuthRequestSecurityEvidence(
    securityEvidenceKeyring(),
    "user-evidence",
    {
      connectingIp: "x".repeat(65),
      userAgent: "x".repeat(513),
      countryCode: "not-a-country",
      regionCode: "region code",
    },
  ), {
    ipHash: null,
    userAgentHash: null,
    keyVersion: "v1",
    countryCode: null,
    regionCode: null,
  });

  const invalid = new Request("https://app.juro.uz/", {
    headers: {
      "x-juro-client-ip": "x".repeat(65),
      "user-agent": "x".repeat(513),
    },
  });
  Object.defineProperty(invalid, "cf", {
    value: { country: "not-a-country", regionCode: "region code" },
  });
  assert.deepEqual(authRequestSecurityContext(invalid), {
    connectingIp: null,
    userAgent: null,
    countryCode: null,
    regionCode: null,
  });

  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-evidence", "evidence@example.test", "Evidence User");
    const created = await createEmailOtpSession(d1, {
      userId: "user-evidence",
      userAgent: context.userAgent,
      securityEvidence: evidence,
      now: new Date("2026-07-26T09:00:00.000Z"),
    });
    const [event] = securityEventsFor(sqlite, "user-evidence");
    assert.equal(event.sessionId, created.sessionId);
    assert.equal(event.ipHash, evidence.ipHash);
    assert.equal(event.userAgentHash, evidence.userAgentHash);
    assert.deepEqual(event.metadata, {
      authMethod: "email_otp",
      deviceName: "Browser · Unknown device",
      requestEvidence: {
        keyVersion: "v1",
        countryCode: null,
        regionCode: null,
      },
    });
    assert.doesNotMatch(
      JSON.stringify(event),
      /203\.0\.113\.18|Browser\/9\.0 private-build/,
    );
    assert.equal(await verifySecurityEventChain([event]), true);
  } finally {
    sqlite.close();
  }
});

test("opaque continuity is HMAC-only, tenant-scoped, rotation-safe, and concurrency-safe", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    insertUser(sqlite, "user-b");
    const v1 = securityEvidenceKeyring();
    const evidence = {
      ipHash: "A".repeat(43),
      userAgentHash: "B".repeat(43),
      keyVersion: "v1",
      countryCode: "UZ",
      regionCode: "TK",
    };
    const browserToken = "C".repeat(43);
    const preparedOne = await prepareDeviceContinuity(d1, v1, {
      userId: "user-a",
      deviceToken: browserToken,
      securityEvidence: evidence,
      now: new Date("2026-07-26T09:10:00.000Z"),
    });
    const preparedConcurrent = await prepareDeviceContinuity(d1, v1, {
      userId: "user-a",
      deviceToken: browserToken,
      securityEvidence: evidence,
      now: new Date("2026-07-26T09:10:00.000Z"),
    });
    assert.ok(preparedOne);
    assert.ok(preparedConcurrent);
    assert.equal(preparedOne.id, preparedConcurrent.id);
    assert.equal(preparedOne.recognized, false);
    assert.equal(preparedConcurrent.recognized, false);

    const first = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Browser/1.0",
      securityEvidence: evidence,
      deviceContinuity: preparedOne,
      now: new Date("2026-07-26T09:10:00.000Z"),
    });
    const concurrent = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Browser/1.0",
      securityEvidence: evidence,
      deviceContinuity: preparedConcurrent,
      now: new Date("2026-07-26T09:10:01.000Z"),
    });
    assert.equal(first.deviceContinuityId, concurrent.deviceContinuityId);
    assert.equal((sqlite.prepare(
      "SELECT count(*) AS total FROM auth_device_continuities WHERE user_id=?",
    ).get("user-a") as { total: number }).total, 1);
    assert.equal((sqlite.prepare(
      "SELECT count(*) AS total FROM auth_devices WHERE continuity_id=?",
    ).get(first.deviceContinuityId) as { total: number }).total, 2);
    const stored = sqlite.prepare(
      `SELECT token_hmac AS tokenHmac,key_version AS keyVersion,
         first_country_code AS countryCode,first_region_code AS regionCode
       FROM auth_device_continuities WHERE id=?`,
    ).get(first.deviceContinuityId) as {
      tokenHmac: string;
      keyVersion: string;
      countryCode: string;
      regionCode: string;
    };
    assert.match(stored.tokenHmac, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(stored.tokenHmac, browserToken);
    assert.deepEqual(
      { keyVersion: stored.keyVersion, countryCode: stored.countryCode, regionCode: stored.regionCode },
      { keyVersion: "v1", countryCode: "UZ", regionCode: "TK" },
    );

    const recognized = await prepareDeviceContinuity(d1, v1, {
      userId: "user-a",
      deviceToken: browserToken,
      securityEvidence: evidence,
      now: new Date("2026-07-26T09:11:00.000Z"),
    });
    assert.equal(recognized?.recognized, true);
    assert.equal(recognized?.id, first.deviceContinuityId);

    const foreign = await prepareDeviceContinuity(d1, v1, {
      userId: "user-b",
      deviceToken: browserToken,
      securityEvidence: evidence,
      now: new Date("2026-07-26T09:12:00.000Z"),
    });
    assert.equal(foreign?.recognized, false);
    assert.notEqual(foreign?.id, first.deviceContinuityId);

    const rotated = parseIdentityKeyring(JSON.stringify({
      active: "v2",
      versions: {
        v1: { aead: encodedKey(1), hmac: encodedKey(65) },
        v2: { aead: encodedKey(2), hmac: encodedKey(66) },
      },
    }));
    const rekeyed = await prepareDeviceContinuity(d1, rotated, {
      userId: "user-a",
      deviceToken: browserToken,
      securityEvidence: evidence,
      now: new Date("2026-07-26T09:13:00.000Z"),
    });
    assert.equal(rekeyed?.recognized, true);
    assert.equal(rekeyed?.id, first.deviceContinuityId);
    await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Browser/2.0",
      deviceContinuity: rekeyed,
      now: new Date("2026-07-26T09:13:00.000Z"),
    });
    assert.equal((sqlite.prepare(
      "SELECT key_version AS keyVersion FROM auth_device_continuities WHERE id=?",
    ).get(first.deviceContinuityId) as { keyVersion: string }).keyVersion, "v2");
  } finally {
    sqlite.close();
  }
});

test("security revoke propagates through continuity while normal logout preserves trust", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    const keyring = securityEvidenceKeyring();
    const token = "D".repeat(43);
    const firstContinuity = await prepareDeviceContinuity(d1, keyring, {
      userId: "user-a",
      deviceToken: token,
      now: new Date("2026-07-26T09:20:00.000Z"),
    });
    const first = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Browser/1.0",
      deviceContinuity: firstContinuity,
      now: new Date("2026-07-26T09:20:00.000Z"),
    });
    const recognized = await prepareDeviceContinuity(d1, keyring, {
      userId: "user-a",
      deviceToken: token,
      now: new Date("2026-07-26T09:21:00.000Z"),
    });
    const second = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Browser/1.0",
      deviceContinuity: recognized,
      now: new Date("2026-07-26T09:21:00.000Z"),
    });
    assert.deepEqual(await revokeOneSession(d1, {
      userId: "user-a",
      sessionId: first.sessionId,
      currentSessionId: first.sessionId,
      revokeDeviceContinuity: false,
      now: new Date("2026-07-26T09:22:00.000Z"),
    }), { revoked: true, revokedCurrent: true });
    assert.equal((sqlite.prepare(
      "SELECT revoked_at AS revokedAt FROM auth_device_continuities WHERE id=?",
    ).get(first.deviceContinuityId) as { revokedAt: string | null }).revokedAt, null);
    assert.ok(await localSessionFromCookie(d1, `juro_session=${second.token}`, {
      now: new Date("2026-07-26T09:22:01.000Z"),
      touch: false,
    }));

    assert.deepEqual(await revokeOneSession(d1, {
      userId: "user-a",
      sessionId: second.sessionId,
      currentSessionId: second.sessionId,
      now: new Date("2026-07-26T09:23:00.000Z"),
    }), { revoked: true, revokedCurrent: true });
    assert.equal((sqlite.prepare(
      "SELECT revoked_at AS revokedAt FROM auth_device_continuities WHERE id=?",
    ).get(first.deviceContinuityId) as { revokedAt: string | null }).revokedAt,
    "2026-07-26T09:23:00.000Z");
    assert.equal(await localSessionFromCookie(d1, `juro_session=${second.token}`, {
      now: new Date("2026-07-26T09:23:01.000Z"),
      touch: false,
    }), null);
    const replacement = await prepareDeviceContinuity(d1, keyring, {
      userId: "user-a",
      deviceToken: token,
      now: new Date("2026-07-26T09:24:00.000Z"),
    });
    assert.equal(replacement?.recognized, false);
    assert.notEqual(replacement?.token, token);
    assert.notEqual(replacement?.id, first.deviceContinuityId);
  } finally {
    sqlite.close();
  }
});
test("email OTP session creation atomically stores device, primary assurance, and audit event", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a", "user-a@example.test", "Alice Example");
    const now = new Date("2026-07-26T10:00:00.000Z");
    const created = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        + "AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      now,
    });

    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(created.expiresAt, "2026-07-27T10:00:00.000Z");
    assert.equal(created.idleExpiresAt, "2026-07-27T10:00:00.000Z");

    const session = sessionRow(sqlite, created.sessionId);
    assert.equal(session.userId, "user-a");
    assert.equal(session.deviceId, created.deviceId);
    assert.notEqual(session.tokenHash, created.token);
    assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(session.authMethod, "email_otp");
    assert.equal(session.assuranceLevel, "primary");
    assert.equal(session.authenticatedAt, now.toISOString());
    assert.equal(session.createdAt, now.toISOString());
    assert.equal(session.lastSeenAt, now.toISOString());
    assert.equal(session.revokedAt, null);

    assert.deepEqual({ ...deviceRow(sqlite, created.deviceId) }, {
      userId: "user-a",
      displayName: "Chrome · Windows",
      userAgentHash: null,
      firstSeenAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      revokedAt: null,
    });

    const events = securityEventsFor(sqlite, "user-a");
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "session.created");
    assert.equal(events[0].sessionId, created.sessionId);
    assert.equal(events[0].deviceId, created.deviceId);
    assert.equal(events[0].authSource, "local_session");
    assert.equal(events[0].assuranceLevel, "primary");
    assert.deepEqual(events[0].metadata, {
      authMethod: "email_otp",
      deviceName: "Chrome · Windows",
    });
    assert.equal(await verifySecurityEventChain(events), true);

    const current = await localSessionFromCookie(
      d1,
      `other=value; juro_session=${created.token}`,
      { now, touch: false },
    );
    assert.equal(current?.sessionId, created.sessionId);
    assert.equal(current?.userId, "user-a");
    assert.equal(current?.email, "user-a@example.test");
    assert.equal(current?.fullName, "Alice Example");
    assert.equal(current?.deviceName, "Chrome · Windows");
    assert.equal(current?.assuranceLevel, "primary");
  } finally {
    sqlite.close();
  }
});

test("local development login creates an ordinary audited session", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "local-developer", "developer@local.juro.uz", "JURO Local Developer");
    const now = new Date("2026-08-10T02:00:00.000Z");
    const created = await createLocalDevelopmentSession(d1, {
      userId: "local-developer",
      userAgent: "Mozilla/5.0 Windows Chrome/126.0",
      now,
    });

    const session = sessionRow(sqlite, created.sessionId);
    assert.equal(session.authMethod, "development_bypass");
    assert.equal(session.assuranceLevel, "primary");
    assert.equal(session.revokedAt, null);

    const events = securityEventsFor(sqlite, "local-developer");
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "session.created");
    assert.equal(events[0].authSource, "local_session");
    assert.deepEqual(events[0].metadata, {
      authMethod: "development_bypass",
      deviceName: "Chrome · Windows",
    });

    const current = await localSessionFromCookie(
      d1,
      `juro_session=${created.token}`,
      { now, touch: false },
    );
    assert.equal(current?.userId, "local-developer");
    assert.equal(current?.assuranceLevel, "primary");
  } finally {
    sqlite.close();
  }
});

test("remember-me keeps cookie and persisted absolute expiry aligned", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    const now = new Date("2026-07-26T10:00:00.000Z");
    const cases = [
      {
        rememberMe: false,
        userId: "standard-session",
        expiresAt: "2026-07-27T10:00:00.000Z",
        idleExpiresAt: "2026-07-27T10:00:00.000Z",
        maxAge: 86_400,
      },
      {
        rememberMe: true,
        userId: "remembered-session",
        expiresAt: "2026-08-25T10:00:00.000Z",
        idleExpiresAt: "2026-08-02T10:00:00.000Z",
        maxAge: 2_592_000,
      },
    ] as const;

    for (const expected of cases) {
      insertUser(sqlite, expected.userId);
      const created = await createEmailOtpSession(d1, {
        userId: expected.userId,
        userAgent: "Browser/1.0",
        rememberMe: expected.rememberMe,
        now,
      });
      const persisted = sessionRow(sqlite, created.sessionId);
      assert.equal(created.expiresAt, expected.expiresAt);
      assert.equal(created.idleExpiresAt, expected.idleExpiresAt);
      assert.equal(persisted.expiresAt, expected.expiresAt);
      assert.equal(persisted.idleExpiresAt, expected.idleExpiresAt);
      assert.match(
        sessionCookie(created.token, expected.rememberMe),
        new RegExp(`(?:^|; )Max-Age=${expected.maxAge}(?:;|$)`),
      );
    }

    assert.match(sessionCookie("token"), /(?:^|; )Max-Age=86400(?:;|$)/);
    assert.doesNotMatch(sessionCookie("token"), /(?:^|; )Domain=/u);
    assert.equal(sharedAuthCookieDomain("app.juro.uz"), ".juro.uz");
    assert.equal(sharedAuthCookieDomain("lawyer.juro.uz"), ".juro.uz");
    assert.equal(sharedAuthCookieDomain("app.staging.juro.uz"), undefined);
    assert.equal(sharedAuthCookieDomain("localhost"), undefined);
    assert.deepEqual(
      replacementSessionCookies("token", false, "app.juro.uz"),
      [
        clearSessionCookie(".juro.uz"),
        clearSessionCookie(),
        clearLogoutPendingCookie(),
        sessionCookie("token", false),
      ],
    );
    assert.deepEqual(
      replacementSessionCookies("token", true, "lawyer.juro.uz"),
      [
        clearSessionCookie(".juro.uz"),
        clearSessionCookie(),
        clearLogoutPendingCookie(),
        sessionCookie("token", true),
      ],
    );
    assert.deepEqual(
      replacementSessionCookies("token", false, "localhost"),
      [
        clearSessionCookie(),
        clearLogoutPendingCookie(),
        sessionCookie("token", false),
      ],
    );
    assert.match(
      sessionCookieUntil(
        "rotated-token",
        "2026-07-26T10:00:10.900Z",
        now,
      ),
      /(?:^|; )Max-Age=10(?:;|$)/,
    );
    assert.match(
      sessionCookieUntil(
        "expired-token",
        "2026-07-26T09:59:59.999Z",
        now,
      ),
      /(?:^|; )Max-Age=0(?:;|$)/,
    );
    assert.deepEqual(
      replacementSessionCookiesUntil(
        "rotated-token",
        "2026-07-26T10:00:10.900Z",
        "app.juro.uz",
        now,
      ),
      [
        clearSessionCookie(".juro.uz"),
        clearSessionCookie(),
        clearLogoutPendingCookie(),
        sessionCookieUntil(
          "rotated-token",
          "2026-07-26T10:00:10.900Z",
          now,
        ),
      ],
    );
    assert.doesNotMatch(
      replacementSessionCookiesUntil(
        "rotated-token",
        "2026-07-26T10:00:10.900Z",
        "app.juro.uz",
        now,
      ).at(-1) ?? "",
      /(?:^|; )Domain=/u,
    );
    assert.match(
      logoutPendingCookie(),
      /^__Host-juro_logout_pending=1; Path=\/; Secure; SameSite=Lax; Max-Age=2592000$/u,
    );
    assert.doesNotMatch(logoutPendingCookie(), /HttpOnly|Domain=/u);
    assert.equal(
      clearLogoutPendingCookie(),
      "__Host-juro_logout_pending=; Path=/; Secure; SameSite=Lax; Max-Age=0",
    );
    assert.throws(
      () => sessionCookieUntil("token", "invalid", now),
      /INVALID_SESSION_EXPIRY/,
    );
  } finally {
    sqlite.close();
  }
});

test("active lookup enforces idle and absolute expiry and throttles session/device touch", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    const created = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0",
      rememberMe: true,
      now: createdAt,
    });
    const cookie = `juro_session=${created.token}`;

    const beforeThreshold = await localSessionFromCookie(
      d1,
      cookie,
      { now: new Date("2026-07-01T00:04:59.999Z") },
    );
    assert.equal(beforeThreshold?.lastSeenAt, createdAt.toISOString());
    assert.equal(
      sessionRow(sqlite, created.sessionId).lastSeenAt,
      createdAt.toISOString(),
    );
    assert.equal(
      deviceRow(sqlite, created.deviceId).lastSeenAt,
      createdAt.toISOString(),
    );

    const touchedAt = new Date("2026-07-01T00:05:00.000Z");
    const touched = await localSessionFromCookie(
      d1,
      cookie,
      { now: touchedAt },
    );
    assert.equal(touched?.lastSeenAt, touchedAt.toISOString());
    assert.equal(touched?.idleExpiresAt, "2026-07-08T00:05:00.000Z");
    assert.equal(
      sessionRow(sqlite, created.sessionId).lastSeenAt,
      touchedAt.toISOString(),
    );
    assert.equal(
      deviceRow(sqlite, created.deviceId).lastSeenAt,
      touchedAt.toISOString(),
    );

    const noTouch = await localSessionFromCookie(
      d1,
      cookie,
      {
        now: new Date("2026-07-01T12:00:00.000Z"),
        touch: false,
      },
    );
    assert.equal(noTouch?.lastSeenAt, touchedAt.toISOString());
    assert.equal(
      sessionRow(sqlite, created.sessionId).lastSeenAt,
      touchedAt.toISOString(),
    );

    assert.equal(
      await localSessionFromCookie(
        d1,
        cookie,
        {
          now: new Date("2026-07-08T00:05:00.000Z"),
          touch: false,
        },
      ),
      null,
    );

    sqlite.prepare(`
      UPDATE auth_sessions
      SET idle_expires_at=expires_at
      WHERE id=?
    `).run(created.sessionId);
    assert.equal(
      await localSessionFromCookie(
        d1,
        cookie,
        {
          now: new Date("2026-07-31T00:00:00.000Z"),
          touch: false,
        },
      ),
      null,
    );
  } finally {
    sqlite.close();
  }
});

test("periodic rotation preserves absolute expiry and tolerates only an in-flight grace window", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    const created = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 Windows Chrome/126.0",
      rememberMe: true,
      now: createdAt,
    });

    const notDue = await rotatePeriodicSessionToken(d1, {
      userId: "user-a",
      sessionId: created.sessionId,
      currentToken: created.token,
      now: new Date("2026-07-01T11:59:59.999Z"),
    });
    assert.deepEqual(notDue, {
      status: "not_due",
      expiresAt: created.expiresAt,
      nextRotationAt: "2026-07-01T12:00:00.000Z",
    });

    const rotated = await rotatePeriodicSessionToken(d1, {
      userId: "user-a",
      sessionId: created.sessionId,
      currentToken: created.token,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });
    assert.equal(rotated.status, "rotated");
    if (rotated.status !== "rotated") throw new Error("rotation expected");
    assert.notEqual(rotated.token, created.token);
    assert.equal(rotated.expiresAt, created.expiresAt);
    assert.equal(rotated.nextRotationAt, "2026-07-02T00:00:00.000Z");
    const history = sqlite.prepare(`
      SELECT rotation_reason AS rotationReason,rotated_at AS rotatedAt,
        expires_at AS expiresAt
      FROM auth_session_token_history WHERE session_id=?
    `).get(created.sessionId) as {
      rotationReason: string;
      rotatedAt: string;
      expiresAt: string;
    };
    assert.equal(history.rotationReason, "periodic");
    assert.equal(history.rotatedAt, "2026-07-01T12:00:00.000Z");
    assert.equal(history.expiresAt, created.expiresAt);

    assert.deepEqual(
      await rotatePeriodicSessionToken(d1, {
        userId: "user-a",
        sessionId: created.sessionId,
        currentToken: rotated.token,
        now: new Date("2026-07-01T12:00:01.000Z"),
      }),
      {
        status: "not_due",
        expiresAt: created.expiresAt,
        nextRotationAt: "2026-07-02T00:00:00.000Z",
      },
    );

    assert.equal(
      await localSessionFromCookie(
        d1,
        `juro_session=${created.token}`,
        { now: new Date("2026-07-01T12:00:10.000Z"), touch: false },
      ),
      null,
    );
    assert.equal(sessionRow(sqlite, created.sessionId).revokedAt, null);
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM auth_session_token_replays",
      ).get() as { total: number }).total,
      0,
    );
    assert.ok(await localSessionFromCookie(
      d1,
      `juro_session=${rotated.token}`,
      { now: new Date("2026-07-01T12:00:20.000Z"), touch: false },
    ));

    assert.equal(
      await localSessionFromCookie(
        d1,
        `juro_session=${created.token}`,
        { now: new Date("2026-07-01T12:00:30.000Z"), touch: false },
      ),
      null,
    );
    assert.equal(
      sessionRow(sqlite, created.sessionId).revokedAt,
      "2026-07-01T12:00:30.000Z",
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM auth_session_token_replays",
      ).get() as { total: number }).total,
      1,
    );
    assert.deepEqual(
      securityEventsFor(sqlite, "user-a").map(({ eventType }) => eventType),
      ["session.created", "session.token_rotated", "session.token_replayed"],
    );
  } finally {
    sqlite.close();
  }
});

test("replayed retired token revokes every session in its continuity chain", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-replay-chain");
    const keyring = securityEvidenceKeyring();
    const token = "F".repeat(43);
    const firstContinuity = await prepareDeviceContinuity(d1, keyring, {
      userId: "user-replay-chain",
      deviceToken: token,
      now: new Date("2026-07-26T00:00:00.000Z"),
    });
    const first = await createEmailOtpSession(d1, {
      userId: "user-replay-chain",
      userAgent: "Browser/1.0",
      deviceContinuity: firstContinuity,
      now: new Date("2026-07-26T00:00:00.000Z"),
    });
    const recognized = await prepareDeviceContinuity(d1, keyring, {
      userId: "user-replay-chain",
      deviceToken: token,
      now: new Date("2026-07-26T00:01:00.000Z"),
    });
    const second = await createEmailOtpSession(d1, {
      userId: "user-replay-chain",
      userAgent: "Browser/1.0",
      deviceContinuity: recognized,
      now: new Date("2026-07-26T00:01:00.000Z"),
    });
    const rotated = await rotatePeriodicSessionToken(d1, {
      userId: "user-replay-chain",
      sessionId: first.sessionId,
      currentToken: first.token,
      now: new Date("2026-07-26T13:00:00.000Z"),
    });
    assert.equal(rotated.status, "rotated");
    assert.equal(await localSessionFromCookie(d1, `juro_session=${first.token}`, {
      now: new Date("2026-07-26T13:00:31.000Z"),
      touch: false,
    }), null);
    assert.equal(await localSessionFromCookie(d1, `juro_session=${second.token}`, {
      now: new Date("2026-07-26T13:00:32.000Z"),
      touch: false,
    }), null);
    assert.equal((sqlite.prepare(
      "SELECT revoked_at AS revokedAt FROM auth_device_continuities WHERE id=?",
    ).get(first.deviceContinuityId) as { revokedAt: string | null }).revokedAt,
    "2026-07-26T13:00:31.000Z");
    const event = securityEventsFor(sqlite, "user-replay-chain").at(-1);
    assert.equal(event?.eventType, "session.token_replayed");
    assert.equal(event?.metadata?.deviceContinuityRevoked, true);
  } finally {
    sqlite.close();
  }
});
test("single-session revocation is user-scoped and reports whether the current session was revoked", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    insertUser(sqlite, "user-b");
    const current = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 Windows Chrome/126.0",
      now: new Date("2026-07-26T10:00:00.000Z"),
    });
    const other = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 Macintosh Safari/605.1",
      now: new Date("2026-07-26T10:01:00.000Z"),
    });
    const foreign = await createEmailOtpSession(d1, {
      userId: "user-b",
      userAgent: "Mozilla/5.0 Linux Firefox/128.0",
      now: new Date("2026-07-26T10:02:00.000Z"),
    });

    await assert.rejects(
      revokeOneSession(d1, {
        userId: "user-a",
        sessionId: foreign.sessionId,
        currentSessionId: current.sessionId,
        now: new Date("2026-07-26T10:03:00.000Z"),
      }),
      /SESSION_NOT_FOUND/,
    );
    assert.equal(sessionRow(sqlite, foreign.sessionId).revokedAt, null);

    assert.deepEqual(
      await revokeOneSession(d1, {
        userId: "user-a",
        sessionId: other.sessionId,
        currentSessionId: current.sessionId,
        now: new Date("2026-07-26T10:04:00.000Z"),
      }),
      { revoked: true, revokedCurrent: false },
    );
    assert.equal(
      sessionRow(sqlite, other.sessionId).revokedAt,
      "2026-07-26T10:04:00.000Z",
    );
    assert.equal(
      deviceRow(sqlite, other.deviceId).revokedAt,
      "2026-07-26T10:04:00.000Z",
    );
    assert.equal(sessionRow(sqlite, current.sessionId).revokedAt, null);
    assert.equal(sessionRow(sqlite, foreign.sessionId).revokedAt, null);

    assert.deepEqual(
      await revokeOneSession(d1, {
        userId: "user-a",
        sessionId: other.sessionId,
        currentSessionId: current.sessionId,
        now: new Date("2026-07-26T10:05:00.000Z"),
      }),
      { revoked: false, revokedCurrent: false },
    );

    assert.deepEqual(
      await revokeOneSession(d1, {
        userId: "user-a",
        sessionId: current.sessionId,
        currentSessionId: current.sessionId,
        now: new Date("2026-07-26T10:06:00.000Z"),
      }),
      { revoked: true, revokedCurrent: true },
    );
    assert.equal(
      await localSessionFromCookie(
        d1,
        `juro_session=${current.token}`,
        {
          now: new Date("2026-07-26T10:06:01.000Z"),
          touch: false,
        },
      ),
      null,
    );
    assert.equal(sessionRow(sqlite, foreign.sessionId).revokedAt, null);

    const eventTypes = securityEventsFor(sqlite, "user-a")
      .map(({ eventType }) => eventType);
    assert.deepEqual(eventTypes, [
      "session.created",
      "session.created",
      "session.revoked",
      "session.revoked",
    ]);
  } finally {
    sqlite.close();
  }
});

test("others and all revocation remain inside the requested user boundary", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    insertUser(sqlite, "user-b");
    const current = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 Windows Chrome/126.0",
      now: new Date("2026-07-26T11:00:00.000Z"),
    });
    const otherOne = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 Linux Firefox/128.0",
      now: new Date("2026-07-26T11:01:00.000Z"),
    });
    const otherTwo = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 Android Chrome/126.0",
      now: new Date("2026-07-26T11:02:00.000Z"),
    });
    const foreign = await createEmailOtpSession(d1, {
      userId: "user-b",
      userAgent: "Mozilla/5.0 iPhone Safari/605.1",
      now: new Date("2026-07-26T11:03:00.000Z"),
    });

    await assert.rejects(
      revokeSessions(d1, {
        userId: "user-a",
        currentSessionId: null,
        scope: "others",
        now: new Date("2026-07-26T11:04:00.000Z"),
      }),
      /CURRENT_LOCAL_SESSION_REQUIRED/,
    );

    assert.equal(
      await revokeSessions(d1, {
        userId: "user-a",
        currentSessionId: current.sessionId,
        scope: "others",
        now: new Date("2026-07-26T11:05:00.000Z"),
      }),
      2,
    );
    assert.equal(sessionRow(sqlite, current.sessionId).revokedAt, null);
    assert.equal(
      sessionRow(sqlite, otherOne.sessionId).revokedAt,
      "2026-07-26T11:05:00.000Z",
    );
    assert.equal(
      sessionRow(sqlite, otherTwo.sessionId).revokedAt,
      "2026-07-26T11:05:00.000Z",
    );
    assert.equal(sessionRow(sqlite, foreign.sessionId).revokedAt, null);

    assert.equal(
      await revokeSessions(d1, {
        userId: "user-a",
        currentSessionId: current.sessionId,
        scope: "all",
        now: new Date("2026-07-26T11:06:00.000Z"),
      }),
      1,
    );
    assert.equal(
      sessionRow(sqlite, current.sessionId).revokedAt,
      "2026-07-26T11:06:00.000Z",
    );
    assert.equal(sessionRow(sqlite, foreign.sessionId).revokedAt, null);
    assert.equal(deviceRow(sqlite, foreign.deviceId).revokedAt, null);

    const eventTypes = securityEventsFor(sqlite, "user-a")
      .map(({ eventType }) => eventType);
    assert.deepEqual(eventTypes, [
      "session.created",
      "session.created",
      "session.created",
      "session.revoked_others",
      "session.revoked_all",
    ]);
  } finally {
    sqlite.close();
  }
});

test("security events form a canonical append-only per-user hash chain", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    await batchWithSecurityEvent(
      d1,
      {
        id: "event-a",
        userId: "user-a",
        eventType: "security.first",
        metadata: { z: 1, nested: { b: 2, a: 1 }, a: 2 },
        createdAt: "2026-07-26T12:00:00.000Z",
      },
      () => [],
    );
    await batchWithSecurityEvent(
      d1,
      {
        id: "event-b",
        userId: "user-a",
        eventType: "security.second",
        severity: "warning",
        metadata: { reason: "test" },
        createdAt: "2026-07-26T12:01:00.000Z",
      },
      () => [],
    );

    const events = securityEventsFor(sqlite, "user-a");
    assert.equal(events.length, 2);
    assert.equal(events[0].previousHash, "0".repeat(64));
    assert.equal(events[1].previousHash, events[0].eventHash);
    assert.equal(
      events[0].metadataJson,
      '{"a":2,"nested":{"a":1,"b":2},"z":1}',
    );
    assert.equal(await verifySecurityEventChain(events), true);

    const tampered = events.map((event) => ({
      ...event,
      metadata: event.metadata ? { ...event.metadata } : null,
    }));
    tampered[1].metadata = { reason: "tampered" };
    assert.equal(await verifySecurityEventChain(tampered), false);

    assert.throws(
      () => sqlite.prepare(
        "UPDATE security_events SET severity='critical' WHERE id='event-a'",
      ).run(),
      /append-only/,
    );
    assert.throws(
      () => sqlite.prepare(
        "DELETE FROM security_events WHERE id='event-a'",
      ).run(),
      /append-only/,
    );
  } finally {
    sqlite.close();
  }
});

test("security-event tail follows hashes instead of out-of-order timestamps", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    for (const [id, createdAt] of [
      ["event-a", "2026-07-26T12:00:00.000Z"],
      ["event-b", "2026-07-26T12:02:00.000Z"],
      ["event-c", "2026-07-26T12:01:00.000Z"],
      ["event-d", "2026-07-26T12:03:00.000Z"],
    ] as const) {
      await batchWithSecurityEvent(
        d1,
        {
          id,
          userId: "user-a",
          eventType: `security.${id}`,
          createdAt,
        },
        () => [],
      );
    }
    const events = sqlite.prepare(`
      SELECT id,previous_hash AS previousHash,event_hash AS eventHash
      FROM security_events
      WHERE user_id='user-a'
      ORDER BY rowid
    `).all() as Array<{
      id: string;
      previousHash: string;
      eventHash: string;
    }>;
    assert.equal(events.length, 4);
    assert.equal(events[0].previousHash, "0".repeat(64));
    for (let index = 1; index < events.length; index += 1) {
      assert.equal(events[index].previousHash, events[index - 1].eventHash);
    }
  } finally {
    sqlite.close();
  }
});

test("forced security-audit failure rolls back session creation and revocation", async () => {
  const { sqlite, d1 } = databaseFixture();
  try {
    insertUser(sqlite, "user-a");
    sqlite.exec(`
      CREATE TRIGGER fail_session_created_audit
      BEFORE INSERT ON security_events
      WHEN NEW.event_type='session.created'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `);
    await assert.rejects(
      createEmailOtpSession(d1, {
        userId: "user-a",
        userAgent: "Mozilla/5.0 Windows Chrome/126.0",
        now: new Date("2026-07-26T13:00:00.000Z"),
      }),
      /forced audit failure/,
    );
    assert.equal(
      (
        sqlite.prepare("SELECT count(*) AS count FROM auth_sessions").get() as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (
        sqlite.prepare("SELECT count(*) AS count FROM auth_devices").get() as {
          count: number;
        }
      ).count,
      0,
    );
    assert.equal(
      (
        sqlite.prepare("SELECT count(*) AS count FROM security_events").get() as {
          count: number;
        }
      ).count,
      0,
    );

    sqlite.exec("DROP TRIGGER fail_session_created_audit");
    const created = await createEmailOtpSession(d1, {
      userId: "user-a",
      userAgent: "Mozilla/5.0 Windows Chrome/126.0",
      now: new Date("2026-07-26T13:01:00.000Z"),
    });
    sqlite.exec(`
      CREATE TRIGGER fail_session_revocation_audit
      BEFORE INSERT ON security_events
      WHEN NEW.event_type='session.revoked_all'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END;
    `);

    await assert.rejects(
      revokeSessions(d1, {
        userId: "user-a",
        currentSessionId: created.sessionId,
        scope: "all",
        now: new Date("2026-07-26T13:02:00.000Z"),
      }),
      /forced audit failure/,
    );
    assert.equal(sessionRow(sqlite, created.sessionId).revokedAt, null);
    assert.equal(deviceRow(sqlite, created.deviceId).revokedAt, null);
    assert.deepEqual(
      securityEventsFor(sqlite, "user-a")
        .map(({ eventType }) => eventType),
      ["session.created"],
    );
  } finally {
    sqlite.close();
  }
});
