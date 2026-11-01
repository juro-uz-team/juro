import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";

test("a deadline reached while waiting for a database batch rolls back the complete publication", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const batch = fixture.d1.batch.bind(fixture.d1);
    fixture.d1.batch = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 90));
      return batch(...args);
    };
    await assert.rejects(() => persistSignedInAnswer({ ...fixture.input,
      deadlineMs: Date.now() - fixture.input.submittedAt + 50 }));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM conversations").get()?.count, 0);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM ai_runs WHERE id=?").get(fixture.input.runId)?.status, "reserved");
  } finally { fixture.sqlite.close(); }
});

test("a reserved run from before this request cannot be adopted for publication", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    fixture.sqlite.prepare("UPDATE ai_runs SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(fixture.input.runId);
    await assert.rejects(() => persistSignedInAnswer(fixture.input));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS count FROM conversations").get()?.count, 0);
  } finally { fixture.sqlite.close(); }
});
