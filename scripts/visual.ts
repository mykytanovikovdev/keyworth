// Runs the visual tests with Chromium inside the official Playwright Docker
// image, the same image CI uses, so screenshots match pixel for pixel whatever
// the host OS or CPU. The tests and the web server run on this machine; only the
// browser runs in the container.
//
//   node scripts/visual.ts                      compare with the baselines
//   node scripts/visual.ts --update-snapshots   rewrite the baselines
//
// Extra arguments go to `playwright test`.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Keep in sync with @playwright/test in package.json and the visual job in
// .github/workflows/ci.yml. The digest pins the exact image contents.
const IMAGE =
  "mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf";
// CI runners are x86-64; on Apple silicon the image runs under emulation,
// because font rasterization can differ between CPU architectures.
const PLATFORM = "linux/amd64";
const CONTAINER = "keyworth-visual-browser";
const PORT = 3123;

const root = resolve(import.meta.dirname, "..");

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function stopContainer() {
  spawnSync("docker", ["rm", "--force", CONTAINER], { stdio: "ignore" });
}

try {
  docker("info", "--format", "{{.ServerVersion}}");
} catch {
  console.error("Docker is not running. Start Docker Desktop and try again.");
  process.exit(1);
}

stopContainer();
// playwright-core from node_modules provides the server: same version as the
// tests, no package download inside the container. Runs as the image's
// unprivileged user, reachable only from this machine.
docker(
  "run",
  "--detach",
  "--rm",
  "--init",
  "--ipc=host",
  "--platform",
  PLATFORM,
  "--name",
  CONTAINER,
  "--user",
  "pwuser",
  "--publish",
  `127.0.0.1:${String(PORT)}:3000`,
  "--volume",
  `${resolve(root, "node_modules/playwright-core")}:/opt/playwright-core:ro`,
  IMAGE,
  "node",
  "/opt/playwright-core/cli.js",
  "run-server",
  "--port",
  "3000",
  "--host",
  "0.0.0.0",
);

process.on("SIGINT", () => {
  stopContainer();
  process.exit(130);
});

let ready = false;
for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
  ready = docker("logs", CONTAINER).includes("Listening on");
  if (!ready) await sleep(500);
}
if (!ready) {
  console.error(docker("logs", CONTAINER));
  stopContainer();
  console.error("The browser server in Docker did not start.");
  process.exit(1);
}

const tests = spawn(
  "npx",
  [
    "playwright",
    "test",
    "--config",
    "tests/visual/playwright.config.ts",
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PW_BROWSER_WS_ENDPOINT: `ws://127.0.0.1:${String(PORT)}/`,
    },
  },
);

const code = await new Promise<number>((done) => {
  tests.on("close", (exitCode) => {
    done(exitCode ?? 1);
  });
});
stopContainer();
process.exit(code);
