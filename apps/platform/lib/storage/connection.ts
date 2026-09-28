import { PostgresDatabase } from "./postgres";

const state = globalThis as typeof globalThis & { juroDatabases?: Map<string, PostgresDatabase>; juroCorpusDatabases?: Map<string, PostgresDatabase> };

export function database(schema = "app"): PostgresDatabase {
  const connections = state.juroDatabases ??= new Map();
  let connection = connections.get(schema);
  if (!connection) {
    connection = new PostgresDatabase(process.env.DATABASE_URL!, schema);
    connections.set(schema, connection);
  }
  return connection;
}

/** Shared public corpus connections never carry environment-specific private records or writes. */
export function corpusDatabase(schema = "app"): PostgresDatabase {
  const uri = process.env.CORPUS_DATABASE_URL;
  if (!uri) return database(schema);
  const connections = state.juroCorpusDatabases ??= new Map();
  let connection = connections.get(schema);
  if (!connection) {
    connection = new PostgresDatabase(uri, schema, true);
    connections.set(schema, connection);
  }
  return connection;
}

export async function closeRuntimeDatabases() {
  const connections = [...(state.juroDatabases?.values() ?? []), ...(state.juroCorpusDatabases?.values() ?? [])];
  state.juroDatabases?.clear(); state.juroCorpusDatabases?.clear();
  await Promise.all(connections.map(connection => connection.close()));
}
