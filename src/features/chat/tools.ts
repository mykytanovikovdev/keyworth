import { tool } from "ai";
import type {
  PricePoint,
  PriceSeries,
} from "../../../shared/metrics/history.ts";
import {
  addDays,
  type MoneyContext,
  utcDate,
} from "../../../shared/metrics/ledger.ts";
import {
  correlation,
  growthIndex,
  maxDrawdown,
  periodReturn,
  priceReturns,
  volatility,
} from "../../../shared/metrics/risk.ts";
import {
  type Decimal,
  decimal,
  toNumber,
} from "../../../shared/money/decimal.ts";
import { CHAT_TOOLS } from "../../../shared/schemas/chat-tools.ts";
import { type Period, periodStart } from "../portfolio/summary.ts";
import { searchCoins } from "../transactions/market.ts";
import type { ChatData } from "./chat-data.ts";

/*
 * The chat's tools, run in the browser on the decrypted data: thin wrappers
 * around what the portfolio and transactions pages already compute
 * (`summarize`, shared/metrics). The model only explains the numbers they
 * return (CLAUDE.md, rule 7).
 *
 * Minimization (rule 5): shares, percentages, changes and market prices by
 * default. Money values and quantities only with `includeAmounts`, and only
 * when the question itself asks for them (amounts.ts): the model is told so too,
 * but does not always keep to it. Notes, which are the user's own words, never
 * go to the model.
 */

const ONE = decimal("1");

/** A coin's prices without a transaction to start from: a year back. */
const COIN_DAYS = 365;
/** Points of a price history the model gets: enough to describe its shape. */
const HISTORY_POINTS = 30;
const SEARCH_RESULTS = 8;
const DEFAULT_TRANSACTIONS = 20;

/** 0.04213 → 0.0421: four places are enough for a percentage to one decimal. */
const ratio = (value: number | null | undefined): number | null =>
  value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value * 10_000) / 10_000;

const money = (amount: Decimal | null | undefined): string | null =>
  amount ? amount.toFixed(2) : null;

/** Six significant digits: a coin can be worth a fraction of a cent. */
const price = (amount: Decimal | null | undefined): string | null =>
  amount ? String(Number(amount.toPrecision(6))) : null;

/** One unit of a currency in the base currency on a day; null when unknown. */
const rateOf = (money: MoneyContext, currency: string, date: string) =>
  currency === money.baseCurrency
    ? ONE
    : money.rate(currency, money.baseCurrency, date);

/** A price series in the base currency, leaving out days without a rate. */
function inBase(series: PriceSeries, money: MoneyContext) {
  return series.points.flatMap(({ date, price: value }): PricePoint[] => {
    const factor = rateOf(money, series.currency, date);
    return factor ? [{ date, price: value.times(factor) }] : [];
  });
}

/** A coin's prices from a day, in the base currency. */
async function pricesFrom(
  data: ChatData,
  assetId: string,
  from: string,
): Promise<PricePoint[]> {
  const series = await data.history(assetId, from);
  return series
    ? inBase(series, data.money).filter(({ date }) => date >= from)
    : [];
}

/** The change from the first point to the last. */
function changeOf(points: readonly PricePoint[]): number | null {
  return points.length < 2 ? null : periodReturn(priceReturns(points));
}

/** At most `count` points, evenly spread, the first and the last kept. */
function sample<T>(points: readonly T[], count: number): T[] {
  if (points.length <= count) return [...points];
  const step = (points.length - 1) / (count - 1);
  return Array.from(
    { length: count },
    (_, index) => points[Math.round(index * step)] as T,
  );
}

const coinStart = (data: ChatData, period: Period) =>
  periodStart(period, addDays(data.today, -COIN_DAYS), data.today);

/** The tools, reading the data afresh at each call (it is cached). */
/** In place of the amounts the model asked for and the user did not. */
export const WITHHELD =
  "Not sent: the user's latest message does not ask for amounts. Answer with shares and changes.";

