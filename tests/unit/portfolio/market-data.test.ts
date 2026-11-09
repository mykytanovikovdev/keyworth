import { describe, expect, it } from "vitest";
import {
  priceSeries,
  quoteLookup,
  rateLookup,
} from "../../../src/features/portfolio/market-data.ts";

/*
 * The server's answers turned into what shared/metrics takes. The routes are
 * tested in tests/integration/market.test.ts.
 */

describe("rates between any two currencies", () => {
  // Units per US dollar: euros and lari.
  const rate = rateLookup({
    EUR: { from: "2025-12-19", values: ["0.9", null, null, "0.92"] },
    GEL: { from: "2025-12-19", values: ["2.7", "2.7", "2.7", "2.76"] },
  });

  it("goes through the dollar", () => {
    expect(rate("USD", "EUR", "2025-12-19")?.toString()).toBe("0.9");
    expect(rate("EUR", "USD", "2025-12-19")?.toFixed(4)).toBe("1.1111");
    // 2.7 lari or 0.9 euro per dollar: 3 lari per euro.
    expect(rate("EUR", "GEL", "2025-12-19")?.toString()).toBe("3");
  });

  it("keeps the last rate over a weekend, and has none before a series", () => {
    expect(rate("USD", "EUR", "2025-12-21")?.toString()).toBe("0.9");
    expect(rate("USD", "EUR", "2025-12-23")?.toString()).toBe("0.92");
    expect(rate("USD", "EUR", "2025-12-18")).toBeNull();
    expect(rate("USD", "JPY", "2025-12-19")).toBeNull();
  });

  it("is one between a currency and itself, with no request", () => {
    expect(rate("JPY", "JPY", "2025-12-19")?.toString()).toBe("1");
  });
});

describe("a coin's price series", () => {
  const history = {
    asset: "crypto:bitcoin",
    currency: "USD" as const,
    source: "coinmetrics" as const,
    prices: { from: "2025-12-30", values: ["90000", null, "93000.5"] },
  };

  it("dates each close, skips the days without one, and adds today's price", () => {
    const series = priceSeries(history, {
      date: "2026-01-02",
      price: "94000",
    });

    expect(
      series.points.map(({ date, price }) => [date, price.toString()]),
    ).toEqual([
      ["2025-12-30", "90000"],
      ["2026-01-01", "93000.5"],
      ["2026-01-02", "94000"],
    ]);
  });

  it("keeps the close when today's price is for a day it already has", () => {
    const series = priceSeries(history, {
      date: "2026-01-01",
      price: "1",
    });

    expect(series.points.at(-1)?.price.toString()).toBe("93000.5");
  });
});

describe("today's quotes", () => {
  it("come from the snapshot or the coins asked by id, in dollars", () => {
    const quote = quoteLookup(
      {
        currency: "USD",
        fetchedAt: "",
        quotes: [
          {
            id: "crypto:bitcoin",
            symbol: "BTC",
            name: "Bitcoin",
            rank: 1,
            price: "92540",
          },
        ],
      },
      undefined,
      {
        currency: "USD",
        fetchedAt: "",
        quotes: [
          {
            id: "crypto:pepe",
            symbol: "PEPE",
            name: "Pepe",
            rank: null,
            price: "0.00000812",
          },
        ],
      },
    );

    expect(quote("crypto:pepe")?.price.toString()).toBe("0.00000812");
    expect(quote("crypto:bitcoin")?.currency).toBe("USD");
    expect(quote("crypto:unknown")).toBeNull();
  });
});
