// Loaded only by Better Auth's CLI (`npx auth generate`) to learn which tables
// the configuration needs. It never connects to a database.
import { drizzle } from "drizzle-orm/node-postgres";
import { createAuth } from "../auth.ts";

export const auth = createAuth(drizzle.mock(), {
  BETTER_AUTH_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "schema-generation-only-not-a-secret",
  GOOGLE_CLIENT_ID: "unused",
  GOOGLE_CLIENT_SECRET: "unused",
});
