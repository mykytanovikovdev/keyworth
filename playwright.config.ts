import { defineConfig, devices } from "@playwright/test";

// Set PLAYWRIGHT_BASE_URL to run the production checks against a deployed site
// (the post-deploy smoke test in CI). Otherwise local builds are used.
const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const isCI = Boolean(process.env.CI);

// Each build is served by `wrangler dev` from its own output config, so the two
// servers can run side by side (`vite preview` serves whichever build ran last).
const productionUrl = remoteBaseUrl ?? "http://localhost:4173";
const designUrl = "http://localhost:4174";

const desktopBrowsers = [
  ["chromium", devices["Desktop Chrome"]],
  ["firefox", devices["Desktop Firefox"]],
  ["webkit", devices["Desktop Safari"]],
] as const;

export default defineConfig({
  testDir: "tests/e2e",
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
    ...desktopBrowsers.map(([name, device]) => ({
      name,
      testMatch: "app.spec.ts",
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
            command: "npm run build && npm run preview",
            url: `${productionUrl}/api/health`,
            reuseExistingServer: !isCI,
            timeout: 120_000,
          },
          {
            command: "npm run build:design && npm run preview:design",
            url: `${designUrl}/api/health`,
            reuseExistingServer: !isCI,
            timeout: 120_000,
          },
        ],
      }),
});
