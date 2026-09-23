import { PostgresDatabase } from "./postgres";

const state = globalThis as typeof globalThis & { juroDatabases?: Map<string, PostgresDatabase> };

export function database(schema = "app"): PostgresDatabase {
  const connections = state.juroDatabases ??= new Map();
  let connection = connections.get(schema);
  if (!connection) {
    connection = new PostgresDatabase(process.env.DATABASE_URL!, schema);
    connections.set(schema, connection);
  }
  return connection;
}
