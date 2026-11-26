import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { parseJsonRequest } from "../lib/auth/input";
import {
  acceptWorkspaceInvitation,
  workspaceInvitationAcceptInputSchema,
  workspaceInvitationRedirect,
} from "../lib/platform/workspace-invitation";

const originalPracticeEnabled = process.env.PRACTICE_ENABLED;
test.before(() => { process.env.PRACTICE_ENABLED = "false"; });
test.after(() => {
  if (originalPracticeEnabled === undefined) delete process.env.PRACTICE_ENABLED;
  else process.env.PRACTICE_ENABLED = originalPracticeEnabled;
});

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.database, this.sql, values);
  }

  first<T>(): T | null {
    return (this.database.prepare(this.sql).get(
      ...this.bindings(),
    ) as T | undefined) ?? null;
  }

  execute<T>(): {
    results: T[];
    success: true;
    meta: { changes: number };
  } {
    const statement = this.database.prepare(this.sql);
    if (/\bRETURNING\b/i.test(this.sql)) {
      const results = statement.all(...this.bindings()) as T[];
      const changes = Number((
        this.database.prepare("SELECT changes() AS value").get() as {
          value: number | bigint;
        }
      ).value);
      return { results, success: true, meta: { changes } };
    }
    const result = statement.run(...this.bindings());
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  private bindings(): Array<null | number | bigint | string> {
    return this.values as Array<null | number | bigint | string>;
  }
}

