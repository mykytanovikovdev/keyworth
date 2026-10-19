import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/** Records CSP violations from the very first script on every page load. */
export async function watchCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations?.push(
        `${event.effectiveDirective} ${event.blockedURI}`,
      );
    });
  });
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

/** Console errors and uncaught exceptions, which include CSP reports. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
  return errors;
}

/** Stores a theme choice before the page loads, as the theme toggle would. */
export async function chooseTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("keyworth-theme", value);
  }, theme);
}
