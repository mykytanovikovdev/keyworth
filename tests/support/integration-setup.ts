import { prepareTestDatabase } from "./database.ts";

// Runs once in Node before the Worker tests: a migrated, empty test database.
export default async function setup() {
  await prepareTestDatabase();
}
