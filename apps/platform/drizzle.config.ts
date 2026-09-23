import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./postgres-generated",
  schema: "./db/schema.ts",
  dialect: "postgresql",
});
