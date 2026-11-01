import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { memoryKeyring, saveUserMemory } from "../lib/ai/user-memory";
import { handleSignedAnswerHttp } from "../lib/legal-answer-workflow/signed-http";

test("signed HTTP supplies encrypted manual memory to the fresh graph in both identity modes", async () => {
  const fixture = await legalAnswerStorageFixture();
  const previousMode = process.env.IDENTITY_PROTECTION_MODE;
  const keyring = memoryKeyring(JSON.stringify({ active: "fixture", versions: { fixture: {
    aead: Buffer.alloc(32, 5).toString("base64url"), hmac: Buffer.alloc(32, 6).toString("base64url"),
  } } }));
  try {
    const memory = await saveUserMemory({ db: fixture.d1, keyring, userId: "u", workspaceId: "w",
      category: "company", statement: "Artificial company context", scope: "workspace",
      sourceKind: "manual", sourceType: "manual" });
    for (const mode of ["legacy", "protected"]) {
      process.env.IDENTITY_PROTECTION_MODE = mode;
      let interpreted = false;
      const response = await handleSignedAnswerHttp(new Request("https://juro.example/api/platform/ai", {
        method: "POST", headers: { origin: "https://juro.example", "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ question: "Artificial rule question", locale: "en", operation: "new", idempotencyKey: `memory-${mode}` }),
      }), { publicOrigin: "https://juro.example", deadlineMs: 30_000,
        authenticate: async () => ({ db: fixture.d1, workspaceId: "w", userId: "u" }),
        dependencies: async () => ({ model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-29", sourceVersionHash: "fixture",
          memoryKeyring: keyring, privateObjects: { get: async () => null },
          createExecution: async ({ request }) => {
            assert.deepEqual(request.caseContext?.memories, [{ id: memory.id, category: "company",
              statement: "Artificial company context" }]);
            return { model: legalEntryFixture({ complete: async ({ stage, input }) => {
              if (stage === "interpret") {
                interpreted = true;
                assert.deepEqual((input as { caseContext: unknown }).caseContext, request.caseContext);
                return { needsClarification: false, complexity: "simple", requirements: [{ id: "r", question: "Artificial rule?" }], queries: ["artificial rule"],
                  scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
              }
              return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Unavailable official rule" }] };
            } }), corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
              resolve: async () => null, get: async () => null }, citations: async () => [], usage: () => fixture.input.usage };
          } }),
      });
      assert.equal(response.status, 200);
      const stream = await response.text();
      assert.equal(interpreted, true);
      assert.match(stream, /event: result/);
      assert.doesNotMatch(stream, /event: error/);
    }
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM ai_runs WHERE status='completed'").get()?.n, 2);
  } finally {
    if (previousMode === undefined) delete process.env.IDENTITY_PROTECTION_MODE; else process.env.IDENTITY_PROTECTION_MODE = previousMode;
    fixture.sqlite.close();
  }
});

