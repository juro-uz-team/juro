import { DatabaseSync } from "node:sqlite";

class SqliteD1Statement {
  constructor(private readonly database: DatabaseSync, private readonly sql: string, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new SqliteD1Statement(this.database, this.sql, values); }
  first<T>(): T | null { return (this.database.prepare(this.sql).get(...this.bindings()) as T | undefined) ?? null; }
  run() { return this.execute(); }
  execute() {
    const result = this.database.prepare(this.sql).run(...this.bindings());
    return { results: [], success: true as const, meta: { changes: Number(result.changes) } };
  }
  private bindings() { return this.values as Array<null | number | bigint | string>; }
}

export function aiDatabase(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY,scope TEXT NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL,result_ref TEXT,expires_at TEXT NOT NULL,completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE conversations (id TEXT PRIMARY KEY);
    CREATE TABLE conversation_messages (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,structured_json TEXT);
    CREATE TABLE message_branches (id TEXT PRIMARY KEY,response_message_id TEXT NOT NULL,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL);
    CREATE TABLE ai_runs (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT,request_message_id TEXT,response_message_id TEXT,idempotency_key TEXT NOT NULL,correlation_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,provider_response_id TEXT,fallback_from_provider TEXT,answer_mode TEXT NOT NULL,reasoning_mode TEXT NOT NULL,status TEXT NOT NULL,legal_database_as_of TEXT NOT NULL,instruction_hash TEXT NOT NULL,source_version_hash TEXT NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cached_input_tokens INTEGER NOT NULL,estimated_cost_microusd INTEGER,attempt_count INTEGER NOT NULL,latency_ms INTEGER,error_code TEXT,started_at TEXT NOT NULL,completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(workspace_id,user_id,idempotency_key));
    CREATE TABLE ai_usage_ledger (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,ai_run_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,feature TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,units INTEGER NOT NULL,status TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cached_input_tokens INTEGER NOT NULL,estimated_cost_microusd INTEGER,released_at TEXT,consumed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(ai_run_id),UNIQUE(workspace_id,user_id,idempotency_key));
  `);
  const d1 = {
    prepare(sql: string) { return new SqliteD1Statement(sqlite, sql); },
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => (statement as unknown as SqliteD1Statement).execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { sqlite, d1 };
}
