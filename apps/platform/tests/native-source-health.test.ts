import assert from "node:assert/strict";
import test from "node:test";
import { withPostgresRollback } from "./helpers/postgres-rollback";
import { runDirectLegalSourceHealthCheck } from "../lib/legal/direct-source-health";

test("native source health persists canonical HEAD evidence and preserves historical endpoints", async () => {
  await withPostgresRollback(async db => {
    const stamp = new Date().toISOString();
    const health = await runDirectLegalSourceHealthCheck({ db: db as unknown as D1Database, environment: "staging",
      now: () => new Date(stamp), fetchImpl: async (input, init) => {
        assert.equal(String(input), "https://lex.uz/uz/");
        assert.equal(init?.method, "HEAD");
        return new Response(null, { headers: { "content-type": "text/html", "content-length": "231995" } });
      },
    });
    assert.equal(health.state, "fresh");
    const insert = (url: string) => db.prepare(`INSERT INTO legal_source_health_checks
      (id,environment,source_kind,status,checked_at,latency_ms,endpoint_url,created_at)
      VALUES (?,'staging','lex','healthy',?,1,?,?)`).bind(crypto.randomUUID(),stamp,url,stamp);
    await db.batch([insert("https://lex.uz/robots.txt")]);
    await assert.rejects(db.batch([insert("https://example.invalid/")]), /constraint/i);
    const row = await db.prepare("SELECT endpoint_url AS endpoint FROM legal_source_health_checks WHERE checked_at=? AND endpoint_url=?")
      .bind(stamp,"https://lex.uz/uz/").first<{endpoint:string}>();
    assert.equal(row?.endpoint, "https://lex.uz/uz/");
  });
});
