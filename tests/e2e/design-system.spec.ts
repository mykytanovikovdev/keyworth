import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  chooseTheme,
  collectErrors,
  cspViolations,
  watchCspViolations,
} from "./support.ts";

// The /design page of the design-mode build, served with the production
// headers: every component in src/ui is exercised under the real CSP.

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  await watchCspViolations(page);
});

async function openPage(page: Page) {
  await page.goto("/design");
  await expect(
    page.getByRole("heading", { level: 1, name: "Design system" }),
  ).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await chooseTheme(page, theme);
    });

    test("components work under the CSP without errors", async ({ page }) => {
      const errors = collectErrors(page);
      await openPage(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      // A modal dialog: focus moves in, Escape closes it, focus returns.
      const openDialog = page.getByRole("button", { name: "Open dialog" });
      await openDialog.click();
      const dialog = page.getByRole("dialog", { name: "Recovery key" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(openDialog).toBeFocused();

      // A confirmation ignores Escape and needs an answer.
      await page.getByRole("button", { name: "Open confirmation" }).click();
      const confirmation = page.getByRole("alertdialog", {
        name: "Discard this trade?",
      });
      await expect(confirmation).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: "Keep editing" }).click();
      await expect(confirmation).toBeHidden();

      // A toast appears, and its close button dismisses it.
      await page.getByRole("button", { name: "Show error" }).click();
      const toast = page.getByRole("alertdialog", {
        name: "Couldn't save the trade",
      });
      await expect(toast).toBeVisible();
      await toast.getByRole("button", { name: "Dismiss" }).click();
      await expect(toast).toBeHidden();

      // Icon-only buttons show their label as a tooltip on keyboard focus.
      await page.getByRole("button", { name: "Copy answer" }).focus();
      await expect(page.getByRole("tooltip")).toHaveText("Copy answer");

      // React Aria's runtime <style> is allowed by its CSP hash, so it applies
      // (blocked, the value would stay "auto"; Chromium shortens it).
      const touchAction = await page
        .getByRole("button", { name: "Open dialog" })
        .evaluate((element) => getComputedStyle(element).touchAction);
      expect(["pan-x pan-y pinch-zoom", "manipulation"]).toContain(touchAction);

      expect(await cspViolations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test("has no axe violations, including with a dialog open", async ({
      page,
    }) => {
      // Final states only: half-faded text would fail the contrast check.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openPage(page);
      const pageScan = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(pageScan.violations).toEqual([]);

      await page.getByRole("button", { name: "Open dialog" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const dialogScan = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();
      expect(dialogScan.violations).toEqual([]);
    });
  });
}

test.describe("theme", () => {
  test("is set by theme-init.js before the app's JavaScript runs", async ({
    page,
  }) => {
    await chooseTheme(page, "dark");
    // Block the app bundle: only the render-blocking theme script runs.
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/design");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("a choice wins over the system setting and survives a reload", async ({
    page,
  }) => {
    await openPage(page);

    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("radio", { name: "Dark", exact: true }),
    ).toBeChecked();

    await page.getByRole("radio", { name: "System", exact: true }).click();
    expect(
      await page.evaluate(() => window.localStorage.getItem("keyworth-theme")),
    ).toBeNull();
  });

  test("follows the system setting live while no choice is stored", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openPage(page);
    const emulated = await page.evaluate(
      () => matchMedia("(prefers-color-scheme: light)").matches,
    );
    test.skip(!emulated, "This browser ignores color-scheme emulation");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

// Runs only in the iPhone project. React Aria inserts a second <style> while a
// dialog is open, but only on iOS; its CSP hash must let it through as well.
test("a dialog on iOS works under the CSP @ios", async ({ page }) => {
  // Playwright's WebKit reports the host platform; React Aria detects iOS by it.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", {
      get: () => "iPhone",
    });
  });
  const errors = collectErrors(page);
  await openPage(page);

  await page.getByRole("button", { name: "Open dialog" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const overscroll = await page.evaluate(
    () => getComputedStyle(document.body).overscrollBehaviorY,
  );

  expect(overscroll).toBe("contain");
  expect(await cspViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
