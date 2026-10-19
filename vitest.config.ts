import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
        // Worker tests run inside workerd, the same runtime as production.
        plugins: [
          cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } }),
        ],
        test: {
          name: "worker",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
