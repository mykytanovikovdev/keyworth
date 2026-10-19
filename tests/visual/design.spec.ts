import { expect, test, type Page } from "@playwright/test";

const THEMES = ["light", "dark"] as const;
const WIDTHS = [390, 1440] as const;

async function openDesignPage(page: Page, theme: string, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.addInitScript((value) => {
    window.localStorage.setItem("keyworth-theme", value);
  }, theme);
  await page.goto("/design");
  await expect(
    page.getByRole("heading", { level: 1, name: "Design system" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`design page, ${theme}, ${String(width)}px`, async ({ page }) => {
      await openDesignPage(page, theme, width);

      await expect(page).toHaveScreenshot(
        `design-${theme}-${String(width)}.png`,
        { fullPage: true },
      );
    });

    test(`dialog, ${theme}, ${String(width)}px`, async ({ page }) => {
      await openDesignPage(page, theme, width);
      await page.getByRole("button", { name: "Open dialog" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();

      await expect(page).toHaveScreenshot(
        `dialog-${theme}-${String(width)}.png`,
      );
    });
  }

  test(`toast, ${theme}`, async ({ page }) => {
    await openDesignPage(page, theme, 390);
    await page.getByRole("button", { name: "Show success" }).click();
    const toast = page.getByRole("alertdialog", { name: "Trade recorded" });
    await expect(toast).toBeVisible();

    await expect(toast).toHaveScreenshot(`toast-${theme}.png`);
  });
}
