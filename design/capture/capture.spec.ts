import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";

const OUT = resolve(import.meta.dirname, "../screenshots");
const VARIANTS = ["neutral", "warm"] as const;
const THEMES = ["light", "dark"] as const;
const SCREENS = ["empty", "chat", "portfolio", "unlock"] as const;
const WIDTHS = [390, 1440] as const;

async function open(
  page: Page,
  variant: string,
  theme: string,
  screen: string,
) {
  await page.goto(
    `/design/?variant=${variant}&theme=${theme}&screen=${screen}&chrome=0`,
  );
  await page.evaluate(() => document.fonts.ready);
}

test.describe("screenshots", () => {
  for (const variant of VARIANTS) {
    for (const theme of THEMES) {
      for (const screen of SCREENS) {
        for (const width of WIDTHS) {
          test(`${variant} ${screen} ${theme} ${String(width)}`, async ({
            page,
          }) => {
            await page.setViewportSize({
              width,
              height: width === 390 ? 844 : 900,
            });
            await open(page, variant, theme, screen);
            await page.waitForTimeout(200);
            const name = `${variant}-${screen}-${theme}-${String(width)}`;
            await page.screenshot({ path: `${OUT}/${name}.png` });

            if (screen === "chat") {
              // The chat follows the latest message; also capture the start of it.
              await page.locator("[data-chat-scroll]").evaluate((element) => {
                element.scrollTop = 0;
              });
              await page.screenshot({
                path: `${OUT}/${variant}-chat-top-${theme}-${String(width)}.png`,
              });
            }
          });
        }
      }
    }
  }
});

test.describe("videos @video", () => {
  for (const variant of VARIANTS) {
    for (const [screen, ms] of [
      ["chat", 11000],
      ["portfolio", 3500],
      ["empty", 2500],
    ] as const) {
      test(`${variant} ${screen} animation @video`, async ({ page }) => {
        await open(page, variant, "light", screen);
        await page.waitForTimeout(ms);
        const video = page.video();
        await page.close();
        await video?.saveAs(`${OUT}/${variant}-${screen}.webm`);
      });
    }
  }
});
