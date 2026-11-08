import { afterEach, describe, expect, it, vi } from "vitest";
import {
  priceOnDay,
  quotesQuery,
  snapshotQuery,
} from "../../../src/features/transactions/market.ts";

/*
 * "Price that day" in the form: which of Keyworth's market routes it asks,
 * and how it reads their answers. The routes themselves are tested in
 * tests/integration/market.test.ts.
 */

/** Answers each path with `answer`, recording what was asked. */
function serve(answer: (url: URL) => unknown) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      const url = new URL(path, "https://keyworth.test");
      asked.push(`${url.pathname}${url.search}`);
      return Promise.resolve(Response.json(answer(url)));
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const quote = {
  id: "crypto:bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  rank: 1,
  price: "75000",
};

describe("the price on a day", () => {
  it("is today's current price for today", async () => {
    const asked = serve(() => ({
      currency: "USD",
      fetchedAt: "",
      quotes: [quote],
    }));

    const price = await priceOnDay(
      "crypto:bitcoin",
      "2026-11-08",
      "USD",
      "2026-11-08",
    );

    expect(price).toEqual({ price: "75000.00", source: "CoinGecko" });
    expect(asked).toEqual(["/api/market/prices?ids=crypto%3Abitcoin"]);
  });

  it("is the day's close from the coin's history for an earlier day, with its source", async () => {
    serve(() => ({
      asset: "crypto:bitcoin",
      currency: "USD",
      source: "coinmetrics",
      prices: { from: "2025-12-20", values: ["60000.5"] },
    }));

    expect(
      await priceOnDay("crypto:bitcoin", "2025-12-20", "USD", "2026-11-08"),
    ).toEqual({ price: "60000.50", source: "Coin Metrics" });
  });

  it("is converted at the day's rate, or the last one before it", async () => {
    serve((url) =>
      url.pathname === "/api/market/rates"
        ? {
            base: "USD",
            // A week before the day; the day itself (a Sunday) has no rate.
            rates: {
              EUR: {
                from: "2025-12-13",
                values: ["0.9", null, null, null, null, null, "0.92", null],
              },
            },
          }
        : {
            asset: "crypto:bitcoin",
            currency: "USD",
            source: "coinmetrics",
            prices: { from: "2025-12-20", values: ["60000"] },
          },
    );

    expect(
      await priceOnDay("crypto:bitcoin", "2025-12-20", "EUR", "2026-11-08"),
    ).toEqual({ price: "55200.00", source: "Coin Metrics" });
  });

  it("offers six significant digits for a coin worth under a dollar", async () => {
    serve(() => ({
      currency: "USD",
      fetchedAt: "",
      quotes: [{ ...quote, price: "0.000008123456789" }],
    }));

    expect(
      (await priceOnDay("crypto:pepe", "2026-11-08", "USD", "2026-11-08"))
        ?.price,
    ).toBe("0.00000812346");
  });

  it("has none when the history starts after the day", async () => {
    serve(() => ({
      asset: "crypto:new",
      currency: "USD",
      source: "coingecko",
      prices: { from: "2026-01-01", values: ["1"] },
    }));

    expect(
      await priceOnDay("crypto:new", "2025-12-20", "USD", "2026-11-08"),
    ).toBeNull();
  });
});

describe("what the cache keeps after the vault locks", () => {
  it("clears coins asked for by id, which say what the user holds", () => {
    expect(quotesQuery("user-1", ["crypto:b", "crypto:a"]).queryKey).toEqual([
      "vault",
      "user-1",
      "quotes",
      "crypto:a",
      "crypto:b",
    ]);
  });

  it("keeps the snapshot, the same for everyone", () => {
    expect(snapshotQuery.queryKey[0]).not.toBe("vault");
  });
});
