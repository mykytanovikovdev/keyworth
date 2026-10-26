import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { createSignedInUser } from "../support/session.ts";

// App screens with fixed content: sign-in, and settings (with the account
// deletion dialog) for a signed-in user whose name and email never change
// between runs.

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

    test(`settings, ${theme}, ${String(width)}px`, async ({
      page,
      context,
      baseURL,
    }) => {
      await prepare(page, theme, width);
      // Unique per test, but the same length every run: it is on screen.
      await signIn(
        context,
        baseURL,
        `visual-${theme}-${String(width).padStart(4, "0")}@example.com`,
      );
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { level: 1, name: "Settings" }),
      ).toBeVisible();
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
      await signIn(
        context,
        baseURL,
        `delete-${theme}-${String(width).padStart(4, "0")}@example.com`,
      );
      await page.goto("/settings");
      await page.getByRole("button", { name: "Delete account" }).click();
      await expect(
        page.getByRole("alertdialog", { name: "Delete your account?" }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      await expect(page).toHaveScreenshot(
        `delete-account-${theme}-${String(width)}.png`,
      );
    });
  }
}
