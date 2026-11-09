import { type Decimal, ZERO } from "../money/decimal.ts";
import {
  applyQuantity,
  inOrder,
  type MoneyContext,
  toBase,
  tradeAmounts,
  type TransactionEntry,
  utcDate,
} from "./ledger.ts";

/*
 * The portfolio's value day by day, with the money that came in and went out.
 * Risk figures need both: a purchase raises the value without being a gain, and
 * a sale lowers it without being a loss. See docs/calculations.md.
 */

export interface PricePoint {
  /** YYYY-MM-DD in UTC. */
  date: string;
  price: Decimal;
}

export interface PriceSeries {
  currency: string;
  /** Ascending by date; it may have gaps (weekends, holidays). */
  points: readonly PricePoint[];
}

export interface HistoryPoint {
  date: string;
  /** null when a held asset has no price yet, or a rate is missing. */
  value: Decimal | null;
  /**
   * Paid for purchases that day; it earns from the start of the day. This and
   * the next two are null when part of them cannot be priced.
   */
  inflow: Decimal | null;
  /** Taken out that day, by sales and transfers; it earned until the day's end. */
  outflow: Decimal | null;
  /** Units transferred in, at the day's closing worth: they earned nothing yet. */
  movedIn: Decimal | null;
}

/** Every UTC date from `from` to `to`, both included. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (
    let day = Date.parse(`${from}T00:00:00Z`);
    day <= end;
    day += 24 * 60 * 60 * 1000
  ) {
    days.push(new Date(day).toISOString().slice(0, 10));
  }
  return days;
}

const addTo = (sum: Decimal | null, amount: Decimal | null) =>
  sum && amount && sum.plus(amount);

export function portfolioHistory(
  entries: readonly TransactionEntry[],
  {
    money,
    prices,
    from,
    to,
  }: {
    money: MoneyContext;
    prices: (assetId: string) => PriceSeries | null;
    from: string;
    to: string;
  },
): HistoryPoint[] {
  const ordered = inOrder(entries);
  const holdings = new Map<string, Decimal>();
  // How far into each series the walk has come: the days only go forward.
  const reached = new Map<string, number>();
  let next = 0;

  /** The last price at or before a day: a gap keeps the price before it. */
  const worthOn = (assetId: string, quantity: Decimal, date: string) => {
    const series = prices(assetId);
    if (!series) return null;
    let index = reached.get(assetId) ?? -1;
    for (
      let following = series.points[index + 1];
      following && following.date <= date;
      following = series.points[index + 1]
    ) {
      index++;
    }
    reached.set(assetId, index);
    const point = series.points[index];
    return point
      ? toBase(quantity.times(point.price), series.currency, date, money)
      : null;
  };

  return eachDay(from, to).map((date) => {
    let inflow: Decimal | null = ZERO;
    let outflow: Decimal | null = ZERO;
    let movedIn: Decimal | null = ZERO;

    for (; next < ordered.length; next++) {
      const transaction = ordered[next]?.value;
      if (!transaction || utcDate(transaction.executedAt) > date) break;
      const held = holdings.get(transaction.assetId) ?? ZERO;
      const { quantity, counted } = applyQuantity(held, transaction);
      holdings.set(transaction.assetId, quantity);
      // Before the range, a transaction only sets what is held.
      if (utcDate(transaction.executedAt) !== date) continue;

      switch (transaction.type) {
        case "buy": {
          const { gross, fee } = tradeAmounts(transaction, counted, money);
          // The fee is money put in that buys nothing: a small loss that day.
          inflow = addTo(inflow, addTo(gross, fee));
          break;
        }
        case "sell": {
          const { gross, fee } = tradeAmounts(transaction, counted, money);
          outflow = addTo(outflow, gross && fee ? gross.minus(fee) : null);
          break;
        }
        // At the day's price, whatever the stated cost: moving units is no gain.
        case "transfer_in":
          movedIn = addTo(movedIn, worthOn(transaction.assetId, counted, date));
          break;
        case "transfer_out":
          outflow = addTo(outflow, worthOn(transaction.assetId, counted, date));
          break;
        // Income is what the portfolio earned, not money put in.
        case "income":
        case "split":
          break;
      }
    }

    let value: Decimal | null = ZERO;
    for (const [assetId, quantity] of holdings) {
      if (quantity.gt(ZERO)) {
        value = addTo(value, worthOn(assetId, quantity, date));
      }
    }
    return { date, value, inflow, outflow, movedIn };
  });
}

/**
 * Money gained or lost over the points, with what came in and went out left
 * out: the same days and arithmetic as `timeWeightedReturns`, in money rather
 * than ratios. Null when any day cannot be priced: a gap is not a zero.
 */
export function periodGain(points: readonly HistoryPoint[]): Decimal | null {
  let gain = ZERO;
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1];
    const today = points[index];
    if (
      !before?.value ||
      !today?.value ||
      !today.inflow ||
      !today.outflow ||
      !today.movedIn
    ) {
      return null;
    }
    const start = before.value.plus(today.inflow);
    const end = today.value.plus(today.outflow).minus(today.movedIn);
    gain = gain.plus(end.minus(start));
  }
  return gain;
}
