import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
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
