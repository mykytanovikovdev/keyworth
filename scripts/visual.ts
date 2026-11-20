// Runs the visual tests with Chromium inside the official Playwright Docker
// image, the same image CI uses, so screenshots match pixel for pixel whatever
// the host OS or CPU. The tests and the web server run on this machine; only the
// browser runs in the container (scripts/browser-server.ts).
//
//   node scripts/visual.ts                      compare with the baselines
//   node scripts/visual.ts --update-snapshots   rewrite the baselines
//
// Extra arguments go to `playwright test`.
import { runWithBrowserServer } from "./browser-server.ts";

process.exit(
  await runWithBrowserServer({
    name: "keyworth-visual-browser",
    port: 3123,
    // CI runners are x86-64; on Apple silicon the image runs under emulation,
    // because font rasterization can differ between CPU architectures.
    platform: "linux/amd64",
    args: [
      "--config",
      "tests/visual/playwright.config.ts",
      ...process.argv.slice(2),
    ],
  }),
);
