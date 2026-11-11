import {
  periodGain,
  portfolioHistory,
  type PriceSeries,
} from "../../../shared/metrics/history.ts";
import {
  addDays,
  inOrder,
  type MoneyContext,
  type TransactionEntry,
  utcDate,
} from "../../../shared/metrics/ledger.ts";
import {
  computePositions,
  type LedgerIssue,
} from "../../../shared/metrics/positions.ts";
import {
  growthIndex,
  maxDrawdown,
  periodReturn,
  timeWeightedReturns,
  volatility,
} from "../../../shared/metrics/risk.ts";
import {
  type PriceQuote,
  valuePositions,
} from "../../../shared/metrics/valuation.ts";
import { type Decimal, toNumber, ZERO } from "../../../shared/money/decimal.ts";

/*
 * What the portfolio page shows, from the decrypted transactions, today's
 * quotes and each held asset's daily history. Every figure comes from
 * shared/metrics; this file only picks the period and puts them together.
 */

export const PERIODS = ["1W", "1M", "3M", "1Y", "All"] as const;
export type Period = (typeof PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<Period, "All">, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

/** Five data colors; a sixth asset and beyond share the neutral "Other". */
export const SERIES_SLOTS = 5;
export type SeriesSlot = 1 | 2 | 3 | 4 | 5;

export interface Holding {
  assetId: string;
  quantity: Decimal;
  /** Today's price in its own currency; null when unknown. */
  price: PriceQuote | null;
  /** In the base currency; null when its price or a rate is unknown. */
  value: Decimal | null;
  averageCost: Decimal | null;
  unrealizedPnl: Decimal | null;
  /** Of the cost of what is held: 0.1 is 10%. */
  unrealizedReturn: number | null;
  /** Of the known total, from 0 to 1. */
  share: number | null;
}

export interface AllocationItem {
  /** An asset id, or "other". */
  id: string;
  share: number;
  /** null for "Other". */
  slot: SeriesSlot | null;
}

export interface PortfolioSummary {
  total: Decimal;
  /** False when the total leaves out an asset that is held. */
  complete: boolean;
  holdings: Holding[];
  allocation: AllocationItem[];
  /** Realized and unrealized, all time; null when part of it is unknown. */
  allTimeProfit: Decimal | null;
  /** Staking, interest, airdrops: worth when received. */
  income: Decimal | null;
  period: {
    from: string;
    /** Today. */
    to: string;
    /**
     * The period starts later than asked: at the first transaction, or at the
     * first day every held coin has a price (CoinGecko keeps one year).
     */
    shortened: boolean;
    /** Histories are still loading: no period figure yet. */
    pending: boolean;
    /** The portfolio's value each day of the period that can be priced. */
    chart: { date: string; value: number }[];
    /** Money gained or lost; buying and selling are not gains. */
    gain: Decimal | null;
    /** Time-weighted: 0.042 is 4.2%. */
    return: number | null;
    /** -0.084 is 8.4% down from a peak. */
    maxDrawdown: number | null;
    /** Annualized. */
    volatility: number | null;
  };
  issues: LedgerIssue[];
}

/** The period's first day: never before the first transaction. */
export function periodStart(
  period: Period,
  firstDate: string,
  today: string,
): string {
  if (period === "All") return firstDate;
  const start = addDays(today, -PERIOD_DAYS[period]);
  return start < firstDate ? firstDate : start;
}

/**
 * Colors follow the asset, never its rank: the largest holdings get a slot in
 * the order they were first bought, so a change in value does not repaint them.
 */
export function allocationOf(
  holdings: readonly Holding[],
  firstSeen: readonly string[],
): AllocationItem[] {
  const valued = holdings
    .filter((holding) => holding.share !== null && holding.share > 0)
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  // Five colors for the largest; the rest share the neutral "Other".
  const shown = valued.slice(0, SERIES_SLOTS);
  const rest = valued.slice(shown.length);
  const slotOrder = [...shown].sort(
    (a, b) => firstSeen.indexOf(a.assetId) - firstSeen.indexOf(b.assetId),
  );
  const items: AllocationItem[] = shown.map((holding) => ({
    id: holding.assetId,
    share: holding.share ?? 0,
    slot: (slotOrder.indexOf(holding) + 1) as SeriesSlot,
  }));
  if (rest.length > 0) {
    items.push({
      id: "other",
      share: rest.reduce((sum, holding) => sum + (holding.share ?? 0), 0),
      slot: null,
    });
  }
  return items;
}

export function summarize(
  entries: readonly TransactionEntry[],
  {
    money,
    quote,
    history,
    period,
    today,
  }: {
    money: MoneyContext;
    /** Today's price of an asset; null when unknown. */
    quote: (assetId: string) => PriceQuote | null;
    /**
     * An asset's daily closes, null when unknown; null instead of a function
     * while histories load, so no period figure is computed from part of them.
     */
    history: ((assetId: string) => PriceSeries | null) | null;
    period: Period;
    /** YYYY-MM-DD in UTC. */
    today: string;
  },
): PortfolioSummary {
  const { positions, issues } = computePositions(entries, money);
  const valued = valuePositions(positions, { money, quote, date: today });

  const holdings: Holding[] = valued.rows
    .filter(({ position }) => position.quantity.gt(ZERO))
    .map(({ position, value, unrealizedPnl, share }) => {
      const cost = position.amounts?.costBasis;
      return {
        assetId: position.assetId,
        quantity: position.quantity,
        price: quote(position.assetId),
        value,
        averageCost: position.amounts?.averageCost ?? null,
        unrealizedPnl,
        unrealizedReturn:
          unrealizedPnl && cost?.gt(ZERO)
            ? toNumber(unrealizedPnl.div(cost))
            : null,
        share: share && toNumber(share),
      };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

  // A coin with no price today is listed, but its unknown unrealized profit is
  // left out of the total and of every figure below, as a notice says: one
  // missing price must not blank the whole page. What it already realized is
  // known and counts. Rates missing for a transaction still make a figure
  // unknown.
  let allTimeProfit: Decimal | null = ZERO;
  let income: Decimal | null = ZERO;
  for (const { position, unrealizedPnl } of valued.rows) {
    const held = position.quantity.gt(ZERO);
    const amounts = position.amounts;
    income = income && amounts && income.plus(amounts.income);
    allTimeProfit =
      allTimeProfit &&
      amounts &&
      allTimeProfit
        .plus(amounts.realizedPnl)
        .plus(held ? (unrealizedPnl ?? ZERO) : ZERO);
  }
  // No price at all: zeros would look like a portfolio worth nothing.
  const nothingPriced =
    holdings.length > 0 && holdings.every(({ value }) => value === null);
  if (nothingPriced) {
    allTimeProfit = null;
    income = null;
  }

  const ordered = inOrder(entries);
  const firstDate = ordered[0] ? utcDate(ordered[0].value.executedAt) : today;
  const asked = periodStart(period, firstDate, today);
  const nothing = {
    chart: [],
    gain: null,
    return: null,
    maxDrawdown: null,
    volatility: null,
  };
  const base = {
    total: valued.total,
    complete: valued.complete,
    holdings,
    allocation: allocationOf(holdings, [
      ...new Set(ordered.map(({ value }) => value.assetId)),
    ]),
    allTimeProfit,
    income,
    issues,
  };
  const shortened = period !== "All" && asked === firstDate;

  if (history === null || nothingPriced) {
    return {
      ...base,
      period: {
        from: asked,
        to: today,
        shortened,
        pending: history === null && !nothingPriced,
        ...nothing,
      },
    };
  }

  const priced = entries.filter(({ value }) => history(value.assetId) !== null);
  const all = portfolioHistory(priced, {
    money,
    prices: history,
    from: asked,
    to: today,
  });
  // Days before every held coin has a price are not the period's: a coin
  // with only a year of history moves the start, rather than blanking it.
  const firstPriced = all.findIndex(({ value }) => value !== null);
  const points = firstPriced === -1 ? [] : all.slice(firstPriced);
  const from = points[0]?.date ?? asked;
  const returns = timeWeightedReturns(points);

  return {
    ...base,
    period: {
      from,
      to: today,
      shortened: shortened || from !== asked,
      pending: false,
      ...(points.length === 0
        ? nothing
        : {
            chart: points.flatMap(({ date, value }) =>
              value ? [{ date, value: toNumber(value) }] : [],
            ),
            gain: periodGain(points),
            return: returns.length > 0 ? periodReturn(returns) : null,
            maxDrawdown:
              returns.length > 1 ? maxDrawdown(growthIndex(returns)) : null,
            volatility: volatility(returns),
          }),
    },
  };
}
