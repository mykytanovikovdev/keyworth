import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { stubMarket } from "./market.ts";
import {
  AFTER_ARGON2,
  appHome,
  returningUser,
  unlock,
  WCAG_TAGS,
} from "./signed-in.ts";
import { collectErrors, cspViolations, watchCspViolations } from "./support.ts";

/*
 * The portfolio page in the production build, in Chromium, Firefox and
 * WebKit: the start page after unlocking, figures from the vault and the
 * market (answered in the browser by `market.ts`), the form shared with the
 * transactions page, the sections in the header, and a 320px screen.
 */

test.beforeEach(async ({ page }) => {
  test.slow();
  await watchCspViolations(page);
  await stubMarket(page);
});

async function openApp(
  page: Page,
  context: Parameters<typeof returningUser>[0],
  baseURL: string | undefined,
) {
  const user = await returningUser(context, baseURL);
  await page.goto("/");
  await unlock(page, user.passphrase);
  await expect(appHome(page)).toBeVisible(AFTER_ARGON2);
  return user;
}

/** Ten days ago on this device, as typed into the date field: ddmmyyyy. */
function tenDaysAgo(): string {
  const day = new Date(Date.now() - 10 * 86_400_000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(day.getDate())}${two(day.getMonth() + 1)}${String(day.getFullYear())}`;
}

/** Half a bitcoin at $60,000, ten days ago, through the form on the portfolio. */
async function buyBitcoin(page: Page) {
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add transaction" });
  await dialog.getByRole("combobox", { name: "Coin" }).fill("bit");
  await page.getByRole("option", { name: /Bitcoin/ }).click();
  await dialog
    .getByRole("group", { name: "Date" })
    .getByRole("spinbutton")
    .first()
    .click();
  await page.keyboard.type(tenDaysAgo());
  await dialog.getByRole("textbox", { name: "Quantity" }).fill("0.5");
  await dialog.getByRole("textbox", { name: "Price per coin" }).fill("60000");
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
}

const figures = (page: Page) =>
  page.getByRole("region", { name: "Key figures" });

test("values a purchase from the vault and the market, with no error", async ({
  page,
  context,
  baseURL,
}) => {
  const errors = collectErrors(page);
  await openApp(page, context, baseURL);
  await expect(page.getByText("Nothing here yet")).toBeVisible();

  await buyBitcoin(page);

  // 0.5 × $75,000 today; bought for $30,000.
  await expect(page.getByText("$37,500.00").first()).toBeVisible();
  await expect(figures(page).getByText("+$7,500.00")).toBeVisible();
  await expect(
    // Ten days old: younger than the month asked for, so the period says so.
    page.getByRole("img", {
      name: /^Portfolio value, since \w{3} \d{1,2}, \d{4}: from \$/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Bitcoin.*\$37,500\.00/ }),
  ).toBeVisible();

  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByText(/^since \w{3} \d{4}$/).first()).toBeVisible();

  expect(errors).toEqual([]);
  expect(await cspViolations(page)).toEqual([]);
});

test("keeps amounts hidden after a reload, and opens the transactions without one", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await buyBitcoin(page);
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(page.getByText("$37,500.00")).toHaveCount(0);

  await page.reload();
  await unlock(page, passphrase);
  await expect(appHome(page)).toBeVisible(AFTER_ARGON2);
  await expect(
    page.getByRole("button", { name: "Show amounts" }),
  ).toBeVisible();
  await expect(page.getByText("$37,500.00")).toHaveCount(0);

  // Through the router: no reload, so no unlock.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Transactions" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Transactions" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/transactions$/);
});

// The waiting is the router's, the same in every engine.
test("keeps the page until the next one's code arrives, fetched ahead @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  // Settings' code is held back until the test lets it through.
  let asked = false;
  const { promise: released, resolve: release } =
    Promise.withResolvers<undefined>();
  await page.route(/\/assets\/SettingsPage-[\w-]+\.js$/, async (route) => {
    asked = true;
    await released;
    await route.continue();
  });
  await openApp(page, context, baseURL);
  // Asked for in the background, before any click.
  await expect.poll(() => asked).toBe(true);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // Long enough for a wrong switch to an empty page to show.
  await page.waitForTimeout(500);
  await expect(appHome(page)).toBeVisible();

  release(undefined);
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
  await expect(appHome(page)).toHaveCount(0);
});

test("says when prices couldn't load, and shows no zero for them", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await buyBitcoin(page);
  await page.route("**/api/market/prices*", (route) =>
    route.fulfill({ status: 502, json: { error: "market_unavailable" } }),
  );

  await page.reload();
  await unlock(page, passphrase);
  await expect(page.getByText(/Prices couldn.t load/)).toBeVisible(
    AFTER_ARGON2,
  );
  await expect(page.getByText("$0.00")).toHaveCount(0);
});

test("fits a 320px screen with no axe violations", async ({
  page,
  context,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page, context, baseURL);
  await buyBitcoin(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const scan = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .exclude('[aria-live] > [role="img"]')
    .analyze();
  expect(scan.violations).toEqual([]);
});
