import type { Page } from "@playwright/test";

/*
 * Keyworth's market routes answered in the browser (page.route), so no e2e
 * test reaches CoinGecko or Frankfurter. Every signed-in page asks for prices:
 * without this, the e2e Worker (no API key) answers 502, and the browser logs
 * that to the console, which the tests count as an error.
 */

const COINS = [
  {
    id: "crypto:bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    rank: 1,
    price: "75000",
  },
  {
    id: "crypto:ethereum",
    symbol: "ETH",
    name: "Ethereum",
    rank: 2,
    price: "2300.5",
  },
  {
    id: "crypto:litecoin",
    symbol: "LTC",
    name: "Litecoin",
    rank: 20,
    price: "62",
  },
];

// A 1×1 PNG: logos load, so no 404 reaches the console.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Keyworth's market routes, answered with sample data. */
export async function stubMarket(page: Page) {
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/market/") ||
      url.pathname.startsWith("/api/assets/"),
    async (route) => {
      const url = new URL(route.request().url());
      const fetchedAt = new Date().toISOString();
      if (url.pathname.endsWith("/logo")) {
        await route.fulfill({ body: PNG, contentType: "image/png" });
      } else if (url.pathname === "/api/market/prices") {
        const ids = url.searchParams.get("ids")?.split(",");
        await route.fulfill({
          json: {
            currency: "USD",
            fetchedAt,
            quotes: COINS.filter((coin) => !ids || ids.includes(coin.id)),
          },
        });
      } else if (url.pathname === "/api/assets/search") {
        await route.fulfill({ json: { assets: [] } });
      } else if (url.pathname === "/api/market/history") {
        await route.fulfill({
          json: {
            asset: url.searchParams.get("asset"),
            currency: "USD",
            source: "coinmetrics",
            prices: { from: url.searchParams.get("from"), values: ["60000.5"] },
          },
        });
      } else if (url.pathname === "/api/market/rates") {
        const quote = url.searchParams.get("quotes") ?? "";
        await route.fulfill({
          json: {
            base: "USD",
            rates: {
              [quote]: { from: url.searchParams.get("from"), values: ["0.9"] },
            },
          },
        });
      } else {
        await route.fulfill({ status: 404, json: { error: "not_found" } });
      }
    },
  );
}
