// Runs `playwright test` with the browsers inside the official Playwright Docker
// image. The tests and the web servers run on this machine; only the browsers
// run in the container, reached through Playwright's browser server. Used by
// the visual tests (scripts/visual.ts) and by the end-to-end tests in CI
// (scripts/e2e-docker.ts), so neither needs browsers or their system packages
// installed on the host.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Keep in sync with @playwright/test in package.json: the image's browsers are
// the ones that Playwright version expects.
const TAG = "mcr.microsoft.com/playwright:v1.64.1-noble";
// The digests pin the exact contents, one per architecture rather than the
// multi-platform index: Docker's classic image store keeps one platform per
// reference ("cannot overwrite digest"), and the visual tests (amd64) and the
// end-to-end tests (the host's own) both run on Apple silicon. On a Playwright
// upgrade: `docker buildx imagetools inspect <tag>` lists both.
const DIGESTS = {
  "linux/amd64":
    "sha256:bdfda2a8fdf48707c5e50a49bd3e06d8d0c759153dc8ee057d8a81c3450bb3e9",
  "linux/arm64":
    "sha256:68456172e8d99f42cf391e835f5d566b3ab0a2c6a745decd9590c4d73c54d2fb",
} as const;

export type Platform = keyof typeof DIGESTS;

/** This machine's own architecture. */
export const hostPlatform: Platform =
  process.arch === "arm64" ? "linux/arm64" : "linux/amd64";

const root = resolve(import.meta.dirname, "..");

export interface BrowserServerOptions {
  /** Container name; one per kind of run, so a stale one is replaced. */
  name: string;
  /** Host port the browser server listens on (127.0.0.1 only). */
  port: number;
  /** The image's architecture; anything but the host's runs emulated. */
  platform: Platform;
  /** Arguments for `playwright test`. */
  args: string[];
}

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

/** Starts the browser server, runs the tests against it, returns their exit code. */
export async function runWithBrowserServer({
  name,
  port,
  platform,
  args,
}: BrowserServerOptions): Promise<number> {
  const stop = () => {
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  };

  try {
    docker("info", "--format", "{{.ServerVersion}}");
  } catch {
    console.error("Docker is not running. Start Docker Desktop and try again.");
    return 1;
  }

  stop();
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
    platform,
    "--name",
    name,
    "--user",
    "pwuser",
    "--publish",
    `127.0.0.1:${String(port)}:3000`,
    "--volume",
    `${resolve(root, "node_modules/playwright-core")}:/opt/playwright-core:ro`,
    `${TAG}@${DIGESTS[platform]}`,
    "node",
    "/opt/playwright-core/cli.js",
    "run-server",
    "--port",
    "3000",
    "--host",
    "0.0.0.0",
  );

  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
    ready = docker("logs", name).includes("Listening on");
    if (!ready) await sleep(500);
  }
  if (!ready) {
    console.error(docker("logs", name));
    stop();
    console.error("The browser server in Docker did not start.");
    return 1;
  }

  const tests = spawn("npx", ["playwright", "test", ...args], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PW_BROWSER_WS_ENDPOINT: `ws://127.0.0.1:${String(port)}/`,
    },
  });
  const code = await new Promise<number>((done) => {
    tests.on("close", (exitCode) => {
      done(exitCode ?? 1);
    });
  });
  stop();
  return code;
}
