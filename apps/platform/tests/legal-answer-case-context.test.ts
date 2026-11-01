import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { parseIdentityKeyring } from "../lib/auth/keyring";
import { saveUserMemory, deleteUserMemory } from "../lib/ai/user-memory";
import { loadCaseContext } from "../lib/legal-answer-workflow/case-context";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { executeSignedInAnswer } from "../lib/legal-answer-workflow/signed-request";

test("case context isolates saved memory and prevents publication after a used fact or memory changes", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const keyring = parseIdentityKeyring(JSON.stringify({ active: "v1", versions: {
      v1: { aead: Buffer.alloc(32, 5).toString("base64url"), hmac: Buffer.alloc(32, 6).toString("base64url") },
    } }));
    const root = await persistSignedInAnswer(fixture.input), now = new Date().toISOString();
    const factId = randomUUID(), proposedId = randomUUID();
    const additionalFacts = Array.from({ length: 40 }, (_, index) => ({ id: `long-fact-${index}`,
      statement: `Confirmed circumstance ${index}: ${"full user context ".repeat(110)}` }));
    fixture.sqlite.prepare(`INSERT INTO confirmed_facts(id,conversation_id,statement,status,created_at,updated_at)
      VALUES(?,?,'Artificial confirmed date','confirmed',?,?),(?,?,'Unconfirmed assertion','proposed',?,?)`)
      .run(factId, root.conversationId, now, now, proposedId, root.conversationId, now, now);
    const actor = { db: fixture.d1, userId: "u", workspaceId: "w", keyring };
    const saved = await saveUserMemory({ ...actor, category: "company", statement: "Artificial company context",
      scope: "workspace", sourceKind: "manual", sourceType: "manual" });
    fixture.sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES('other','other@example.test',?,?)").run(now, now);
    fixture.sqlite.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES('other-member','w','other','member','active',?,?,?)`).run(now, now, now);
    await saveUserMemory({ ...actor, userId: "other", category: "company", statement: "Foreign private company",
      scope: "global", sourceKind: "manual", sourceType: "manual" });
    fixture.sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES('other-workspace','individual','Other fixture',?,?)")
      .run(now, now);
    fixture.sqlite.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES('other-workspace-member','other-workspace','u','owner','active',?,?,?)`).run(now, now, now);
    await saveUserMemory({ ...actor, workspaceId: "other-workspace", category: "company", statement: "Other workspace company",
      scope: "workspace", sourceKind: "manual", sourceType: "manual" });
    const input = { ...actor, conversationId: root.conversationId, signal: new AbortController().signal };
    for (const fact of additionalFacts) fixture.sqlite.prepare(`INSERT INTO confirmed_facts
      (id,conversation_id,statement,status,created_at,updated_at) VALUES(?,?,?,'confirmed',?,?)`)
      .run(fact.id, root.conversationId, fact.statement, now, now);
    const expanded = await loadCaseContext(input);
    assert.ok(expanded.context.facts.reduce((sum, fact) => sum + fact.statement.length, 0) > 64_000);
    for (const fact of additionalFacts) assert.equal(expanded.context.facts.find(item => item.id === fact.id)?.statement, fact.statement);
    for (const fact of additionalFacts) fixture.sqlite.prepare("DELETE FROM confirmed_facts WHERE id=?").run(fact.id);
    const loaded = await loadCaseContext(input);
    assert.deepEqual(loaded.context.facts, [{ id: factId, statement: "Artificial confirmed date", status: "confirmed" }]);
    assert.deepEqual(loaded.context.memories, [{ id: saved.id, category: "company", statement: "Artificial company context" }]);
    await assert.rejects(() => loadCaseContext({ ...input, userId: "other" }), /CASE_CONTEXT_ACCESS_DENIED/);
    for (const change of ["memory", "fact"] as const) {
      await assert.rejects(() => executeSignedInAnswer({ ...input, question: "Artificial context follow-up", language: "en",
        format: "short", mode: "fast", documentIds: [], idempotencyKey: `context-${change}`,
        submittedAt: Date.now(), deadlineMs: 30_000,
        branch: { operation: "follow_up", responseMessageId: root.responseMessageId } }, {
        model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-29", sourceVersionHash: "fixture",
        memoryKeyring: keyring, privateObjects: { get: async () => null },
        createExecution: async () => ({
          model: legalEntryFixture({ complete: async ({ stage, input: modelInput }) => {
            if (stage === "interpret") {
              assert.deepEqual((modelInput as {caseContext: unknown}).caseContext, loaded.context);
              return { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Artificial rule?" }], queries: ["artificial rule"],
                scopes: [{ kind: "current" }], facts: ["Artificial confirmed date"], clarificationQuestions: [] };
            }
            if (change === "memory") await deleteUserMemory({ ...actor, memoryId: saved.id });
            else fixture.sqlite.prepare("UPDATE confirmed_facts SET status='rejected' WHERE id=?").run(factId);
            return { support: [], selectedIds: [], gaps: [{ requirementId: "r", description: "Rule unavailable." }], recovery: [] };
          } }),
          corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }), resolve: async () => null, get: async () => null },
          citations: async () => [], usage: () => fixture.input.usage,
        }),
      }));
      assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 2);
      if (change === "memory") fixture.sqlite.prepare("UPDATE user_memories SET status='active',deleted_at=NULL WHERE id=?").run(saved.id);
    }
    assert.deepEqual((await loadCaseContext(input)).context.facts, [{ id: factId, statement: "Artificial confirmed date", status: "rejected" }]);
  } finally { fixture.sqlite.close(); }
});
