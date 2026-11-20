import type { Download, Page } from "@playwright/test";

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

/**
 * A click with a person's pause between press and release. Playwright
 * releases within a millisecond; when the page is busy at that moment (just
 * unlocked, code loading in the background), React Aria's combo box opens its
 * list on the press and closes it again on the late release. With the CPU
 * slowed sixfold that failed 6 runs of 6; with this pause, none.
 */
export const LIKE_A_PERSON = { delay: 120 } as const;

/**
 * A downloaded file as text. Read as a stream: when the browser runs in Docker
 * (scripts/e2e-docker.ts), the file has no path on this machine.
 */
export async function downloadedText(download: Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
