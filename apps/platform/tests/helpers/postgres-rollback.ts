import { PostgresDatabase, type PostgresStatement, type SqlResult } from "../../lib/storage/postgres";

/** Run real prepared statements and batches on one rollback-only test connection. */
export async function withPostgresRollback<T>(operation: (db: PostgresDatabase) => Promise<T>): Promise<T> {
  const db = new PostgresDatabase(process.env.DATABASE_URL!, "app");
  const client = await db.pool.connect();
  const execute = db.execute.bind(db);
  let ordinal = 0;
  db.execute = (statement, _client, state) => execute(statement, client, state);
  db.batch = async <R>(statements: PostgresStatement[]): Promise<SqlResult<R>[]> => {
    const savepoint = `test_batch_${++ordinal}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const state = { changes: 0 };
      const results: SqlResult<R>[] = [];
      for (const statement of statements) results.push(await db.execute<R>(statement, client, state));
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return results;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  };
  try {
    await client.query("BEGIN");
    return await operation(db);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await db.close();
  }
}
