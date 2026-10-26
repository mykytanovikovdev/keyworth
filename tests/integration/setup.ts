import { beforeAll } from "vitest";
import { fetchWorker } from "./helpers.ts";

// Every test file runs in a fresh isolate, and its first request evaluates the
// Worker's modules (Better Auth, Drizzle): about 2 seconds here, more on a busy
// CI runner that starts several files at once. Paying that once per file, with
// a generous limit, keeps it out of the first test's 5-second timeout, which
// then measures only the test and still catches a real hang.
beforeAll(async () => {
  await fetchWorker("/api/health");
}, 30_000);
