import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/*
 * The test database (keyworth_test in compose.yaml). Node-side test setups use
 * it as the schema owner; the Worker under test connects as keyworth_app, the
 * same restricted role it uses in production.
 */
const host = "localhost:5433/keyworth_test";
export const TEST_DATABASE_URL = `postgres://keyworth_app:keyworth_app@${host}`;
export const TEST_DATABASE_OWNER_URL = `postgres://keyworth_owner:keyworth_owner@${host}`;

const migrationsFolder = resolve(import.meta.dirname, "../../drizzle");

/** Applies every migration and empties all tables. */
export async function prepareTestDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_OWNER_URL });
  try {
    try {
      await pool.query("select 1");
    } catch (error) {
      throw new Error(
        "The local test database is not reachable. Start it with `npm run db:up`.",
        { cause: error },
      );
    }
    await migrate(drizzle(pool), { migrationsFolder });
    await pool.query(
      'TRUNCATE "user", allowed_emails, verification, rate_limit CASCADE',
    );
  } finally {
    await pool.end();
  }
}
