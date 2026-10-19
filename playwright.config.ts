import { defineConfig, devices } from "@playwright/test";

// Set PLAYWRIGHT_BASE_URL to run the same suite against a deployed site
// (the post-deploy smoke test in CI). Otherwise a local production build is used.
const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const localPort = 4173;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: remoteBaseUrl ?? `http://localhost:${String(localPort)}`,
    trace: "retain-on-failure",
  },
  projects: [
    // HTTP-level checks: no browser needed.
    { name: "headers", testMatch: "headers.spec.ts" },
    {
      name: "chromium",
      testMatch: "app.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testMatch: "app.spec.ts",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testMatch: "app.spec.ts",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  // The production build served by workerd: the only place where the real
  // headers and CSP apply (there is no CSP in `vite dev`).
  ...(remoteBaseUrl
    ? {}
    : {
        webServer: {
          command: `npm run build && npm run preview -- --port ${String(localPort)} --strictPort`,
          url: `http://localhost:${String(localPort)}`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      }),
});
