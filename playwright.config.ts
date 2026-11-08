import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URL } from "./tests/support/database.ts";
import { testServerVars } from "./tests/support/session.ts";

// Set PLAYWRIGHT_BASE_URL to run the production checks against a deployed site
// (the post-deploy smoke test in CI). Otherwise local builds are used.
const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const isCI = Boolean(process.env.CI);

// Each build is served by `wrangler dev` from its own output config, so the two
// servers can run side by side (`vite preview` serves whichever build ran last).
const productionUrl = remoteBaseUrl ?? "http://localhost:4173";
const designUrl = "http://localhost:4174";

// Local servers run against the test database with fake secrets; signed-in
// tests create their sessions directly in that database (tests/support).
const testServerEnv = {
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: TEST_DATABASE_URL,
};

const desktopBrowsers = [
  ["chromium", devices["Desktop Chrome"]],
  ["firefox", devices["Desktop Firefox"]],
  ["webkit", devices["Desktop Safari"]],
] as const;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/support/e2e-setup.ts",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: productionUrl,
    trace: "retain-on-failure",
  },
  projects: [
    // The production build. HTTP-level checks need no browser.
    { name: "headers", testMatch: "headers.spec.ts" },
    // Signed-in flows need the local test database, so they never run
    // against a deployed site.
    ...desktopBrowsers.map(([name, device]) => ({
      name,
      testMatch: remoteBaseUrl
        ? "app.spec.ts"
        : [
            "app.spec.ts",
            "auth.spec.ts",
            "encryption.spec.ts",
            "transactions.spec.ts",
          ],
      // Text and routing, which no engine renders differently enough to matter:
      // see tests/e2e/docs/csp-and-engines.md.
      ...(name === "chromium" ? {} : { grepInvert: /@chromium-only/ }),
      use: { ...device },
    })),
    // The design-mode build: every src/ui component on /design.
    ...(remoteBaseUrl
      ? []
      : [
          ...desktopBrowsers.map(([name, device]) => ({
            name: `design-${name}`,
            testMatch: "design-system.spec.ts",
            grepInvert: /@ios/,
            use: { ...device, baseURL: designUrl },
          })),
          {
            name: "design-iphone",
            testMatch: "design-system.spec.ts",
            grep: /@ios/,
            use: { ...devices["iPhone 15"], baseURL: designUrl },
          },
        ]),
  ],
  // Production headers and CSP apply only to built output served by workerd
  // (there is no CSP in `vite dev`).
  ...(remoteBaseUrl
    ? {}
    : {
        webServer: [
          {
            command: `npm run build && npm run preview -- ${testServerVars(productionUrl)}`,
            env: testServerEnv,
            url: `${productionUrl}/api/health`,
            reuseExistingServer: !isCI,
            timeout: 120_000,
          },
          {
            command: `npm run build:design && npm run preview:design -- ${testServerVars(designUrl)}`,
            env: testServerEnv,
            url: `${designUrl}/api/health`,
            reuseExistingServer: !isCI,
            timeout: 120_000,
          },
        ],
      }),
});
