import { describe, expect, it } from "vitest";
import { computePositions } from "../../../shared/metrics/positions.ts";
import { valuePositions } from "../../../shared/metrics/valuation.ts";
import { decimal } from "../../../shared/money/decimal.ts";
import { buy, entries, sell, USD, usdWithRates } from "./fixtures.ts";

const DATE = "2025-06-01";
const usd = (price: string) => ({ price: decimal(price), currency: "USD" });

describe("valuePositions", () => {
  const { positions } = computePositions(
    entries(
      buy("2025-01-01", "2", "100"),
      buy("2025-01-01", "10", "20", { assetId: "crypto:ethereum" }),
    ),
    USD,
  );

  it("gives value, unrealized P&L and shares that add up to one", () => {
    const { rows, total, complete } = valuePositions(positions, {
      money: USD,
      date: DATE,
      quote: (assetId) => usd(assetId === "crypto:bitcoin" ? "150" : "10"),
    });
    expect(total.toString()).toBe("400");
    expect(complete).toBe(true);
    expect(
      rows.map(({ value, unrealizedPnl, share }) => [
        value?.toString(),
        unrealizedPnl?.toString(),
        share?.toString(),
      ]),
    ).toEqual([
      // 2 × 150 against a cost of 200; 10 × 10 against a cost of 200.
      ["300", "100", "0.75"],
      ["100", "-100", "0.25"],
    ]);
  });

  it("converts a price in another currency at the rate of the date", () => {
    const { total } = valuePositions(positions.slice(0, 1), {
      money: usdWithRates({ [`EUR ${DATE}`]: "1.5" }),
      date: DATE,
      quote: () => ({ price: decimal("100"), currency: "EUR" }),
    });
    expect(total.toString()).toBe("300");
  });

  it("leaves out a position it cannot price, and says the total is partial", () => {
    const { rows, total, complete } = valuePositions(positions, {
      money: USD,
      date: DATE,
      quote: (assetId) => (assetId === "crypto:bitcoin" ? usd("150") : null),
    });
    expect(total.toString()).toBe("300");
    expect(complete).toBe(false);
    expect(rows[1]).toMatchObject({
      value: null,
      unrealizedPnl: null,
      share: null,
    });
  });

  it("does not call a missing rate a value of zero", () => {
    const { rows, complete } = valuePositions(positions.slice(0, 1), {
      money: USD,
      date: DATE,
      quote: () => ({ price: decimal("100"), currency: "EUR" }),
    });
    expect(rows[0]?.value).toBeNull();
    expect(complete).toBe(false);
  });

  it("values a closed position at zero without needing its price", () => {
    const closed = computePositions(
      entries(buy("2025-01-01", "1", "100"), sell("2025-01-02", "1", "150")),
      USD,
    ).positions;
    const { rows, complete } = valuePositions(closed, {
      money: USD,
      date: DATE,
      quote: () => {
        throw new Error("A closed position needs no price.");
      },
    });
    expect(complete).toBe(true);
    expect(rows[0]?.value?.toString()).toBe("0");
    expect(rows[0]?.unrealizedPnl?.toString()).toBe("0");
    expect(rows[0]?.share?.toString()).toBe("0");
  });

  it("knows the value but not the P&L when the cost has a missing rate", () => {
    const incomplete = computePositions(
      entries(buy("2025-01-01", "1", "100", { priceCurrency: "EUR" })),
      USD,
    ).positions;
    const { rows } = valuePositions(incomplete, {
      money: USD,
      date: DATE,
      quote: () => usd("150"),
    });
    expect(rows[0]?.value?.toString()).toBe("150");
    expect(rows[0]?.unrealizedPnl).toBeNull();
  });
});
