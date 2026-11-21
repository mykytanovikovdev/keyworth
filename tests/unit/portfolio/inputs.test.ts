import { describe, expect, it } from "vitest";
import {
  currenciesOf,
  firstDaysOf,
} from "../../../src/features/portfolio/inputs.ts";
import {
  buy,
  entries,
  income,
  sell,
  split,
  transferOut,
} from "../metrics/fixtures.ts";

/*
 * What the market data for a portfolio is asked from: the day each coin was
 * first held and the currencies its transactions use.
 */

describe("the first day of each coin", () => {
  it("is its earliest transaction, whatever the order they come in", () => {
    const records = entries(
      buy("2025-03-01", "1", "60000"),
      buy("2025-01-15", "1", "40000", { assetId: "crypto:ethereum" }),
      sell("2025-02-01", "0.5", "50000"),
      buy("2024-12-31", "1", "30000"),
    );

    expect(firstDaysOf(records)).toEqual(
      new Map([
        ["crypto:bitcoin", "2024-12-31"],
        ["crypto:ethereum", "2025-01-15"],
      ]),
    );
  });
});

describe("the currencies", () => {
  it("are the base, every price and every fee, once each", () => {
    const records = entries(
      buy("2025-01-01", "1", "60000", { priceCurrency: "EUR" }),
      sell("2025-02-01", "0.5", "70000", {
        priceCurrency: "EUR",
        fee: "1",
        feeCurrency: "GBP",
      }),
      income("2025-03-01", "0.01", "5000", { priceCurrency: "JPY" }),
    );

    expect(currenciesOf(records, "USD")).toEqual(["USD", "EUR", "GBP", "JPY"]);
  });

  it("leave out transactions that carry no price", () => {
    const records = entries(
      buy("2025-01-01", "1", "60000"),
      transferOut("2025-02-01", "0.5"),
      split("2025-03-01", "2"),
    );

    expect(currenciesOf(records, "GEL")).toEqual(["GEL", "USD"]);
  });
});
