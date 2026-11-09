import { queryOptions } from "@tanstack/react-query";
import type { PriceSeries } from "../../../shared/metrics/history.ts";
import type { RateLookup } from "../../../shared/metrics/ledger.ts";
import type { PriceQuote } from "../../../shared/metrics/valuation.ts";
import { type Decimal, decimal } from "../../../shared/money/decimal.ts";
import {
  type DailySeriesJson,
  type HistoryJson,
  MARKET_LIMITS,
  type PricesJson,
  type RatesJson,
} from "../../../shared/schemas/market.ts";
import { getJson, valueOn } from "../transactions/market.ts";

/*
 * The portfolio's market data, from Keyworth's own server, turned into what
 * shared/metrics takes: quotes, daily price series and a rate lookup. Every
 * request names coins or currencies the user holds, so all of it is cached
 * under ["vault", …], which the app clears when the vault locks.
 */

const THIRTY_MINUTES = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ONE = decimal("1");

export const dayBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** A coin's daily closes in US dollars from `from`; yesterday is the latest. */
export const historyQuery = (userId: string, assetId: string, from: string) =>
  queryOptions({
    queryKey: ["vault", userId, "history", assetId, from],
    queryFn: () =>
      getJson<HistoryJson>(
        `/api/market/history?asset=${encodeURIComponent(assetId)}&from=${from}`,
      ),
    staleTime: THIRTY_MINUTES,
  });

/** Units of each currency per US dollar, day by day, ten currencies a request. */
export const ratesQuery = (
  userId: string,
  codes: readonly string[],
  from: string,
) => {
  const asked = [...new Set(codes)].filter((code) => code !== "USD").sort();
  return queryOptions({
    queryKey: ["vault", userId, "rates", from, ...asked],
    queryFn: async () => {
      const rates: Record<string, DailySeriesJson> = {};
      for (
        let start = 0;
        start < asked.length;
        start += MARKET_LIMITS.quotesPerRequest
      ) {
        const chunk = asked.slice(
          start,
          start + MARKET_LIMITS.quotesPerRequest,
        );
        const answer = await getJson<RatesJson>(
          `/api/market/rates?quotes=${encodeURIComponent(chunk.join(","))}&from=${from}`,
        );
        Object.assign(rates, answer.rates);
      }
      return rates;
    },
    enabled: asked.length > 0,
    staleTime: THIRTY_MINUTES,
  });
};

/**
 * One unit of `from` in `to` on a day, through the dollar: the server gives
 * each currency per dollar. A weekend or a rate not yet published uses the
 * last one before it; a day before a series begins has none.
 */
export function rateLookup(rates: Record<string, DailySeriesJson>): RateLookup {
  const perDollar = (code: string, date: string): Decimal | null => {
    if (code === "USD") return ONE;
    const value = valueOn(rates[code], date);
    return value === null ? null : decimal(value);
  };
  return (from, to, date) => {
    if (from === to) return ONE;
    const fromPerDollar = perDollar(from, date);
    const toPerDollar = perDollar(to, date);
    if (!fromPerDollar || !toPerDollar || fromPerDollar.eq("0")) return null;
    return toPerDollar.div(fromPerDollar);
  };
}

/**
 * A history as dated points, with today's price added: the server's latest
 * close is yesterday's, and the portfolio is worth today's.
 */
export function priceSeries(
  history: HistoryJson,
  today?: { date: string; price: string },
): PriceSeries {
  const start = Date.parse(`${history.prices.from}T00:00:00Z`);
  const points = history.prices.values.flatMap((value, index) =>
    value === null
      ? []
      : [
          {
            date: new Date(start + index * DAY_MS).toISOString().slice(0, 10),
            price: decimal(value),
          },
        ],
  );
  const last = points.at(-1);
  if (today && (!last || last.date < today.date)) {
    points.push({ date: today.date, price: decimal(today.price) });
  }
  return { currency: history.currency, points };
}

/** Today's price of a coin, from the shared snapshot or the coins asked by id. */
export function quoteLookup(
  ...answers: (PricesJson | undefined)[]
): (assetId: string) => PriceQuote | null {
  const prices = new Map<string, string>();
  for (const answer of answers) {
    for (const quote of answer?.quotes ?? []) prices.set(quote.id, quote.price);
  }
  return (assetId) => {
    const price = prices.get(assetId);
    return price === undefined
      ? null
      : { price: decimal(price), currency: "USD" };
  };
}
