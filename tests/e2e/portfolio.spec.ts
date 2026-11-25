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
const buyBitcoin = (page: Page) => buyHalf(page, "Bitcoin", "60000");

async function buyHalf(page: Page, coin: string, price: string) {
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add transaction" });
  await dialog
    .getByRole("combobox", { name: "Coin" })
    .fill(coin.slice(0, 3).toLowerCase());
  await page.getByRole("option", { name: new RegExp(coin) }).click();
  await dialog
    .getByRole("group", { name: "Date" })
    .getByRole("spinbutton")
    .first()
    .click();
  await page.keyboard.type(tenDaysAgo());
  await dialog.getByRole("textbox", { name: "Quantity" }).fill("0.5");
  await dialog.getByRole("textbox", { name: "Price per coin" }).fill(price);
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added").first()).toBeVisible();
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

// Which requests are made is the page's own code, the same in every engine.
test("asks for every coin's history in one request @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await buyBitcoin(page);
  await buyHalf(page, "Ethereum", "2000");
  await page.reload();
  const asked: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith("/api/market/histor")) return;
    // Only the request for several has a body.
    const body = request.postDataJSON() as {
      assets: { asset: string }[];
    } | null;
    const coins = body?.assets.map(({ asset }) => asset).sort() ?? [];
    asked.push([request.method(), pathname, ...coins].join(" "));
  });

  await unlock(page, passphrase);
  await expect(appHome(page)).toBeVisible(AFTER_ARGON2);
  await expect(
    page.getByRole("img", { name: /^Portfolio value, since / }),
  ).toBeVisible();

  expect(asked).toEqual([
    "POST /api/market/histories crypto:bitcoin crypto:ethereum",
  ]);
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

// Routing, the same in every engine.
test("offers an empty portfolio the import, open on the transactions page @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  await openApp(page, context, baseURL);

  await page.getByRole("button", { name: "Import from a file" }).click();

  await expect(
    page.getByRole("dialog", { name: "Import transactions" }),
  ).toBeVisible();
  // The request left the address: a reload does not open it again.
  await expect(page).toHaveURL(/\/transactions$/);
});

/**
 * Answers the snapshot with these prices of Bitcoin, one a request and the last
 * one from then on. Returns how many times it was asked for.
 */
async function servePrices(
  page: Page,
  answers: { price: string; refreshing: boolean }[],
) {
  const started = Date.now();
  let asked = 0;
  await page.route("**/api/market/prices", (route) => {
    const answer = answers[Math.min(asked, answers.length - 1)];
    asked += 1;
    return route.fulfill({
      json: {
        currency: "USD",
        // Half an hour old while newer ones load.
        fetchedAt: new Date(
          started - (answer?.refreshing ? 30 * 60_000 : 0),
        ).toISOString(),
        refreshing: answer?.refreshing,
        quotes: [
          {
            id: "crypto:bitcoin",
            symbol: "BTC",
            name: "Bitcoin",
            rank: 1,
            price: answer?.price,
          },
        ],
      },
    });
  });
  return () => asked;
}

// When prices are asked for is the page's own code, the same in every engine.
test("shows prices half an hour old at once, and the newer ones when they are in @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await buyBitcoin(page);
  const asked = await servePrices(page, [
    { price: "75000", refreshing: true },
    { price: "80000", refreshing: false },
  ]);

  await page.reload();
  await unlock(page, passphrase);

  await expect(page.getByText("$37,500.00").first()).toBeVisible(AFTER_ARGON2);
  await expect(page.getByText("$40,000.00").first()).toBeVisible({
    timeout: 10_000,
  });
  expect(asked()).toBe(2);
});

test("asks for newer prices once, though they do not come @chromium-only", async ({
  page,
  context,
  baseURL,
}) => {
  const { passphrase } = await openApp(page, context, baseURL);
  await buyBitcoin(page);
  const asked = await servePrices(page, [{ price: "75000", refreshing: true }]);

  await page.reload();
  await unlock(page, passphrase);

  await expect(page.getByText("$37,500.00").first()).toBeVisible(AFTER_ARGON2);
  await expect.poll(asked, { timeout: 10_000 }).toBe(2);
  // Longer than the wait before the second request.
  await page.waitForTimeout(6_500);
  expect(asked()).toBe(2);
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
  // Final states only, from the start: switched on after the purchase, it let
  // axe catch the holdings list still fading in (contrast 1.03 in WebKit).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page, context, baseURL);
  await buyBitcoin(page);

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
