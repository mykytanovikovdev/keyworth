// Runs the end-to-end tests with Chromium, Firefox and WebKit inside the
// official Playwright Docker image (scripts/browser-server.ts). CI uses it so a
// job needs no `playwright install --with-deps`, whose system packages come from
// the runner's Ubuntu mirror and once took over 20 minutes. Locally it runs
// Firefox too, which does not start on every Mac.
//
//   node scripts/e2e-docker.ts                       every project
//   node scripts/e2e-docker.ts --project=firefox     extra arguments go to `playwright test`
//
// With PLAYWRIGHT_BASE_URL set it tests that site instead of local builds,
// as the post-deploy smoke test does.
import { hostPlatform, runWithBrowserServer } from "./browser-server.ts";

process.exit(
  await runWithBrowserServer({
    name: "keyworth-e2e-browsers",
    port: 3124,
    // No pixels are compared here, so the host's own architecture: native
    // speed on Apple silicon as well. Emulated, WebKit runs past the tests'
    // time limits there.
    platform: hostPlatform,
    args: process.argv.slice(2),
  }),
);
