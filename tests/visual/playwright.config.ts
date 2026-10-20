import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { testServerVars } from "../support/session.ts";

// Screenshot comparison of /design. Baselines are rendered by Chromium inside
// the official Playwright Linux image, so they match pixel for pixel on any
// machine: in CI the whole job runs in that image; locally `npm run test:visual`
// starts the image and connects to its browser (scripts/visual.ts).

const isCI = Boolean(process.env.CI);
const root = resolve(import.meta.dirname, "../..");
const url = "http://localhost:4174";
// Set by scripts/visual.ts: the browser runs in Docker, the tests and the
// server run here. `<loopback>` lets that browser reach this machine's localhost.
const wsEndpoint = process.env.PW_BROWSER_WS_ENDPOINT;

export default defineConfig({
  testDir: ".",
  outputDir: resolve(root, "test-results/visual"),
  // One baseline per screenshot: no OS suffix, because every run renders on Linux.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  // Signed-in pages use sessions created in the local test database.
  globalSetup: "../support/e2e-setup.ts",
  forbidOnly: isCI,
  reporter: isCI
    ? [
        ["github"],
        [
          "html",
          {
            open: "never",
            outputFolder: resolve(root, "playwright-report/visual"),
          },
        ],
      ]
    : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: url,
    // Final states only; CSS animations are also stopped by toHaveScreenshot.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    ...(wsEndpoint && {
      connectOptions: { wsEndpoint, exposeNetwork: "<loopback>" },
    }),
  },
  webServer: {
    command: `npm run build:design && npm run preview:design -- ${testServerVars(url)}`,
    env: {
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
        TEST_DATABASE_URL,
    },
    cwd: root,
    url: `${url}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
