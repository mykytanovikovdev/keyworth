import { expect, test } from "@playwright/test";
import { collectErrors, cspViolations, watchCspViolations } from "./support.ts";

test.beforeEach(async ({ page }) => {
  await watchCspViolations(page);
});

/** WCAG relative luminance of a computed `rgb(...)` color, from 0 (black) to 1 (white). */
function relativeLuminance(cssColor: string): number {
  const channels = (cssColor.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  if (channels.length !== 3) throw new Error(`Unexpected color: ${cssColor}`);
  const [r = 0, g = 0, b = 0] = channels.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The narrow width, where a page can scroll sideways. A wider one changes
// nothing about the CSP; the screenshots in tests/visual cover its layout.
const WIDTH = 390;

for (const colorScheme of ["light", "dark"] as const) {
  test(`renders without CSP violations or errors (${colorScheme})`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: WIDTH, height: 900 });

    // Signed out, the app sends every page to sign-in.
    await page.goto("/");

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in to Keyworth" }),
    ).toBeVisible();
    const violations = await cspViolations(page);
    const state = await page.evaluate(
      (scheme) => ({
        crossOriginIsolated: window.crossOriginIsolated,
        background: getComputedStyle(document.documentElement).backgroundColor,
        scrollWidth: document.documentElement.scrollWidth,
        schemeEmulated: matchMedia(`(prefers-color-scheme: ${scheme})`).matches,
      }),
      colorScheme,
    );

    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    // COOP + COEP make the page cross-origin isolated.
    expect(state.crossOriginIsolated).toBe(true);
    expect(state.scrollWidth, "no horizontal scroll").toBeLessThanOrEqual(
      WIDTH,
    );

    // The page follows the color scheme instead of a hardcoded palette.
    // Some browser builds ignore color-scheme emulation (Playwright's Firefox
    // on macOS); record that instead of asserting against the wrong scheme.
    if (!state.schemeEmulated) {
      test.info().annotations.push({
        type: "theme check skipped",
        description: `${colorScheme} color-scheme emulation is not supported here`,
      });
      return;
    }
    const luminance = relativeLuminance(state.background);
    if (colorScheme === "dark") expect(luminance).toBeLessThan(0.2);
    else expect(luminance).toBeGreaterThan(0.8);
  });
}

test("the design system page is not part of the production build", async ({
  page,
}) => {
  // /design falls back to the app shell, which has no such route outside design mode.
  await page.goto("/design");

  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Design system" }),
  ).toHaveCount(0);
});

test("Trusted Types block string assignment to DOM injection sinks", async ({
  page,
}) => {
  await page.goto("/");
  const supportsTrustedTypes = await page.evaluate(
    () => "trustedTypes" in window,
  );
  test.skip(
    !supportsTrustedTypes,
    "This browser does not implement Trusted Types",
  );

  const outcome = await page.evaluate(() => {
    const element = document.createElement("div");
    try {
      // eslint-disable-next-line no-restricted-syntax -- this test proves the sink is blocked
      element.innerHTML = "<img src=x>";
      return "assigned";
    } catch (error) {
      return error instanceof TypeError ? "blocked" : String(error);
    }
  });

  expect(outcome).toBe("blocked");
});
