import { describe, expect, it } from "vitest";
import {
  type PriceSeries,
  portfolioHistory,
} from "../../../shared/metrics/history.ts";
import {
  correlation,
  growthIndex,
  maxDrawdown,
  periodReturn,
  priceReturns,
  timeWeightedReturns,
  volatility,
} from "../../../shared/metrics/risk.ts";
import { decimal } from "../../../shared/money/decimal.ts";
import type { Transaction } from "../../../shared/schemas/transaction.ts";
import {
  buy,
  entries,
  sell,
  transferIn,
  transferOut,
  USD,
} from "./fixtures.ts";

const points = (prices: Record<string, string>) =>
  Object.entries(prices).map(([date, price]) => ({
    date,
    price: decimal(price),
  }));

const returnsOf = (...values: number[]) =>
  values.map((value, index) => ({ date: String(index), value }));

const PRICES: PriceSeries = {
  currency: "USD",
  points: points({
    "2025-01-01": "100",
    "2025-01-02": "110",
    "2025-01-03": "121",
    "2025-01-04": "121",
  }),
};

function returnsFor(...transactions: Transaction[]) {
  return timeWeightedReturns(
    portfolioHistory(entries(...transactions), {
      money: USD,
      prices: () => PRICES,
      from: "2025-01-01",
      to: "2025-01-04",
    }),
  ).map(({ date, value }) => [date, Number(value.toFixed(10))]);
}

describe("timeWeightedReturns", () => {
  it("follows the price for a holding left alone", () => {
    expect(returnsFor(buy("2024-12-01", "1", "50"))).toEqual([
      ["2025-01-02", 0.1],
      ["2025-01-03", 0.1],
      ["2025-01-04", 0],
    ]);
  });

  it("does not call money put in a gain", () => {
    expect(
      returnsFor(
        buy("2025-01-01", "1", "100"),
        // Doubles the value on a day the price rose 10%: still 10%.
        buy("2025-01-03", "1", "110"),
      ),
    ).toEqual([
      ["2025-01-02", 0.1],
      ["2025-01-03", 0.1],
      ["2025-01-04", 0],
    ]);
  });

  it("does not call money taken out a loss, even selling everything", () => {
    expect(
      returnsFor(
        buy("2025-01-01", "2", "100"),
        sell("2025-01-03", "1", "121"),
        sell("2025-01-04", "1", "121"),
      ),
    ).toEqual([
      ["2025-01-02", 0.1],
      ["2025-01-03", 0.1],
      ["2025-01-04", 0],
    ]);
  });

  it("counts a purchase's own first day against what was paid", () => {
    // Paid 100 on a day that closed at 110.
    expect(returnsFor(buy("2025-01-02", "1", "100"))[0]).toEqual([
      "2025-01-02",
      0.1,
    ]);
  });

  it("charges a fee to the return", () => {
    // Paid 110 with a fee of 10 for what is worth 110 at the close.
    expect(
      returnsFor(buy("2025-01-02", "1", "100", { fee: "10" }))[0]?.[1],
    ).toBeCloseTo(0, 10);
  });

  it("is neutral to a transfer, whatever cost it states", () => {
    expect(
      returnsFor(
        buy("2025-01-01", "1", "100"),
        transferIn("2025-01-02", "1", "1"),
        transferOut("2025-01-03", "1"),
      ),
    ).toEqual([
      ["2025-01-02", 0.1],
      ["2025-01-03", 0.1],
      ["2025-01-04", 0],
    ]);
  });

  it("has no return with nothing held and nothing put in", () => {
    expect(returnsFor(buy("2025-01-04", "1", "121"))).toEqual([
      ["2025-01-04", 0],
    ]);
  });

  it("skips a day it cannot price, and the day after it", () => {
    const day = (date: string, value: string | null) => ({
      date,
      value: value === null ? null : decimal(value),
      inflow: decimal("0"),
      outflow: decimal("0"),
      movedIn: decimal("0"),
    });
    expect(
      timeWeightedReturns([
        day("1", "100"),
        day("2", null),
        day("3", "100"),
        day("4", "110"),
      ]).map(({ date }) => date),
    ).toEqual(["4"]);
  });
});

describe("drawdown through the portfolio's returns", () => {
  it("is zero when half the position is sold on a rising market", () => {
    const history = portfolioHistory(
      entries(buy("2025-01-01", "2", "100"), sell("2025-01-03", "1", "121")),
      {
        money: USD,
        prices: () => PRICES,
        from: "2025-01-01",
        to: "2025-01-04",
      },
    );
    expect(maxDrawdown(growthIndex(timeWeightedReturns(history)))).toBe(0);
  });
});

