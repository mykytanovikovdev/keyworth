import { prepareTestDatabase } from "./database.ts";

// Playwright global setup: a migrated, empty test database for the local
// servers. Skipped for smoke tests against a deployed site.
export default async function setup() {
  if (process.env.PLAYWRIGHT_BASE_URL) return;
  await prepareTestDatabase();
}
