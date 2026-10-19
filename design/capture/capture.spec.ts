import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";

const OUT = resolve(import.meta.dirname, "../screenshots");
const THEMES = ["light", "dark"] as const;
const SCREENS = ["empty", "chat", "portfolio", "unlock"] as const;
const WIDTHS = [390, 1440] as const;

async function open(page: Page, theme: string, screen: string) {
  await page.goto(`/design/?theme=${theme}&screen=${screen}&chrome=0`);
  await page.evaluate(() => document.fonts.ready);
}

test.describe("screenshots", () => {
  for (const theme of THEMES) {
    for (const screen of SCREENS) {
      for (const width of WIDTHS) {
        test(`${screen} ${theme} ${String(width)}`, async ({ page }) => {
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 900,
          });
          await open(page, theme, screen);
          await page.waitForTimeout(200);
          await page.screenshot({
            path: `${OUT}/${screen}-${theme}-${String(width)}.png`,
          });

          if (screen === "chat") {
            // The chat follows the latest message; also capture the start of it.
            await page.locator("[data-chat-scroll]").evaluate((element) => {
              element.scrollTop = 0;
            });
            await page.screenshot({
              path: `${OUT}/chat-top-${theme}-${String(width)}.png`,
            });
          }
        });
      }
    }
  }
});

test.describe("videos @video", () => {
  for (const theme of THEMES) {
    for (const [screen, ms] of [
      ["chat", 12000],
      ["portfolio", 4000],
      ["empty", 2500],
    ] as const) {
      test(`${screen} ${theme} animation @video`, async ({ page }) => {
        await open(page, theme, screen);
        await page.waitForTimeout(ms);
        const video = page.video();
        await page.close();
        await video?.saveAs(`${OUT}/${screen}-${theme}.webm`);
      });
    }
  }
});
