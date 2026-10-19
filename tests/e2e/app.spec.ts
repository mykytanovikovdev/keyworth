import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

// Collect CSP violations from the very first script on the page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push(
        `${event.effectiveDirective} ${event.blockedURI}`,
      );
    });
  });
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
  return errors;
}

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

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [390, 1440]) {
    test(`renders without CSP violations or errors (${colorScheme}, ${String(width)}px)`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 900 });

      await page.goto("/");

      await expect(
        page.getByRole("heading", { level: 1, name: "Keyworth" }),
      ).toBeVisible();
      const state = await page.evaluate(
        (scheme) => ({
          violations: window.__cspViolations ?? [],
          crossOriginIsolated: window.crossOriginIsolated,
          background: getComputedStyle(document.documentElement)
            .backgroundColor,
          scrollWidth: document.documentElement.scrollWidth,
          schemeEmulated: matchMedia(`(prefers-color-scheme: ${scheme})`)
            .matches,
        }),
        colorScheme,
      );

      expect(state.violations).toEqual([]);
      expect(errors).toEqual([]);
      // COOP + COEP make the page cross-origin isolated.
      expect(state.crossOriginIsolated).toBe(true);
      expect(state.scrollWidth, "no horizontal scroll").toBeLessThanOrEqual(
        width,
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
}

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