describe("periodReturn and growthIndex", () => {
  it("compound rather than add", () => {
    expect(periodReturn(returnsOf(0.1, -0.1))).toBeCloseTo(-0.01, 12);
    const index = growthIndex(returnsOf(0.1, -0.1));
    expect(index[0]).toBe(1);
    expect(index[1]).toBeCloseTo(1.1, 12);
    expect(index[2]).toBeCloseTo(0.99, 12);
  });

  it("has no change over no returns", () => {
    expect(periodReturn([])).toBe(0);
    expect(growthIndex([])).toEqual([1]);
  });
});

describe("maxDrawdown", () => {
  it("finds the deepest fall from a peak, not just the last one", () => {
    // 1.2 → 0.9 is 25% down; 1.5 → 1.2 only 20%.
    expect(maxDrawdown([1, 1.2, 0.9, 1.5, 1.2])).toBeCloseTo(-0.25, 12);
  });

  it("is zero for a series that only rises, or is empty", () => {
    expect(maxDrawdown([1, 2, 3])).toBe(0);
    expect(maxDrawdown([])).toBe(0);
  });
});

describe("volatility", () => {
  it("annualizes the sample standard deviation", () => {
    // Mean 0, sum of squares 0.001, variance 0.001 / 3; × 365 under the root.
    expect(volatility(returnsOf(0.01, -0.01, 0.02, -0.02))).toBeCloseTo(
      Math.sqrt((0.001 / 3) * 365),
      12,
    );
  });

  it("takes another number of periods for assets that do not trade every day", () => {
    expect(volatility(returnsOf(0.01, -0.01), 252)).toBeCloseTo(
      Math.sqrt(0.0002 * 252),
      12,
    );
  });

  it("is zero for steady returns, and unknown below two", () => {
    expect(volatility(returnsOf(0.01, 0.01))).toBe(0);
    expect(volatility(returnsOf(0.01))).toBeNull();
  });
});

describe("priceReturns", () => {
  it("measures between consecutive points, across a gap too", () => {
    expect(
      priceReturns(points({ a: "100", b: "110", d: "99" })).map(
        ({ date, value }) => [date, Number(value.toFixed(10))],
      ),
    ).toEqual([
      ["b", 0.1],
      ["d", -0.1],
    ]);
  });
});

describe("correlation", () => {
  const A = points({ d1: "100", d2: "110", d3: "99", d4: "110", d5: "121" });

  it("is 1 for assets that move in step, whatever their price level", () => {
    const B = points({ d1: "10", d2: "11", d3: "9.9", d4: "11", d5: "12.1" });
    expect(correlation(A, B)).toBeCloseTo(1, 10);
  });

  it("is -1 for assets that move exactly opposite", () => {
    // Returns +1%, −1%, +1%, −1% against −1%, +1%, −1%, +1%.
    const up = points({ d1: "100", d2: "101", d3: "99.99", d4: "100.9899" });
    const down = points({ d1: "100", d2: "99", d3: "99.99", d4: "98.9901" });
    expect(correlation(up, down)).toBeCloseTo(-1, 10);
  });

  it("compares only dates both have: a stock's weekend is no gap for it", () => {
    const stock = points({ fri: "100", mon: "110", tue: "121", wed: "133.1" });
    const coin = points({
      fri: "10",
      sat: "50",
      sun: "1",
      mon: "11",
      tue: "12.1",
      wed: "14.52",
    });
    // Only Fri, Mon, Tue, Wed count: returns 10%, 10%, 10% against 10%, 10%, 20%.
    // The first never moves, so there is nothing to correlate.
    expect(correlation(stock, coin)).toBeNull();
    const moving = points({ fri: "100", mon: "110", tue: "99", wed: "108.9" });
    // +10%, −10%, +10% against +10%, +10%, +20%: covariance 0.00667 over
    // the root of 0.02667 × 0.00667.
    expect(correlation(moving, coin)).toBeCloseTo(0.5, 10);
  });

  it("is unknown with too few common dates", () => {
    expect(correlation(A.slice(0, 3), A.slice(0, 3))).toBeNull();
    expect(correlation(A, points({ x: "1", y: "2", z: "3" }))).toBeNull();
  });
});
