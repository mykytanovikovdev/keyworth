import { describe, expect, it } from "vitest";
import type { PriceSeries } from "../../../shared/metrics/history.ts";
import {
  addDays,
  type MoneyContext,
  type TransactionEntry,
} from "../../../shared/metrics/ledger.ts";
import { decimal } from "../../../shared/money/decimal.ts";
import type { ChatData } from "../../../src/features/chat/chat-data.ts";
import { stepWords } from "../../../src/features/chat/step-words.ts";
import { chatTools } from "../../../src/features/chat/tools.ts";
import { summarize } from "../../../src/features/portfolio/summary.ts";
import { buy, entries, sell, transferOut, USD } from "../metrics/fixtures.ts";

/*
 * The chat's tools on made-up data: the numbers they hand the model, and what
 * they keep back. Without `includeAmounts` no money value, quantity or note
 * may reach the model (CLAUDE.md, rule 5).
 */

const TODAY = "2026-11-21";

/** A price a day for the last `days` days, from `start` by `step` a day. */
function rising(
  start: number,
  step: number,
  days = 120,
): Record<string, number> {
  const prices: Record<string, number> = {};
  for (let day = days; day >= 0; day--) {
    prices[addDays(TODAY, -day)] = start + step * (days - day);
  }
  return prices;
}

function fakeData(
  records: TransactionEntry[],
  markets: Record<string, Record<string, number>>,
  money: MoneyContext = USD,
): ChatData {
  const seriesOf = (assetId: string): PriceSeries | null => {
    const prices = markets[assetId];
    return prices
      ? {
          currency: "USD",
          points: Object.entries(prices).map(([date, price]) => ({
            date,
            price: decimal(String(price)),
          })),
        }
      : null;
  };
  const quote = (assetId: string) => {
    const today = markets[assetId]?.[TODAY];
    return today === undefined
      ? null
      : { price: decimal(String(today)), currency: "USD" };
  };
  return {
    records,
    baseCurrency: money.baseCurrency,
    today: TODAY,
    money,
    quote,
    assetOf: (assetId) => {
      const name = (assetId.split(":")[1] ?? assetId).toUpperCase();
      return { id: assetId, symbol: name.slice(0, 3), name };
    },
    summary: (period) =>
      Promise.resolve(
        summarize(records, {
          money,
          quote,
          history: seriesOf,
          period,
          today: TODAY,
        }),
      ),
    history: (assetId) => Promise.resolve(seriesOf(assetId)),
    quotes: () => Promise.resolve(),
  };
}

const RECORDS = entries(
  buy(addDays(TODAY, -100), "0.5", "60000", { note: "From my salary" }),
  buy(addDays(TODAY, -90), "4", "3000", {
    assetId: "crypto:ethereum",
    fee: "2.5",
  }),
  sell(addDays(TODAY, -20), "1", "3300", { assetId: "crypto:ethereum" }),
  transferOut(addDays(TODAY, -10), "0.1"),
);

// Bitcoin: 69,000 a month ago, 63,000 three months ago, 72,000 today
// (+4.35%, +14.29%). Ethereum: 2,820 a month ago, 2,760 today (−2.13%),
// falling every day, so its largest drop is the whole change. Held today:
// 0.4 BTC (28,800) and 3 ETH (8,280), 37,080 in all: shares 77.67% and 22.33%.
const MARKETS = {
  "crypto:bitcoin": rising(60000, 100),
  "crypto:ethereum": rising(3000, -2),
};

/** A tool's result, as the model would get it (no streamed results here). */
async function run<INPUT, OUTPUT>(
  execute:
    | ((
        input: INPUT,
        options: never,
      ) => OUTPUT | PromiseLike<OUTPUT> | AsyncIterable<OUTPUT>)
    | undefined,
  input: INPUT,
): Promise<OUTPUT> {
  if (!execute) throw new Error("The tool cannot run in the browser.");
  const result = await execute(input, {
    toolCallId: "call-1",
    messages: [],
  } as never);
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    throw new Error("A streamed result was not expected.");
  }
  return result;
}

const tools = chatTools(() => Promise.resolve(fakeData(RECORDS, MARKETS)));