export function chatTools(
  load: () => Promise<ChatData>,
  /** Whether the latest question asks for amounts. */
  amountsAsked: () => boolean,
) {
  return {
    search_asset: tool({
      ...CHAT_TOOLS.search_asset,
      execute: async ({ query }) => {
        const coins = await searchCoins(query);
        return {
          coins: coins
            .slice(0, SEARCH_RESULTS)
            .map(({ id, symbol, name }) => ({ id, symbol, name })),
        };
      },
    }),

    get_portfolio: tool({
      ...CHAT_TOOLS.get_portfolio,
      execute: async ({ period = "1M", includeAmounts: wanted = false }) => {
        const includeAmounts = wanted && amountsAsked();
        const data = await load();
        if (data.records.length === 0) {
          return { holdings: [], note: "The user has no transactions yet." };
        }
        const summary = await data.summary(period);
        const holdings = await Promise.all(
          summary.holdings.map(async (holding) => {
            const { symbol, name } = data.assetOf(holding.assetId);
            const points = await pricesFrom(
              data,
              holding.assetId,
              summary.period.from,
            );
            return {
              id: holding.assetId,
              symbol,
              name,
              share: ratio(holding.share),
              change: ratio(changeOf(points)),
              ...(includeAmounts && {
                quantity: holding.quantity.toString(),
                value: money(holding.value),
                averageCost: price(holding.averageCost),
                unrealizedProfit: money(holding.unrealizedPnl),
              }),
            };
          }),
        );
        return {
          period: {
            from: summary.period.from,
            to: summary.period.to,
            change: ratio(summary.period.return),
          },
          holdings,
          ...(wanted && !includeAmounts && { amounts: WITHHELD }),
          ...(includeAmounts && {
            currency: data.baseCurrency,
            total: money(summary.total),
            gain: money(summary.period.gain),
            allTimeProfit: money(summary.allTimeProfit),
          }),
          ...(!summary.complete && {
            note: "Some coins have no price today: they are left out of the shares.",
          }),
        };
      },
    }),

    list_transactions: tool({
      ...CHAT_TOOLS.list_transactions,
      execute: async ({
        assetId,
        from,
        to,
        limit = DEFAULT_TRANSACTIONS,
        includeAmounts: wanted = false,
      }) => {
        const includeAmounts = wanted && amountsAsked();
        const data = await load();
        const matching = data.records
          .filter(({ value }) => {
            const day = utcDate(value.executedAt);
            return (
              (assetId === undefined || value.assetId === assetId) &&
              (from === undefined || day >= from) &&
              (to === undefined || day <= to)
            );
          })
          .sort((a, b) => (a.value.executedAt < b.value.executedAt ? 1 : -1));
        return {
          count: matching.length,
          ...(wanted && !includeAmounts && { amounts: WITHHELD }),
          transactions: matching.slice(0, limit).map(({ value }) => {
            const { symbol } = data.assetOf(value.assetId);
            const base = {
              day: utcDate(value.executedAt),
              type: value.type,
              id: value.assetId,
              symbol,
            };
            switch (value.type) {
              case "buy":
              case "sell":
                return {
                  ...base,
                  price: value.price,
                  currency: value.priceCurrency,
                  ...(includeAmounts && {
                    quantity: value.quantity,
                    ...(value.fee !== undefined && {
                      fee: value.fee,
                      feeCurrency: value.feeCurrency ?? value.priceCurrency,
                    }),
                  }),
                };
              case "transfer_in":
              case "income":
                return {
                  ...base,
                  price: value.price,
                  currency: value.priceCurrency,
                  ...(includeAmounts && { quantity: value.quantity }),
                };
              case "transfer_out":
                return {
                  ...base,
                  ...(includeAmounts && { quantity: value.quantity }),
                };
              case "split":
                return { ...base, ratio: value.ratio };
            }
          }),
        };
      },
    }),

    get_prices: tool({
      ...CHAT_TOOLS.get_prices,
      execute: async ({ assetIds }) => {
        const data = await load();
        await data.quotes(assetIds);
        return {
          currency: data.baseCurrency,
          prices: assetIds.map((assetId) => {
            const quote = data.quote(assetId);
            const rate =
              quote && rateOf(data.money, quote.currency, data.today);
            return {
              id: assetId,
              symbol: data.assetOf(assetId).symbol,
              price: quote && rate ? price(quote.price.times(rate)) : null,
            };
          }),
        };
      },
    }),

    get_price_history: tool({
      ...CHAT_TOOLS.get_price_history,
      execute: async ({ assetId, period }) => {
        const data = await load();
        const points = await pricesFrom(data, assetId, coinStart(data, period));
        const { symbol } = data.assetOf(assetId);
        if (points.length === 0) {
          return { id: assetId, symbol, error: "No prices for this coin." };
        }
        const values = points.map(({ price: value }) => toNumber(value));
        return {
          id: assetId,
          symbol,
          currency: data.baseCurrency,
          from: points[0]?.date,
          to: points.at(-1)?.date,
          change: ratio(changeOf(points)),
          high: price(points[values.indexOf(Math.max(...values))]?.price),
          low: price(points[values.indexOf(Math.min(...values))]?.price),
          points: sample(points, HISTORY_POINTS).map(
            ({ date, price: value }) => ({ date, price: price(value) }),
          ),
        };
      },
    }),

    calc_portfolio_metrics: tool({
      ...CHAT_TOOLS.calc_portfolio_metrics,
      execute: async ({ period }) => {
        const data = await load();
        if (data.records.length === 0) {
          return { note: "The user has no transactions yet." };
        }
        const summary = await data.summary(period);
        const holdings = await Promise.all(
          summary.holdings.map(async (holding) => ({
            id: holding.assetId,
            symbol: data.assetOf(holding.assetId).symbol,
            share: ratio(holding.share),
            change: ratio(
              changeOf(
                await pricesFrom(data, holding.assetId, summary.period.from),
              ),
            ),
          })),
        );
        return {
          from: summary.period.from,
          to: summary.period.to,
          change: ratio(summary.period.return),
          maxDrawdown: ratio(summary.period.maxDrawdown),
          volatility: ratio(summary.period.volatility),
          holdings,
        };
      },
    }),

    compare_assets: tool({
      ...CHAT_TOOLS.compare_assets,
      execute: async ({ assetIds, period }) => {
        const data = await load();
        const from = coinStart(data, period);
        const series = await Promise.all(
          assetIds.map((assetId) => pricesFrom(data, assetId, from)),
        );
        const coins = assetIds.map((assetId, index) => {
          const points = series[index] ?? [];
          const returns = priceReturns(points);
          return {
            id: assetId,
            symbol: data.assetOf(assetId).symbol,
            change: ratio(changeOf(points)),
            volatility: ratio(volatility(returns)),
            maxDrawdown:
              returns.length === 0
                ? null
                : ratio(maxDrawdown(growthIndex(returns))),
          };
        });
        const correlations = assetIds.flatMap((a, i) =>
          assetIds.slice(i + 1).map((b, j) => ({
            a,
            b,
            value: ratio(correlation(series[i] ?? [], series[i + 1 + j] ?? [])),
          })),
        );
        return {
          currency: data.baseCurrency,
          from,
          to: data.today,
          coins,
          correlations,
        };
      },
    }),
  };
}

export type ChatTools = ReturnType<typeof chatTools>;
