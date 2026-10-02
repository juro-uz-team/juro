import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type SqliteBinding = null | number | bigint | string;

class SqliteStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.database, this.sql, values);
  }

  private bindings(): SqliteBinding[] {
    return this.values.map((value) => {
      if (
        value === null
        || typeof value === "number"
        || typeof value === "bigint"
        || typeof value === "string"
      ) return value;
      throw new TypeError("Unsupported test binding.");
    });
  }

  execute<T>() {
    const statement = this.database.prepare(this.sql);
    if (
      /^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(this.sql)
      || /\bRETURNING\b/i.test(this.sql)
    ) {
      const results = statement.all(...this.bindings()) as T[];
      const changes = Number((
        this.database.prepare("SELECT changes() AS value").get() as {
          value: number | bigint;
        }
      ).value);
      return {
        results,
        success: true as const,
        meta: { changes },
      };
    }
    const result = statement.run(...this.bindings());
    return {
      results: [] as T[],
      success: true as const,
      meta: { changes: Number(result.changes) },
    };
  }

  async first<T>(): Promise<T | null> {
    return (
      this.database.prepare(this.sql).get(...this.bindings()) as T | undefined
    ) ?? null;
  }

  async all<T>() {
    return this.execute<T>();
  }

  async run<T>() {
    return this.execute<T>();
  }
}

const drizzleRoot = new URL("../../drizzle/", import.meta.url);
const journal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", drizzleRoot), "utf8"),
) as { entries: Array<{ idx: number; tag: string }> };

function statements(sql: string): string[] {
  return sql.split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function projectControlCenter(sqlite: DatabaseSync): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS control_account_blocks(user_id TEXT PRIMARY KEY,reason TEXT,actor_email TEXT);
    CREATE TABLE IF NOT EXISTS control_settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE IF NOT EXISTS control_ai_versions(id TEXT PRIMARY KEY,version INTEGER,settings TEXT,system_instructions TEXT,created_at TEXT,applied_at TEXT);
    CREATE TABLE IF NOT EXISTS control_professional_documents(id TEXT PRIMARY KEY,profile_id TEXT,object_key TEXT);`);
  for (const table of ["lawyer_profile_moderation", "lawyer_profile_lifecycle_events", "support_messages"]) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.length && !columns.some(column => column.name === "admin_session_id"))
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN admin_session_id TEXT`);
  }
}

function createSqliteD1Fixture(lastMigrationIndex = Number.POSITIVE_INFINITY, localDocumentConversion = false): {
  sqlite: DatabaseSync;
  d1: D1Database;
} {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const entry of journal.entries.filter(({ idx }) => idx <= lastMigrationIndex)) {
    let sql = readFileSync(
      new URL(`${entry.tag}.sql`, drizzleRoot),
      "utf8",
    );
    // Project the current PostgreSQL constraint into this legacy unit fixture.
    // Historical migration files and migration-history fixtures stay immutable.
    if (localDocumentConversion && entry.tag === "0042_sleepy_callisto") {
      const historical = `CHECK("file_extractions"."method" = 'workers_ai_markdown')`;
      if (!sql.includes(historical)) throw new Error("OCR fixture constraint not found");
      sql = sql.replace(historical, `CHECK("file_extractions"."method" IN ('workers_ai_markdown', 'local_document_conversion'))`);
    }
    for (const statement of statements(sql)) sqlite.exec(statement);
  }
  // Historical migrations remain immutable; current fixtures include native additions.
  if (lastMigrationIndex === Number.POSITIVE_INFINITY) projectControlCenter(sqlite);
  const d1 = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(batchStatements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = batchStatements.map((statement) =>
          (statement as unknown as SqliteStatement).execute()
        );
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

export function sqliteD1FixtureFromDirectory(root: URL): {
  sqlite: DatabaseSync;
  d1: D1Database;
} {
  const migrationFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migrationFile of migrationFiles) {
    const sql = readFileSync(new URL(migrationFile, root), "utf8");
    for (const statement of statements(sql)) sqlite.exec(statement);
  }
  projectControlCenter(sqlite);
  const d1 = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(batchStatements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = batchStatements.map((statement) =>
          (statement as unknown as SqliteStatement).execute()
        );
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

export function sqliteD1Fixture(): {
  sqlite: DatabaseSync;
  d1: D1Database;
} {
  return createSqliteD1Fixture();
}

export function batchBarrier(
  db: D1Database,
  participants = 2,
): D1Database {
  let arrived = 0;
  let release: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    prepare: db.prepare.bind(db),
    async batch(batchStatements: D1PreparedStatement[]) {
      arrived += 1;
      if (arrived >= participants) release?.();
      else await ready;
      return db.batch(batchStatements);
    },
  } as unknown as D1Database;
}

export function localDocumentConversionFixture() {
  return createSqliteD1Fixture(Number.POSITIVE_INFINITY, true);
}
