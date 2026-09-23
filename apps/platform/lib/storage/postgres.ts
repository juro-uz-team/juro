import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { postgresSql } from "./sql";

/** Preserve retry identities without exposing PostgreSQL's bound-row error detail. */
function databaseError(error: unknown): Error {
  const detail = error as { code?: unknown; constraint?: unknown; message?: unknown };
  const code = typeof detail?.code === "string" ? detail.code : "DATABASE_ERROR";
  const constraint = typeof detail?.constraint === "string" ? detail.constraint : "database constraint";
  const prefix: Record<string, string> = { "23505": "UNIQUE constraint failed", "23503": "FOREIGN KEY constraint failed",
    "23514": "CHECK constraint failed", "23502": "NOT NULL constraint failed" };
  const message = prefix[code] ? `${prefix[code]}: ${constraint}`
    : code === "P0001" && typeof detail.message === "string" ? detail.message : `Database operation failed (${code})`;
  return Object.assign(new Error(message), { code, ...(detail?.constraint ? { constraint } : {}) });
}

export type SqlResult<T> = {
  success: true;
  results: T[];
  meta: { changes: number; duration: number; rows_read: number; rows_written: number };
};

/** Parameter values never enter SQL text. Quoted text and comments retain literal question marks. */
function bindParameters(source: string): string {
  let index = 0;
  let alias = false;
  const normalized = postgresSql(source);
  const identifiers = normalized.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  const aliases = new Set(Array.from(identifiers.matchAll(/\bAS\s+([A-Za-z_]\w*)/gi), match => match[1]).filter(name => /[A-Z]/.test(name)));
  return normalized.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][\w]*|\?|[^\s]/g, (token) => {
    if (token.startsWith("--") || token.startsWith("/*")) return token;
    const preserveAlias = alias && /^[A-Za-z_]\w*$/.test(token) && /[A-Z]/.test(token);
    alias = token.toUpperCase() === "AS";
    if (preserveAlias || aliases.has(token)) return `"${token}"`;
    if (token === "?") return `$${++index}`;
    if (token.startsWith("`")) return `"${token.slice(1, -1).replaceAll('"', '""')}"`;
    return token;
  });
}

export class PostgresStatement {
  constructor(readonly database: PostgresDatabase, readonly sql: string, readonly parameters: unknown[] = []) {}

  bind(...parameters: unknown[]): PostgresStatement {
    return new PostgresStatement(this.database, this.sql, parameters);
  }

  async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return this.database.execute<T>(this);
  }

  async run<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return this.all<T>();
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    if (!row) return null;
    if (column !== undefined) {
      if (!(column in row)) throw new Error(`Unknown result column: ${column}`);
      return row[column] as T;
    }
    return row as T;
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.database.pool.query({ text: bindParameters(this.sql), values: this.parameters, rowMode: "array" }).catch(error => { throw databaseError(error); });
    const rows = result.rows;
    return (options?.columnNames ? [result.fields.map(field => field.name), ...rows] : rows) as T[];
  }
}

export class PostgresDatabase {
  readonly pool: Pool;

  constructor(connectionString: string, schema = "public") {
    if (!connectionString) throw new Error("DATABASE_URL is required");
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid database schema");
    this.pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000, options: `-c search_path=${schema},public`,
      types: { getTypeParser(oid, format) {
        if (oid === 20 && format !== "binary") return (value: string) => {
          const number = Number(value);
          if (!Number.isSafeInteger(number)) throw new RangeError("Database integer exceeds safe application precision");
          return number;
        };
        return types.getTypeParser(oid, format);
      } },
      application_name: "juro" });
  }

  prepare(sql: string): PostgresStatement { return new PostgresStatement(this, sql); }

  async execute<T>(statement: PostgresStatement, client?: PoolClient): Promise<SqlResult<T>> {
    if (statement.database !== this) throw new Error("Statement belongs to another database");
    const started = performance.now();
    const result = await (client ?? this.pool).query<QueryResultRow>(bindParameters(statement.sql), statement.parameters).catch(error => { throw databaseError(error); });
    const changes = /^(INSERT|UPDATE|DELETE)$/.test(result.command) ? result.rowCount ?? 0 : 0;
    // The compatibility query API exposes SQL JSON expressions as serialized text,
    // matching the persisted text columns. Direct pgvector queries retain native JSON.
    const jsonFields = result.fields.filter(field => field.dataTypeID === 114 || field.dataTypeID === 3802);
    for (const row of result.rows) for (const field of jsonFields) {
      if (row[field.name] !== null) row[field.name] = JSON.stringify(row[field.name]);
    }
    return { success: true, results: result.rows as T[], meta: {
      changes, duration: performance.now() - started, rows_read: result.rows.length, rows_written: changes,
    } };
  }

  async batch<T = Record<string, unknown>>(statements: PostgresStatement[]): Promise<SqlResult<T>[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const results: SqlResult<T>[] = [];
      for (const statement of statements) results.push(await this.execute<T>(statement, client));
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** PostgreSQL reads use the same primary; there is no replica session token. */
  withSession() { return this; }
  async exec(sql: string) { await this.pool.query(sql); }
  async close() { await this.pool.end(); }
}
