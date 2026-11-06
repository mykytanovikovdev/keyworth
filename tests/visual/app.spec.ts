import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { setUpKeys } from "../support/keys.ts";
import { createSignedInUser } from "../support/session.ts";

// App screens with fixed content: sign-in, how the encryption works (its last
// step, without motion), creating a passphrase, unlocking, and settings (with
// the account deletion dialog) for a signed-in user whose name and email never
// change between runs.

const THEMES = ["light", "dark"] as const;
const WIDTHS = [390, 1440] as const;

async function prepare(page: Page, theme: string, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript((value) => {
    window.localStorage.setItem("keyworth-theme", value);
  }, theme);
}

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  email: string,
) {
  await context.addCookies(
    await createSignedInUser({
      databaseUrl: TEST_DATABASE_URL,
      baseURL: baseURL ?? "",
      email,
      name: "Alex Example",
    }),
  );
}

/** Sets up keys for the signed-in user, then unlocks on `path`. */
async function unlockAt(page: Page, email: string, path: string) {
  // Argon2 with the production settings, in an emulated browser: slow.
  test.setTimeout(120_000);
  const { passphrase } = await setUpKeys({
    databaseUrl: TEST_DATABASE_URL,
    email,
  });
  await page.goto(path);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "Unlock" }).click();
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`sign-in, ${theme}, ${String(width)}px`, async ({ page }) => {
      await prepare(page, theme, width);
      await page.goto("/sign-in?error=NOT_INVITED");
      await expect(page.getByRole("alert")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(
        `sign-in-${theme}-${String(width)}.png`,
      );
    });

    test(`create a passphrase, ${theme}, ${String(width)}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      await prepare(page, theme, width);
      await signIn(
        context,
        baseURL,
        `create-${theme}-${String(width).padStart(4, "0")}@example.com`,
      );
      await page.goto("/");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Create a passphrase" }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(
        `create-passphrase-${theme}-${String(width)}.png`,
      );
    });

    test(`how the encryption works, ${theme}, ${String(width)}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      // Without motion the steps show their final picture at once.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await prepare(page, theme, width);
      await signIn(
        context,
        baseURL,
        `explain-${theme}-${String(width).padStart(4, "0")}@example.com`,
      );
      await page.goto("/");
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Only you can read your portfolio",
        }),
      ).toBeVisible();
      // The last step: every part of the picture, both keys crossed out.
      await page.getByRole("button", { name: "Step 6 of 6" }).click();
      await page.evaluate(() => document.fonts.ready);

      // The server's characters are random on every run.
      await expect(page).toHaveScreenshot(
        `explainer-${theme}-${String(width)}.png`,
        { mask: [page.locator('[data-part="scrambled"]')] },
      );
    });

    test(`unlock, ${theme}, ${String(width)}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      await prepare(page, theme, width);
      const email = `unlock-${theme}-${String(width).padStart(4, "0")}@example.com`;
      await signIn(context, baseURL, email);
      await setUpKeys({ databaseUrl: TEST_DATABASE_URL, email });
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: "Unlock Keyworth" }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(
        `unlock-${theme}-${String(width)}.png`,
      );
    });

    test(`settings, ${theme}, ${String(width)}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      await prepare(page, theme, width);
      // Unique per test, but the same length every run: it is on screen.
      const email = `visual-${theme}-${String(width).padStart(4, "0")}@example.com`;
      await signIn(context, baseURL, email);
      await unlockAt(page, email, "/settings");
      await expect(
        page.getByRole("heading", { level: 1, name: "Settings" }),
      ).toBeVisible({ timeout: 90_000 });
      // The base currency comes from an encrypted record: loaded when enabled.
      await expect(
        page.getByRole("button", { name: /^Base currency/ }),
      ).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(
        `settings-${theme}-${String(width)}.png`,
      );
    });

    test(`delete account dialog, ${theme}, ${String(width)}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      await prepare(page, theme, width);
      const email = `delete-${theme}-${String(width).padStart(4, "0")}@example.com`;
      await signIn(context, baseURL, email);
      await unlockAt(page, email, "/settings");
      await page
        .getByRole("button", { name: "Delete account" })
        .click({ timeout: 90_000 });
      const dialog = page.getByRole("alertdialog", {
        name: "Delete your account?",
      });
      await expect(dialog).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      // The dialog alone: a change to the page behind it is not a change to it.
      await expect(dialog).toHaveScreenshot(
        `delete-account-${theme}-${String(width)}.png`,
      );
    });
  }
}