/** Every key anywhere in a tool's result. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [
      key,
      ...keysOf(inner),
    ]);
  }
  return [];
}

const AMOUNT_KEYS = [
  "quantity",
  "value",
  "total",
  "gain",
  "averageCost",
  "unrealizedProfit",
  "allTimeProfit",
  "fee",
  "feeCurrency",
  "note",
];

describe("get_portfolio", () => {
  it("gives shares and changes, and no amount, unless asked", async () => {
    const result = await run(tools.get_portfolio.execute, { period: "1M" });
    const text = JSON.stringify(result);

    expect(keysOf(result).filter((key) => AMOUNT_KEYS.includes(key))).toEqual(
      [],
    );
    // Neither the quantities nor the user's words, under any name.
    expect(text).not.toMatch(/0\.4|"3"|salary/);
    expect(result).toMatchObject({
      period: { from: addDays(TODAY, -30), to: TODAY },
      holdings: [
        {
          id: "crypto:bitcoin",
          symbol: "BIT",
          share: 0.7767,
          change: 0.0435,
        },
        {
          id: "crypto:ethereum",
          symbol: "ETH",
          share: 0.2233,
          change: -0.0213,
        },
      ],
    });
  });

  it("adds the amounts when asked, in the base currency", async () => {
    const result = await run(tools.get_portfolio.execute, {
      period: "1M",
      includeAmounts: true,
    });

    expect(result).toMatchObject({
      currency: "USD",
      total: "37080.00",
      holdings: [
        { id: "crypto:bitcoin", quantity: "0.4", averageCost: "60000" },
        { id: "crypto:ethereum", quantity: "3" },
      ],
    });
  });

  it("says so when there are no transactions", async () => {
    const empty = chatTools(() => Promise.resolve(fakeData([], MARKETS)));

    expect(await run(empty.get_portfolio.execute, {})).toEqual({
      holdings: [],
      note: "The user has no transactions yet.",
    });
  });
});

describe("list_transactions", () => {
  it("lists days, kinds and prices, newest first, without quantities or notes", async () => {
    const result = await run(tools.list_transactions.execute, {});

    expect(keysOf(result).filter((key) => AMOUNT_KEYS.includes(key))).toEqual(
      [],
    );
    expect(JSON.stringify(result)).not.toMatch(/salary/);
    expect(result).toEqual({
      count: 4,
      transactions: [
        {
          day: addDays(TODAY, -10),
          type: "transfer_out",
          id: "crypto:bitcoin",
          symbol: "BIT",
        },
        {
          day: addDays(TODAY, -20),
          type: "sell",
          id: "crypto:ethereum",
          symbol: "ETH",
          price: "3300",
          currency: "USD",
        },
        {
          day: addDays(TODAY, -90),
          type: "buy",
          id: "crypto:ethereum",
          symbol: "ETH",
          price: "3000",
          currency: "USD",
        },
        {
          day: addDays(TODAY, -100),
          type: "buy",
          id: "crypto:bitcoin",
          symbol: "BIT",
          price: "60000",
          currency: "USD",
        },
      ],
    });
  });

  it("gives quantities and fees when asked, still no note, and filters", async () => {
    const result = await run(tools.list_transactions.execute, {
      assetId: "crypto:ethereum",
      from: addDays(TODAY, -95),
      limit: 1,
      includeAmounts: true,
    });

    expect(JSON.stringify(result)).not.toMatch(/salary|note/);
    expect(result).toEqual({
      count: 2,
      transactions: [expect.objectContaining({ type: "sell", quantity: "1" })],
    });
    const all = await run(tools.list_transactions.execute, {
      assetId: "crypto:ethereum",
      includeAmounts: true,
    });
    expect(all.transactions[1]).toMatchObject({
      type: "buy",
      quantity: "4",
      fee: "2.5",
      feeCurrency: "USD",
    });
  });
});

describe("market tools", () => {
  it("gives today's prices in the base currency, null when unknown", async () => {
    expect(
      await run(tools.get_prices.execute, {
        assetIds: ["crypto:bitcoin", "crypto:unknown"],
      }),
    ).toEqual({
      currency: "USD",
      prices: [
        { id: "crypto:bitcoin", symbol: "BIT", price: "72000" },
        { id: "crypto:unknown", symbol: "UNK", price: null },
      ],
    });
  });

  it("gives prices in the base currency, at each day's rate", async () => {
    // 0.9 euros a dollar; the rate before last week is unknown.
    const euros = chatTools(() =>
      Promise.resolve(
        fakeData(RECORDS, MARKETS, {
          baseCurrency: "EUR",
          rate: (from, to, date) =>
            from === "USD" && to === "EUR" && date >= addDays(TODAY, -7)
              ? decimal("0.9")
              : null,
        }),
      ),
    );

    expect(
      await run(euros.get_prices.execute, { assetIds: ["crypto:bitcoin"] }),
    ).toEqual({
      currency: "EUR",
      prices: [{ id: "crypto:bitcoin", symbol: "BIT", price: "64800" }],
    });
    const history = await run(euros.get_price_history.execute, {
      assetId: "crypto:bitcoin",
      period: "1M",
    });
    expect(history).toMatchObject({
      currency: "EUR",
      from: addDays(TODAY, -7),
      high: "64800",
    });
  });

  it("gives a price history in at most 30 points, its first and last kept", async () => {
    const result = await run(tools.get_price_history.execute, {
      assetId: "crypto:bitcoin",
      period: "3M",
    });

    expect(result).toMatchObject({
      from: addDays(TODAY, -90),
      to: TODAY,
      change: 0.1429,
      high: "72000",
      low: "63000",
    });
    const points = "points" in result ? result.points : [];
    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({ date: addDays(TODAY, -90), price: "63000" });
    expect(points.at(-1)).toEqual({ date: TODAY, price: "72000" });
  });

  it("compares coins: change, volatility, drawdown and correlation", async () => {
    const result = await run(tools.compare_assets.execute, {
      assetIds: ["crypto:bitcoin", "crypto:ethereum"],
      period: "1M",
    });

    expect(result).toMatchObject({
      currency: "USD",
      coins: [
        { id: "crypto:bitcoin", change: 0.0435, maxDrawdown: 0 },
        { id: "crypto:ethereum", change: -0.0213, maxDrawdown: -0.0213 },
      ],
      correlations: [{ a: "crypto:bitcoin", b: "crypto:ethereum" }],
    });
  });
});

describe("the steps line", () => {
  it("says the amounts stayed on the device unless asked for", () => {
    expect(stepWords("get_portfolio", { period: "1M" }).detail).toBe(
      "Shares and changes. Amounts stayed on this device.",
    );
    expect(stepWords("get_portfolio", { includeAmounts: true }).detail).toBe(
      "Amounts included, as you asked.",
    );
    expect(stepWords("list_transactions", {}).detail).toMatch(
      /Quantities and notes stayed on this device/,
    );
    expect(stepWords("calc_portfolio_metrics", { period: "1W" }).label).toBe(
      "Calculated the week",
    );
  });
});
