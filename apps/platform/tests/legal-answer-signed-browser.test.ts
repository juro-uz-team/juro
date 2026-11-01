import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { handleSignedAnswerBrowser } from "../lib/legal-answer-workflow/signed-browser";

test("signed browser paginates tied timestamps, reopens saved answers and fences deletion", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer(fixture.input);
    const date = "2020-01-01T00:00:00.000Z";
    for (let index = 0; index < 23; index++) fixture.sqlite.prepare(`INSERT INTO conversations
      (id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at) VALUES(?,'w','u','Fixture','en','active',?,?)`)
      .run(`page-${String(index).padStart(2, "0")}`, date, date);
    const config: Parameters<typeof handleSignedAnswerBrowser>[1] = { publicOrigin: "https://juro.example",
      authenticate: async () => ({ db: fixture.d1, workspaceId: "w", userId: "u" }),
      settings: async () => ({ provider: { configured: true, provider: "openai", model: "gpt-6-luna", fallbackConfigured: false }, monthlyLimit: 20 }) };
    const get = (query = "") => handleSignedAnswerBrowser(new Request(`https://juro.example/api/platform/ai${query}`), config);
    const first = await (await get()).json();
    assert.equal(first.conversations.length, 20);
    assert.equal(first.provider.model, "gpt-6-luna");
    assert.equal(first.usage.used, 0);
    const second = await (await get(`?${new URLSearchParams(first.next)}`)).json();
    assert.equal(second.conversations.length, 4);
    assert.equal(second.next, null);
    assert.equal(new Set([...first.conversations, ...second.conversations].map(row => row.id)).size, 24);
    const reopened = await (await get(`?conversationId=${saved.conversationId}`)).json();
    assert.deepEqual(reopened.result, fixture.input.response);
    const run = await (await get(`?idempotencyKey=${fixture.input.idempotencyKey}`)).json();
    assert.equal(run.kind, "completed");
    assert.equal((await get("?before=2020-01-01T00%3A00%3A00.000Z")).status, 400);
    const remove = (origin: string) => handleSignedAnswerBrowser(new Request("https://juro.example/api/platform/ai", {
      method: "DELETE", headers: { origin, "x-juro-csrf": "1", "content-type": "application/json" },
      body: JSON.stringify({ conversationId: saved.conversationId }),
    }), config);
    assert.equal((await remove("https://foreign.example")).status, 403);
    assert.equal((await remove("https://juro.example")).status, 200);
    assert.equal((await get(`?conversationId=${saved.conversationId}`)).status, 404);
    fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
    assert.equal((await get()).status, 401);
  } finally { fixture.sqlite.close(); }
});
