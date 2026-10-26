import { defineConfig } from "drizzle-kit";

// Migrations run as the schema owner. DATABASE_URL is set in CI (Neon); without
// it, commands target the local Postgres from compose.yaml, never production.
export default defineConfig({
  dialect: "postgresql",
  schema: "./worker/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://keyworth_owner:keyworth_owner@localhost:5433/keyworth",
  },
  strict: true,
  verbose: true,
});
