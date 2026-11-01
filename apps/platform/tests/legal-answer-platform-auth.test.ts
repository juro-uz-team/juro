import assert from "node:assert/strict";
import test from "node:test";
import { authenticateSignedAnswer } from "../lib/legal-answer-workflow/platform-auth";
import { createEmailOtpSession, revokeOneSession } from "../lib/auth/session-management";
import { sessionCookie } from "../lib/auth/session-persistence";
import { env } from "./helpers/runtime-env";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";

test("native answer authentication uses the supplied Request session and rejects unauthorized workspace selection", async () => {
  const fixture = await legalAnswerStorageFixture();
  const previous = { DB: env.DB, IDENTITY_PROTECTION_MODE: env.IDENTITY_PROTECTION_MODE };
  Object.assign(env, { DB: fixture.d1, IDENTITY_PROTECTION_MODE: "legacy" });
  try {
    const workspaceId = "11111111-1111-4111-8111-111111111111", now = new Date().toISOString();
    fixture.sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES(?,'individual','Selected',?,?)")
      .run(workspaceId, now, now);
    fixture.sqlite.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES('selected-member',?,'u','owner','active',?,?,?)`).run(workspaceId, now, now, now);
    const session = await createEmailOtpSession(fixture.d1, { userId: "u", userAgent: "Artificial test browser" });
    const request = (workspace = workspaceId, cookie = sessionCookie(session.token)) => new Request("http://127.0.0.1/api/platform/ai", {
      headers: { cookie, "x-juro-workspace-id": workspace },
    });
    const signal = new AbortController().signal;
    assert.deepEqual(await authenticateSignedAnswer(request(), signal), { db: fixture.d1, workspaceId, userId: "u" });
    await assert.rejects(() => authenticateSignedAnswer(request(workspaceId, ""), signal));
    await assert.rejects(() => authenticateSignedAnswer(request("22222222-2222-4222-8222-222222222222"), signal), /WORKSPACE_ACCESS_DENIED/);
    await assert.rejects(() => authenticateSignedAnswer(request("malformed"), signal), /WORKSPACE_ACCESS_DENIED/);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='selected-member'").run();
    await assert.rejects(() => authenticateSignedAnswer(request(), signal), /WORKSPACE_ACCESS_DENIED/);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='active' WHERE id='selected-member'").run();
    await revokeOneSession(fixture.d1, { userId: "u", sessionId: session.sessionId, currentSessionId: session.sessionId });
    await assert.rejects(() => authenticateSignedAnswer(request(), signal));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
    fixture.sqlite.close();
  }
});
