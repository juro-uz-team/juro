import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { answerAllowanceAvailable } from "../lib/legal-answer-workflow/answer-allowance";
import { handleSignedAnswerHttp } from "../lib/legal-answer-workflow/signed-http";

test("early allowance admission preserves replay and enforces server ceilings without reserving a run", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const actor = { db: fixture.d1, workspaceId: "w", userId: "u" };
    const input = { ...actor, idempotencyKey: "new-question", monthlyLimit: 1, signal: new AbortController().signal };
    const count = () => fixture.sqlite.prepare("SELECT count(*) AS n FROM ai_runs").get()?.n;
    const before = count();
    assert.equal(await answerAllowanceAvailable(input), false);
    assert.equal(await answerAllowanceAvailable({ ...input, idempotencyKey: fixture.input.idempotencyKey }), true);
    assert.equal(await answerAllowanceAvailable({ ...input, monthlyLimit: null }), true);
    fixture.sqlite.prepare("INSERT INTO control_settings(key,value) VALUES('ai.max_monthly_cycles','1')").run();
    assert.equal(await answerAllowanceAvailable({ ...input, monthlyLimit: null }), false);
    assert.equal(await answerAllowanceAvailable({ ...input, monthlyLimit: 20 }), false);
    let dependencyCalls = 0;
    const response = await handleSignedAnswerHttp(new Request("https://juro.example/api/platform/ai", {
      method: "POST", headers: { origin: "https://juro.example", "x-juro-csrf": "1", "content-type": "application/json" },
      body: JSON.stringify({ question: "Artificial question", locale: "en", answerMode: "detailed", reasoningMode: "fast",
        idempotencyKey: input.idempotencyKey, operation: "new" }),
    }), { publicOrigin: "https://juro.example", deadlineMs: 30_000, authenticate: async () => actor,
      admit: async (_actor, request, signal) => await answerAllowanceAvailable({ ...input, idempotencyKey: request.idempotencyKey, signal })
        ? null : Response.json({ code: "PLAN_LIMIT" }, { status: 429 }),
      dependencies: async () => { dependencyCalls++; throw new Error("Corpus startup must not occur"); },
    });
    assert.equal(response.status, 429);
    assert.equal(dependencyCalls, 0);
    assert.equal(count(), before);
  } finally { fixture.sqlite.close(); }
});
