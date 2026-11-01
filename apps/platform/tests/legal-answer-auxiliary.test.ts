import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { updateLegalFact, LegalFactUnavailable } from "../lib/legal-answer-workflow/facts";
import { handleQuestionIntakeHttp } from "../lib/legal-answer-workflow/intake-http";
import { parseIdentityKeyring } from "../lib/auth/keyring";

test("saved facts require active ownership and preserve confirmation provenance", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer(fixture.input), factId = randomUUID(), now = new Date().toISOString();
    fixture.sqlite.prepare(`INSERT INTO confirmed_facts(id,conversation_id,statement,status,created_at,updated_at)
      VALUES(?,?,'Artificial fact','proposed',?,?)`).run(factId, saved.conversationId, now, now);
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", factId, status: "confirmed" as const };
    await assert.rejects(() => updateLegalFact({ ...input, userId: "foreign" }), LegalFactUnavailable);
    assert.deepEqual(await updateLegalFact(input), { factId, status: "confirmed" });
    const read = () => fixture.sqlite.prepare("SELECT status,confirmed_by_user_id,confirmed_at FROM confirmed_facts WHERE id=?").get(factId);
    assert.equal(read()?.confirmed_by_user_id, "u");
    assert.ok(read()?.confirmed_at);
    await updateLegalFact({ ...input, status: "rejected" });
    assert.equal(read()?.confirmed_by_user_id, null);
    assert.equal(read()?.confirmed_at, null);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
    await assert.rejects(() => updateLegalFact(input), LegalFactUnavailable);
    assert.equal(read()?.status, "rejected");
  } finally { fixture.sqlite.close(); }
});

test("question intake preserves the workspace-bound draft through open and explicit finalization", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const workspaceId = "workspace-intake", now = new Date().toISOString();
    fixture.sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES(?,'individual','Intake fixture',?,?)")
      .run(workspaceId, now, now);
    fixture.sqlite.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES('intake-member',?,'u','owner','active',?,?,?)`).run(workspaceId, now, now, now);
    const keyring = parseIdentityKeyring(JSON.stringify({ active: "v1", versions: {
      v1: { aead: Buffer.alloc(32, 3).toString("base64url"), hmac: Buffer.alloc(32, 4).toString("base64url") },
    } }));
    let authenticated = 0;
    const configuration = { keyring: () => keyring, authenticate: async (request: Request) => {
      authenticated++;
      assert.equal(request.headers.get("x-juro-workspace-id"), workspaceId);
      return { db: fixture.d1, workspaceId, userId: "u" };
    } };
    const request = (payload: unknown, additional: Record<string, string> = {}) => new Request("https://juro.example/api/platform/ai/intake", {
      method: "POST", headers: { origin: "https://juro.example", "x-juro-csrf": "1", "content-type": "application/json", ...additional },
      body: JSON.stringify(payload),
    });
    const created = await handleQuestionIntakeHttp(request({ workspaceId, question: "Artificial private draft" }), "create", configuration);
    assert.equal(created.status, 200);
    assert.equal(created.headers.get("referrer-policy"), "no-referrer");
    assert.equal(created.headers.get("cache-control"), "private, no-store");
    const { handle } = await created.json();
    const denied = { ...configuration, authenticate: async () => { throw new Error("WORKSPACE_ACCESS_DENIED"); } };
    assert.equal((await handleQuestionIntakeHttp(request({ workspaceId, handle }), "consume", denied)).status, 404);
    assert.equal((await handleQuestionIntakeHttp(request({ workspaceId, question: "Draft" }), "create", denied)).status, 403);
    const opened = await handleQuestionIntakeHttp(request({ workspaceId, handle }), "consume", configuration);
    assert.deepEqual(await opened.json(), { question: "Artificial private draft" });
    const before = authenticated;
    const mismatch = await handleQuestionIntakeHttp(request({ workspaceId, handle }, { "x-juro-workspace-id": "foreign-workspace" }), "consume", configuration);
    assert.equal(mismatch.status, 403); assert.equal(authenticated, before);
    assert.equal((await handleQuestionIntakeHttp(request({ workspaceId, handle }, { origin: "https://foreign.example" }), "consume", configuration)).status, 403);
    assert.equal((await handleQuestionIntakeHttp(request({ workspaceId, handle }), "finalize", configuration)).status, 200);
    assert.equal((await handleQuestionIntakeHttp(request({ workspaceId, handle }), "consume", configuration)).status, 404);
  } finally { fixture.sqlite.close(); }
});
