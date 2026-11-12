import { describe, expect, it } from "vitest";
import {
  eachDay,
  type HistoryPoint,
  periodGain,
  type PriceSeries,
  portfolioHistory,
} from "../../../shared/metrics/history.ts";
import { addDays, daysBetween } from "../../../shared/metrics/ledger.ts";
import { decimal } from "../../../shared/money/decimal.ts";
import {
  buy,
  entries,
  income,
  sell,
  split,
  transferIn,
  transferOut,
  USD,
  usdWithRates,
} from "./fixtures.ts";

const series = (
  points: Record<string, string>,
  currency = "USD",
): PriceSeries => ({
  currency,
  points: Object.entries(points).map(([date, price]) => ({
    date,
    price: decimal(price),
  })),
});

const shown = ({ date, value, inflow, outflow, movedIn }: HistoryPoint) => [
  date,
  value?.toString() ?? null,
  inflow?.toString() ?? null,
  outflow?.toString() ?? null,
  movedIn?.toString() ?? null,
];

describe("days in UTC", () => {
  it("move by whole days across months, years and a daylight-saving change", () => {
    expect(addDays("2025-03-29", 3)).toBe("2025-04-01");
    expect(addDays("2025-01-03", -7)).toBe("2024-12-27");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(daysBetween("2025-03-29", "2025-04-01")).toBe(3);
    expect(daysBetween("2025-04-01", "2025-03-29")).toBe(-3);
  });
});

describe("eachDay", () => {
  it("crosses months and a daylight-saving change, both ends included", () => {
    expect(eachDay("2025-03-29", "2025-04-01")).toEqual([
      "2025-03-29",
      "2025-03-30",
      "2025-03-31",
      "2025-04-01",
    ]);
  });
});

describe("portfolioHistory", () => {
  const PRICES = series({
    "2025-01-01": "100",
    "2025-01-02": "110",
    "2025-01-03": "120",
    "2025-01-04": "130",
  });
  const run = (
    transactions: Parameters<typeof entries>,
    from = "2025-01-01",
    to = "2025-01-04",
    money = USD,
  ) =>
    portfolioHistory(entries(...transactions), {
      money,
      prices: () => PRICES,
      from,
      to,
    }).map(shown);

  it("values holdings each day and shows purchases and sales as money moved", () => {
    expect(
      run([
        buy("2025-01-02", "2", "105", { fee: "1" }),
        sell("2025-01-03", "1", "125", { fee: "2" }),
      ]),
    ).toEqual([
      ["2025-01-01", "0", "0", "0", "0"],
      // 2 × 110; in: 2 × 105 + 1.
      ["2025-01-02", "220", "211", "0", "0"],
      // 1 × 120; out: 125 − 2.
      ["2025-01-03", "120", "0", "123", "0"],
      ["2025-01-04", "130", "0", "0", "0"],
    ]);
  });

  it("starts from what was bought before the range, without counting it as money in", () => {
    expect(
      run([buy("2024-12-01", "1", "50")], "2025-01-01", "2025-01-02"),
    ).toEqual([
      ["2025-01-01", "100", "0", "0", "0"],
      ["2025-01-02", "110", "0", "0", "0"],
    ]);
  });

  it("stops at the end of the range", () => {
    expect(
      run([buy("2025-02-01", "1", "50")], "2025-01-01", "2025-01-01"),
    ).toEqual([["2025-01-01", "0", "0", "0", "0"]]);
  });

  it("values a transfer at the day's price, whatever cost it states", () => {
    expect(
      run(
        [transferIn("2025-01-02", "1", "1"), transferOut("2025-01-03", "1")],
        "2025-01-02",
        "2025-01-03",
      ),
    ).toEqual([
      ["2025-01-02", "110", "0", "0", "110"],
      ["2025-01-03", "0", "0", "120", "0"],
    ]);
  });

  it("treats income as earned, not as money put in", () => {
    expect(
      run(
        [buy("2025-01-01", "1", "100"), income("2025-01-02", "1", "110")],
        "2025-01-02",
        "2025-01-02",
      ),
    ).toEqual([["2025-01-02", "220", "0", "0", "0"]]);
  });

  it("follows a split in the units without money moving", () => {
    expect(
      run(
        [buy("2025-01-01", "1", "100"), split("2025-01-02", "2")],
        "2025-01-02",
        "2025-01-02",
      ),
    ).toEqual([["2025-01-02", "220", "0", "0", "0"]]);
  });

  it("counts only the held part of an oversold sale", () => {
    expect(
      run(
        [buy("2025-01-01", "1", "100"), sell("2025-01-02", "3", "90")],
        "2025-01-02",
        "2025-01-02",
      ),
    ).toEqual([["2025-01-02", "0", "0", "90", "0"]]);
  });

  it("keeps the last price across a gap in the history (a weekend)", () => {
    const history = portfolioHistory(entries(buy("2025-01-03", "1", "100")), {
      money: USD,
      prices: () => series({ "2025-01-03": "100", "2025-01-06": "130" }),
      from: "2025-01-03",
      to: "2025-01-06",
    }).map(({ date, value }) => [date, value?.toString()]);
    expect(history).toEqual([
      ["2025-01-03", "100"],
      ["2025-01-04", "100"],
      ["2025-01-05", "100"],
      ["2025-01-06", "130"],
    ]);
  });

  it("has no value before an asset's first price, or without a series", () => {
    const value = (prices: PriceSeries | null) =>
      portfolioHistory(entries(buy("2025-01-01", "1", "100")), {
        money: USD,
        prices: () => prices,
        from: "2025-01-01",
        to: "2025-01-01",
      })[0]?.value;
    expect(value(series({ "2025-01-02": "100" }))).toBeNull();
    expect(value(null)).toBeNull();
  });

  it("converts at each day's own rate, and has no value when it is missing", () => {
    const history = portfolioHistory(entries(buy("2025-01-01", "1", "100")), {
      money: usdWithRates({ "EUR 2025-01-02": "2" }),
      prices: () => series({ "2025-01-01": "100", "2025-01-02": "100" }, "EUR"),
      from: "2025-01-01",
      to: "2025-01-02",
    });
    expect(history[0]?.value).toBeNull();
    expect(history[1]?.value?.toString()).toBe("200");
  });

  it("has no money figure when a day's flow cannot be priced", () => {
    const [day] = portfolioHistory(
      entries(buy("2025-01-01", "1", "100", { priceCurrency: "EUR" })),
      {
        money: USD,
        prices: () => series({ "2025-01-01": "100" }),
        from: "2025-01-01",
        to: "2025-01-01",
      },
    );
    expect(day?.inflow).toBeNull();
    expect(day?.value?.toString()).toBe("100");
  });
});

