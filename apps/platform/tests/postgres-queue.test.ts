import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../lib/storage/postgres";
import { PostgresQueue } from "../lib/storage/queue";

test("a crashed consumer can be replaced without allowing its stale acknowledgement to delete the job", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const queue = new PostgresQueue(db.pool, `test-${crypto.randomUUID()}`);
  try {
    await queue.send({ task: "analyze" });
    const first = await queue.claim({ leaseMilliseconds: 1 });
    assert.ok(first);
    await new Promise(resolve => setTimeout(resolve, 10));
    const replacement = await queue.claim({ leaseMilliseconds: 60_000 });
    assert.ok(replacement);
    assert.deepEqual(replacement.body, { task: "analyze" });
    assert.equal(replacement.attempts, 2);
    assert.equal(await queue.acknowledge(first), false);
    assert.equal(await queue.acknowledge(replacement), true);
    assert.equal(await queue.claim(), null);
  } finally {
    await db.pool.query("DELETE FROM storage.queue_messages WHERE queue=$1", [queue.name]);
    await db.close();
  }
});
