import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Captures the design prototype for review; not part of the test suite.
// `npm run design:screenshots` and `npm run design:videos` write to design/screenshots/.
const port = 5180;

export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.ts",
  outputDir: resolve(import.meta.dirname, "../../test-results/design"),
  reporter: "list",
  fullyParallel: true,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${String(port)}`,
  },
  projects: [
    // Reduced motion renders every scene in its final state.
    {
      name: "screenshots",
      grepInvert: /@video/,
      use: { reducedMotion: "reduce" },
    },
    {
      name: "videos",
      grep: /@video/,
      use: {
        video: { mode: "on", size: { width: 1440, height: 900 } },
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${String(port)} --strictPort`,
    cwd: resolve(import.meta.dirname, "../.."),
    url: `http://localhost:${String(port)}/design/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
