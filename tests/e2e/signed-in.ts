import { type BrowserContext, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { setUpKeys } from "../support/keys.ts";
import { createSignedInUser } from "../support/session.ts";

/*
 * What the signed-in e2e tests share: a user signed in through the database,
 * with keys set up as on an earlier visit, unlocking, and reading the
 * database to see what the server stored.
 */

/**
 * Argon2 with the production settings takes about a second per derivation on
 * a laptop and several in CI, slowest in WebKit on Linux; a test here runs up
 * to six. So every test gets three times the usual time, and every wait that
 * follows a derivation gets this much.
 */
export const AFTER_ARGON2 = { timeout: 30_000 };

export const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

export async function sql<T extends Record<string, unknown>>(
  query: string,
  params: unknown[],
): Promise<T[]> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return (await pool.query<T>(query, params)).rows;
  } finally {
    await pool.end();
  }
}

export async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  const email = `e2e-keys-${crypto.randomUUID().slice(0, 8)}@example.com`;
  await context.addCookies(
    await createSignedInUser({
      databaseUrl: TEST_DATABASE_URL,
      baseURL: baseURL ?? "",
      email,
      name: "Alex Example",
    }),
  );
  return email;
}

/** A signed-in user who set up keys earlier, on another visit. */
export async function returningUser(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  const email = await signIn(context, baseURL);
  return {
    email,
    ...(await setUpKeys({ databaseUrl: TEST_DATABASE_URL, email })),
  };
}

/** The signed-in start page: the portfolio. */
export const appHome = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Portfolio" });

export async function unlock(page: Page, passphrase: string, remember = false) {
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  if (remember) {
    // The box is drawn over a hidden input: click the label, as people do.
    await page.getByText("Remember this device", { exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Remember this device" }),
    ).toBeChecked();
  }
  await page.getByRole("button", { name: "Unlock" }).click();
}
