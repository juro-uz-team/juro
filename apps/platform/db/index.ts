import { drizzle } from "drizzle-orm/node-postgres";
import { database } from "../lib/storage/connection";
import * as schema from "./schema";

export function getDb() {
  return drizzle(database().pool, { schema });
}
