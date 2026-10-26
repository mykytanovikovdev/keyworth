import { expect, test } from "@playwright/test";
import { collectErrors, cspViolations, watchCspViolations } from "./support.ts";

// Argon2id (@noble/hashes) under the production CSP and Trusted Types, in every
// engine: the RFC 9106 vector proves the engine computes it correctly, and the
// timing lands in the report, one line per browser.

test.beforeEach(async ({ page }) => {
  await watchCspViolations(page);
});

test("Argon2id matches RFC 9106 and runs under the CSP", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.goto("/design/kdf");
  await expect(page.getByText("RFC 9106 test vector: passed")).toBeVisible();

  await page.getByRole("button", { name: "Run once" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText(/Median: \d+ ms/, { timeout: 30_000 });

  testInfo.annotations.push({
    type: "argon2id",
    description: (await status.textContent()) ?? "",
  });
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
