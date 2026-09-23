import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../lib/storage/postgres";

test("a failed document write rolls back every statement in its batch", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  try {
    await db.prepare("CREATE TABLE IF NOT EXISTS storage_batch_probe (id text PRIMARY KEY, title text NOT NULL)").run();
    const id = crypto.randomUUID();
    await assert.rejects(db.batch([
      db.prepare("INSERT INTO storage_batch_probe(id,title) VALUES (?,?)").bind(id, "Original"),
      db.prepare("INSERT INTO storage_batch_probe(id,title) VALUES (?,?)").bind(id, "Duplicate"),
    ]));
    assert.equal(await db.prepare("SELECT title FROM storage_batch_probe WHERE id=?").bind(id).first(), null);
  } finally {
    await db.close();
  }
});

test("bound values and literal question marks survive without changing result field names", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  try {
    const value = "O'Brien ?; DROP TABLE ignored";
    const row = await db.prepare("SELECT ?::text AS displayName, '?' AS literalValue -- ? is a comment\n")
      .bind(value).first();
    assert.deepEqual(row, { displayName: value, literalValue: "?" });
  } finally {
    await db.close();
  }
});

test("ordered JSON projections preserve nested arrays, numeric values and camel-case aliases", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!, "app");
  try {
    const row = await db.prepare(`SELECT json_group_array(json_object('id',e.sourceId,'rank',e.rank,'nested',json('[1,2]'))) AS itemsJson
      FROM (SELECT 'second' AS sourceId,2 AS rank UNION ALL SELECT 'first' AS sourceId,1 AS rank ORDER BY rank) e`).first<{itemsJson:string}>();
    assert.deepEqual(JSON.parse(row!.itemsJson), [
      {id:"first",rank:1,nested:[1,2]}, {id:"second",rank:2,nested:[1,2]},
    ]);
    assert.equal(await db.prepare("SELECT date('2026-09-23T22:30:00Z','+5 hours') AS day").first("day"), "2026-09-24");
  } finally { await db.close(); }
});

test("repeated failed authentication accumulates PostgreSQL rate limits atomically", async () => {
  const { recordPasswordLoginFailure, passwordLoginRateLimit } = await import("../lib/auth/password");
  const { sha256 } = await import("../lib/auth/crypto");
  const db = new PostgresDatabase(process.env.DATABASE_URL!, "app");
  const email = `${crypto.randomUUID()}@example.test`;
  const key = await sha256(`password-login:email:${email}`);
  const input = {email,requestIp:null,now:new Date()};
  try {
    for (let attempt=0;attempt<3;attempt++) await recordPasswordLoginFailure(db as unknown as D1Database,input);
    assert.equal((await passwordLoginRateLimit(db as unknown as D1Database,input)).allowed,false);
    assert.equal(await db.prepare("SELECT failure_count FROM auth_password_rate_limits WHERE scope_key=?").bind(key).first("failure_count"),3);
  } finally {
    await db.prepare("DELETE FROM auth_password_rate_limits WHERE scope_key=?").bind(key).run();
    await db.close();
  }
});

test("provider accounting persists both attempts and accumulates their token totals", async () => {
  const {recordProviderUsage} = await import("../lib/ai/provider-usage");
  const db = new PostgresDatabase(process.env.DATABASE_URL!, "app");
  const model = `synthetic-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    for (let attempt=0;attempt<2;attempt++) await recordProviderUsage({db:db as unknown as D1Database,
      environment:"development",workspaceId:null,userId:null,feature:"test_accounting",operation:"generate",provider:"openai",
      model,inputTokens:10,outputTokens:2,status:"succeeded",startedAt:now,completedAt:now});
    assert.deepEqual(await db.prepare("SELECT request_count,input_tokens,output_tokens FROM ai_cost_daily_aggregates WHERE model=?").bind(model).first(),
      {request_count:2,input_tokens:20,output_tokens:4});
  } finally { await db.close(); }
});


test("case-insensitive directory ordering works for PostgreSQL projections", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  try {
    const rows = await db.prepare("SELECT title FROM (VALUES ('zebra'),('Alpha'),('beta')) AS names(title) ORDER BY title COLLATE NOCASE").all();
    assert.deepEqual(rows.results.map(row => row.title), ["Alpha","beta","zebra"]);
  } finally { await db.close(); }
});


test("unique conflicts retain retry identity without logging bound private values", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const id = crypto.randomUUID();
  try {
    await db.prepare("INSERT INTO storage_batch_probe(id,title) VALUES (?,?)").bind(id,"private synthetic value").run();
    await assert.rejects(db.prepare("INSERT INTO storage_batch_probe(id,title) VALUES (?,?)").bind(id,"other private value").run(), error => {
      assert.equal((error as {code:string}).code,"23505");
      assert.match((error as Error).message,/UNIQUE constraint failed/);
      assert.ok(!(error as Error).message.includes(id));
      assert.equal("detail" in (error as object),false);
      return true;
    });
  } finally {
    await db.prepare("DELETE FROM storage_batch_probe WHERE id=?").bind(id).run();
    await db.close();
  }
});