async function invitationDatabase(): Promise<{
  sqlite: DatabaseSync;
  d1: D1Database;
}> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE user_profiles (
      id TEXT PRIMARY KEY,
      account_type TEXT NOT NULL,
      default_workspace_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL
    );
    CREATE TABLE workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id,user_id)
    );
    CREATE TABLE workspace_invitations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      email_hash TEXT NOT NULL,
      email_lookup_hash TEXT,
      email_lookup_key_version TEXT,
      token_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workspace_audit_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const migration = await readFile(
    new URL(
      "../drizzle/0022_workspace_invitation_claim.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) sqlite.exec(statement);
  }
  const d1 = {
    prepare(sql: string) {
      return new SqliteD1Statement(sqlite, sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) =>
          (statement as unknown as SqliteD1Statement).execute()
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

function insertInvitation(
  sqlite: DatabaseSync,
  options: { existingRole?: string; invitationRole?: string } = {},
): void {
  sqlite.exec(`
    INSERT INTO user_profiles
      (id,account_type,default_workspace_id,updated_at)
    VALUES ('invitee-1','individual',NULL,'2026-07-28T00:00:00.000Z');
    INSERT INTO workspaces (id,type) VALUES ('workspace-1','business');
    INSERT INTO workspace_invitations (
      id,workspace_id,invited_by_user_id,email_hash,email_lookup_hash,
      email_lookup_key_version,token_hash,role,expires_at,accepted_at,
      revoked_at,created_at,updated_at
    ) VALUES (
      'invitation-1','workspace-1','owner-1','email-hash',NULL,NULL,
      'token-hash','${options.invitationRole ?? "viewer"}',
      '2999-01-01T00:00:00.000Z',NULL,NULL,
      '2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z'
    );
  `);
  if (options.existingRole) {
    sqlite.prepare(`
      INSERT INTO workspace_members (
        id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `).run(
      "existing-member-1",
      "workspace-1",
      "invitee-1",
      options.existingRole,
      "active",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
  }
}

const acceptanceInput = {
  invitationId: "invitation-1",
  tokenHash: "token-hash",
  expectedEmailHash: "email-hash",
  expectedEmailLookupHash: null,
  expectedEmailLookupKeyVersion: null,
  userId: "invitee-1",
  now: "2026-07-28T12:00:00.000Z",
};

test("workspace invitation input is strict and bounded to 4 KiB", async () => {
  const valid = await parseJsonRequest(
    new Request("https://app.juro.uz/api/platform/team/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "invite-token", locale: "uz" }),
    }),
    workspaceInvitationAcceptInputSchema,
    4_096,
  );
  assert.deepEqual(valid, {
    ok: true,
    data: { token: "invite-token", locale: "uz" },
  });

  const unknownKey = await parseJsonRequest(
    new Request("https://app.juro.uz/api/platform/team/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "invite-token", locale: "ru", admin: true }),
    }),
    workspaceInvitationAcceptInputSchema,
    4_096,
  );
  assert.deepEqual(unknownKey, { ok: false, error: "invalid_input" });

  const oversized = await parseJsonRequest(
    new Request("https://app.juro.uz/api/platform/team/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "x".repeat(4_096) }),
    }),
    workspaceInvitationAcceptInputSchema,
    4_096,
  );
  assert.deepEqual(oversized, { ok: false, error: "payload_too_large" });
});

test("concurrent acceptance has one winner and one durable grant", async () => {
  const { sqlite, d1 } = await invitationDatabase();
  try {
    insertInvitation(sqlite);
    const accepted = await Promise.all([
      acceptWorkspaceInvitation(d1, acceptanceInput),
      acceptWorkspaceInvitation(d1, acceptanceInput),
    ]);
    assert.deepEqual(accepted.sort(), [false, true]);

    const invitation = sqlite.prepare(`
      SELECT accepted_at AS acceptedAt,
        acceptance_claim_id AS acceptanceClaimId
      FROM workspace_invitations WHERE id='invitation-1'
    `).get() as { acceptedAt: string; acceptanceClaimId: string };
    assert.equal(invitation.acceptedAt, acceptanceInput.now);
    assert.match(invitation.acceptanceClaimId, /^[0-9a-f-]{36}$/i);

    const profile = sqlite.prepare(`
      SELECT account_type AS accountType,
        default_workspace_id AS defaultWorkspaceId
      FROM user_profiles WHERE id='invitee-1'
    `).get() as { accountType: string; defaultWorkspaceId: string };
    assert.deepEqual({ ...profile }, {
      accountType: "individual",
      defaultWorkspaceId: "workspace-1",
    });

    const membership = sqlite.prepare(`
      SELECT role,status FROM workspace_members
      WHERE workspace_id='workspace-1' AND user_id='invitee-1'
    `).get() as { role: string; status: string };
    assert.deepEqual({ ...membership }, { role: "viewer", status: "active" });
    assert.equal((sqlite.prepare(`
      SELECT count(*) AS total FROM workspace_audit_events
      WHERE action='invitation_accepted'
    `).get() as { total: number }).total, 1);
  } finally {
    sqlite.close();
  }
});

test("an existing workspace owner cannot claim an invitation for a different role", async () => {
  const { sqlite, d1 } = await invitationDatabase();
  try {
    insertInvitation(sqlite, { existingRole: "owner", invitationRole: "viewer" });
    assert.equal(
      await acceptWorkspaceInvitation(d1, acceptanceInput),
      false,
    );
    const membership = sqlite.prepare(`
      SELECT role,joined_at AS joinedAt FROM workspace_members
      WHERE workspace_id='workspace-1' AND user_id='invitee-1'
    `).get() as { role: string; joinedAt: string };
    assert.deepEqual({ ...membership }, {
      role: "owner",
      joinedAt: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(sqlite.prepare("SELECT accepted_at FROM workspace_invitations").get()?.accepted_at, null);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM workspace_audit_events WHERE action='invitation_accepted'").get()?.total, 0);
  } finally {
    sqlite.close();
  }
});

test("audit failure rolls back the claim, membership and workspace switch", async () => {
  const { sqlite, d1 } = await invitationDatabase();
  try {
    insertInvitation(sqlite);
    sqlite.exec(`
      CREATE TRIGGER reject_workspace_invitation_audit
      BEFORE INSERT ON workspace_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'audit unavailable');
      END;
    `);
    await assert.rejects(
      acceptWorkspaceInvitation(d1, acceptanceInput),
      /audit unavailable/,
    );
    const invitation = sqlite.prepare(`
      SELECT accepted_at AS acceptedAt,
        acceptance_claim_id AS acceptanceClaimId
      FROM workspace_invitations WHERE id='invitation-1'
    `).get() as {
      acceptedAt: string | null;
      acceptanceClaimId: string | null;
    };
    assert.deepEqual({ ...invitation }, {
      acceptedAt: null,
      acceptanceClaimId: null,
    });
    assert.equal((sqlite.prepare(`
      SELECT count(*) AS total FROM workspace_members
    `).get() as { total: number }).total, 0);
    assert.equal((sqlite.prepare(`
      SELECT default_workspace_id AS workspaceId FROM user_profiles
      WHERE id='invitee-1'
    `).get() as { workspaceId: string | null }).workspaceId, null);
  } finally {
    sqlite.close();
  }
});

test("claim guard rejects stale identity evidence and partial acceptance", async () => {
  const { sqlite, d1 } = await invitationDatabase();
  try {
    insertInvitation(sqlite);
    assert.equal(await acceptWorkspaceInvitation(d1, {
      ...acceptanceInput,
      expectedEmailHash: "stale-email-hash",
    }), false);
    assert.throws(
      () => sqlite.prepare(`
        UPDATE workspace_invitations SET accepted_at=? WHERE id=?
      `).run(acceptanceInput.now, acceptanceInput.invitationId),
      /acceptance evidence incomplete/,
    );
  } finally {
    sqlite.close();
  }
});

test("invite route and UI keep canonical trilingual states", async () => {
  assert.equal(workspaceInvitationRedirect("ru", "business", "ws_business_1"), "/ru/business/ws_business_1/dashboard");
  assert.equal(workspaceInvitationRedirect("uz", "business", "ws_business_1"), "/uz/business/ws_business_1/dashboard");
  assert.equal(workspaceInvitationRedirect("en", "business", "ws_business_1"), "/en/business/ws_business_1/dashboard");
  assert.equal(workspaceInvitationRedirect("uz", "individual", "ws_individual_1"), "/uz/individual/dashboard");

  const [route, page, client, invitationEmail] = await Promise.all([
    readFile(new URL(
      "../app/api/platform/team/invitations/accept/route.ts",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../app/invite/[token]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL(
      "../app/invite/[token]/InviteAcceptClient.tsx",
      import.meta.url,
    ), "utf8"),
    readFile(new URL("../app/api/platform/team/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /workspaceInvitationAcceptInputSchema/);
  assert.match(route, /parseJsonRequest\([\s\S]*4_096/);
  assert.doesNotMatch(route, /UPDATE user_profiles[\s\S]*account_type/);
  assert.match(page, /isLocale\(requestedLocale\)/);
  assert.match(client, /Ish makoniga qo‘shilish/);
  assert.match(client, /Присоединиться к рабочему пространству/);
  assert.match(client, /Join a workspace/);
  assert.match(client, /aria-live="polite"/);
  assert.match(invitationEmail, /\?lang=\$\{locale\}/);
  assert.match(invitationEmail, /Invitation to a JURO workspace/);
  assert.match(invitationEmail, /text/);
});
