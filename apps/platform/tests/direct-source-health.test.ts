import assert from "node:assert/strict";
import test from "node:test";

import { runDirectLegalSourceHealthCheck } from "../lib/legal/direct-source-health";

test("direct Lex health accepts only an HTTPS text response and records no source content", async () => {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          writes.push({ sql, values });
          return { run: async () => ({ results: [], success: true, meta: { changes: 1 } }) };
        },
      };
    },
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((statement) => statement.run())),
  } as unknown as D1Database;
  let request: RequestInit | undefined;
  const health = await runDirectLegalSourceHealthCheck({
    db,
    environment: "staging",
    now: () => new Date("2026-08-13T15:30:00.000Z"),
    fetchImpl: async (input, init) => {
      assert.equal(input, "https://lex.uz/uz/");
      assert.equal(init?.method, "HEAD", "Health checks must not download source content");
      request = init;
      return new Response(null, { headers: { "content-type": "text/html; charset=utf-8", "content-length": "231995" } });
    },
  });
  assert.equal(request?.redirect, "manual");
  assert.equal(health.state, "fresh");
  assert.equal(health.sources[0]?.status, "healthy");
  assert.equal(writes.length, 1);
  assert.match(writes[0]!.sql, /legal_source_health_checks/);
  assert.doesNotMatch(writes[0]!.sql, /legal_sources|content|embedding/i);
});

test("direct Lex health marks redirects unavailable rather than following them", async () => {
  const db = {
    prepare() { return { bind() { return { run: async () => ({ results: [], success: true, meta: { changes: 1 } }) }; } }; },
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((statement) => statement.run())),
  } as unknown as D1Database;
  const health = await runDirectLegalSourceHealthCheck({
    db,
    environment: "staging",
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.test/" } }),
  });
  assert.equal(health.state, "degraded");
  assert.equal(health.sources[0]?.status, "unavailable");
});
