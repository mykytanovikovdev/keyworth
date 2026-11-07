import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/support/database.ts";

/**
 * The Workers test runner resolves pg's CommonJS requires without the
 * "workerd" condition and loads a .js file as CommonJS even when it holds ESM.
 * Two of pg's packages trip over that (the app's bundler handles both):
 * pg-protocol's "import" entry is ESM in a CommonJS package, and pg-cloudflare
 * falls back to an empty module. Tests load their CommonJS Workers builds.
 */
const commonJsBuilds: Record<string, string> = {
  "pg-protocol": "node_modules/pg-protocol/dist/index.js",
  "pg-cloudflare": "node_modules/pg-cloudflare/dist/index.js",
};
const pgForWorkersTests: Plugin = {
  name: "pg-for-workers-tests",
  enforce: "pre",
  resolveId(source) {
    const build = commonJsBuilds[source];
    return build ? fileURLToPath(new URL(build, import.meta.url)) : null;
  },
};

export default defineConfig({
  // The Workers pool resolves modules through the root Vite server.
  plugins: [pgForWorkersTests],
  test: {
    projects: [
      {
        // Pure logic with no runtime APIs.
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Worker tests run inside workerd, the same runtime as production,
        // against the local test database.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              hyperdrives: { HYPERDRIVE: TEST_DATABASE_URL },
              // No real network: a request a test did not replace fails loudly
              // instead of reaching Google or a price source.
              outboundService: () =>
                new Response("No network in tests", { status: 599 }),
              // Test-only values: nothing here is a real credential.
              bindings: {
                BETTER_AUTH_URL: "https://keyworth.test",
                BETTER_AUTH_SECRET: "integration-tests-only-0123456789abcdef",
                GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
                GOOGLE_CLIENT_SECRET: "test-client-secret",
                COINGECKO_API_KEY: "test-coingecko-key",
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/support/integration-setup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
        },
      },
    ],
  },
});
