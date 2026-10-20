import { expect, test, type Page } from "@playwright/test";
import { TEST_DATABASE_URL } from "../support/database.ts";
import { createSignedInUser } from "../support/session.ts";

// App screens with fixed content: sign-in, and settings for a signed-in user
// whose name and email never change between runs.

const THEMES = ["light", "dark"] as const;
const WIDTHS = [390, 1440] as const;

async function prepare(page: Page, theme: string, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript((value) => {
    window.localStorage.setItem("keyworth-theme", value);
  }, theme);
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
      await context.addCookies(
        await createSignedInUser({
          databaseUrl: TEST_DATABASE_URL,
          baseURL: baseURL ?? "",
          // Unique per test, but the same length every run: it is on screen.
          email: `visual-${theme}-${String(width).padStart(4, "0")}@example.com`,
          name: "Alex Example",
        }),
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
  }
}
