import { describe, expect, it } from "vitest";
import type { PriceSeries } from "../../../shared/metrics/history.ts";
import { decimal } from "../../../shared/money/decimal.ts";
import {
  allocationOf,
  type Holding,
  periodStart,
  summarize,
} from "../../../src/features/portfolio/summary.ts";
import { buy, entries, income, sell, USD } from "../metrics/fixtures.ts";

/*
 * What the portfolio page shows, from transactions, today's quotes and daily
 * histories. The figures themselves are tested in tests/unit/metrics; here,
 * how they are put together, and what a missing price does to each of them.
 */

const BTC = { assetId: "crypto:bitcoin" };
const ETH = { assetId: "crypto:ethereum" };

const series = (points: Record<string, string>): PriceSeries => ({
  currency: "USD",
  points: Object.entries(points).map(([date, price]) => ({
    date,
    price: decimal(price),
  })),
});

const HISTORY: Record<string, PriceSeries> = {
  "crypto:bitcoin": series({
    "2025-01-01": "100",
    "2025-01-02": "110",
    "2025-01-03": "120",
    "2025-01-04": "130",
  }),
  "crypto:ethereum": series({
    "2025-01-01": "10",
    "2025-01-02": "10",
    "2025-01-03": "12",
    "2025-01-04": "11",
  }),
};
const TODAY: Record<string, string> = {
  "crypto:bitcoin": "130",
  "crypto:ethereum": "11",
};

function run(
  transactions: Parameters<typeof entries>,
  {
    unpriced = [] as string[],
    noHistory = false,
    period = "All" as const,
  }: {
    unpriced?: string[];
    noHistory?: boolean;
    period?: "All" | "1W";
  } = {},
) {
  return summarize(entries(...transactions), {
    money: USD,
    quote: (assetId) => {
      const price = TODAY[assetId];
      return price && !unpriced.includes(assetId)
        ? { price: decimal(price), currency: "USD" }
        : null;
    },
    history: noHistory
      ? null
      : (assetId) =>
          unpriced.includes(assetId) ? null : (HISTORY[assetId] ?? null),
    period,
    today: "2025-01-04",
  });
}

describe("the period's first day", () => {
  it("is the period's length back from today", () => {
    expect(periodStart("1M", "2024-01-01", "2025-03-31")).toBe("2025-03-01");
  });

  it("is never before the first transaction", () => {
    expect(periodStart("1Y", "2025-02-10", "2025-03-31")).toBe("2025-02-10");
    expect(periodStart("All", "2025-02-10", "2025-03-31")).toBe("2025-02-10");
  });
});

describe("the allocation's colors", () => {
  const holding = (assetId: string, share: number): Holding => ({
    assetId,
    quantity: decimal("1"),
    price: null,
    value: decimal("1"),
    averageCost: null,
    unrealizedPnl: null,
    unrealizedReturn: null,
    share,
  });

  it("follow the order coins were first bought, not their size", () => {
    expect(
      allocationOf([holding("b", 0.7), holding("a", 0.3)], ["a", "b"]),
    ).toEqual([
      { id: "b", share: 0.7, slot: 2 },
      { id: "a", share: 0.3, slot: 1 },
    ]);
  });

  it("go to the five largest; the rest share a neutral Other", () => {
    const shares = [0.3, 0.2, 0.15, 0.12, 0.1, 0.08, 0.05];
    const ids = shares.map((_, index) => `c${String(index)}`);
    const items = allocationOf(
      shares.map((share, index) => holding(ids[index] ?? "", share)),
      ids,
    );

    expect(items.map(({ id, slot }) => [id, slot])).toEqual([
      ["c0", 1],
      ["c1", 2],
      ["c2", 3],
      ["c3", 4],
      ["c4", 5],
      ["other", null],
    ]);
    expect(items.at(-1)?.share).toBeCloseTo(0.13);
  });
});

describe("the portfolio's summary", () => {
  it("adds up the value, profit sold and still held, and income apart", () => {
    const summary = run([
      buy("2025-01-01", "2", "100", BTC),
      sell("2025-01-03", "1", "120", BTC),
      buy("2025-01-02", "10", "10", ETH),
      income("2025-01-03", "1", "12", ETH),
    ]);

    // 1 BTC × 130 + 11 ETH × 11.
    expect(summary.total.toString()).toBe("251");
    // BTC: sold 1 for 20 more than it cost, holds 1 up 30. ETH: holds 10
    // bought at 10 (+10) and 1 received at 12 (−1). Income is apart.
    expect(summary.allTimeProfit?.toString()).toBe("59");
    expect(summary.income?.toString()).toBe("12");
    expect(summary.holdings.map(({ assetId }) => assetId)).toEqual([
      "crypto:bitcoin",
      "crypto:ethereum",
    ]);
  });

  it("gives the period's chart and the money made in it", () => {
    const summary = run([buy("2025-01-01", "1", "100", BTC)]);

    expect(summary.period.chart).toEqual([
      { date: "2025-01-01", value: 100 },
      { date: "2025-01-02", value: 110 },
      { date: "2025-01-03", value: 120 },
      { date: "2025-01-04", value: 130 },
    ]);
    expect(summary.period.gain?.toString()).toBe("30");
    expect(summary.period.return).toBeCloseTo(0.3);
    expect(summary.period.maxDrawdown).toBe(0);
  });

  it("lists a coin with no price, and leaves it out of every figure", () => {
    const summary = run(
      [buy("2025-01-01", "1", "100", BTC), buy("2025-01-02", "10", "10", ETH)],
      { unpriced: ["crypto:ethereum"] },
    );

    expect(summary.total.toString()).toBe("130");
    expect(summary.complete).toBe(false);
    expect(
      summary.holdings.find(({ assetId }) => assetId === "crypto:ethereum")
        ?.value,
    ).toBeNull();
    expect(summary.allTimeProfit?.toString()).toBe("30");
    expect(summary.period.chart.at(-1)?.value).toBe(130);
    expect(summary.period.gain?.toString()).toBe("30");
  });

  it("shows nothing, not zero, when no coin has a price", () => {
    const summary = run([buy("2025-01-01", "1", "100", BTC)], {
      unpriced: ["crypto:bitcoin"],
    });

    expect(summary.allTimeProfit).toBeNull();
    expect(summary.income).toBeNull();
    expect(summary.period.chart).toEqual([]);
    expect(summary.period.gain).toBeNull();
    expect(summary.period.pending).toBe(false);
  });

  it("computes no period figure from part of the histories", () => {
    const summary = run([buy("2025-01-01", "1", "100", BTC)], {
      noHistory: true,
    });

    expect(summary.period.pending).toBe(true);
    expect(summary.period.chart).toEqual([]);
    expect(summary.period.gain).toBeNull();
    // Today's figures do not wait for the histories.
    expect(summary.total.toString()).toBe("130");
  });

  it("starts the period on the first day every held coin has a price", () => {
    // Bought a day before Bitcoin's history begins.
    const summary = run([buy("2024-12-31", "1", "90", BTC)]);

    expect(summary.period.from).toBe("2025-01-01");
    expect(summary.period.shortened).toBe(true);
    expect(summary.period.gain?.toString()).toBe("30");
  });

  it("says so when the portfolio is younger than the period", () => {
    const summary = run([buy("2025-01-03", "1", "120", BTC)], {
      period: "1W",
    });

    expect(summary.period.from).toBe("2025-01-03");
    expect(summary.period.shortened).toBe(true);
  });
});