describe("periodGain", () => {
  const PRICES = series({
    "2025-01-01": "100",
    "2025-01-02": "110",
    "2025-01-03": "120",
    "2025-01-04": "130",
  });
  const history = (transactions: Parameters<typeof entries>, money = USD) =>
    portfolioHistory(entries(...transactions), {
      money,
      prices: () => PRICES,
      from: "2025-01-01",
      to: "2025-01-04",
    });

  it("is what was made, with purchases and sales not counted as gains", () => {
    // Paid 2 × 105 + 1 = 211; got 125 − 2 = 123 back; 1 left, worth 130.
    // 123 + 130 − 211 = 42, day by day: 9, 23, 10.
    expect(
      periodGain(
        history([
          buy("2025-01-02", "2", "105", { fee: "1" }),
          sell("2025-01-03", "1", "125", { fee: "2" }),
        ]),
      )?.toString(),
    ).toBe("42");
  });

  it("counts a transfer in at its day's worth as money moved, not a gain", () => {
    // In on the 2nd at 110, whatever it cost; worth 130 on the 4th.
    expect(
      periodGain(history([transferIn("2025-01-02", "1", "1")]))?.toString(),
    ).toBe("20");
  });

  it("counts income as earned", () => {
    // Held 1 from before; 1 more arrives as income on the 3rd.
    // 100 → 110 → 240 → 260: everything is a gain.
    expect(
      periodGain(
        history([
          buy("2024-12-31", "1", "90"),
          income("2025-01-03", "1", "120"),
        ]),
      )?.toString(),
    ).toBe("160");
  });

  it("is zero for a single day, which has nothing to compare", () => {
    expect(
      periodGain(
        history([buy("2025-01-01", "1", "100")]).slice(0, 1),
      )?.toString(),
    ).toBe("0");
  });

  it("is unknown when a day cannot be priced", () => {
    const priced = history([buy("2025-01-01", "1", "100")]);
    const gap = priced.map((point, index) =>
      index === 2 ? { ...point, value: null } : point,
    );
    expect(periodGain(gap)).toBeNull();
  });
});
