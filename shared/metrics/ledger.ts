import { type Decimal, decimal, ZERO } from "../money/decimal.ts";
import type { Transaction } from "../schemas/transaction.ts";

/*
 * What every calculation here shares: the order of transactions, what each does
 * to a holding, and turning amounts into the base currency.
 */

/** A transaction and its record's id; a vault record that is not damaged fits. */
export interface TransactionEntry {
  id: string;
  value: Transaction;
}

/** One unit of `from` in `to` on a UTC date (YYYY-MM-DD), or null when unknown. */
export type RateLookup = (
  from: string,
  to: string,
  date: string,
) => Decimal | null;

export interface MoneyContext {
  baseCurrency: string;
  rate: RateLookup;
}

export type Trade = Extract<Transaction, { type: "buy" | "sell" }>;

/** Which day a transaction belongs to, wherever the user is. */
export function utcDate(executedAt: string): string {
  return executedAt.slice(0, 10);
}

/** Milliseconds in a UTC day: UTC has no daylight-saving changes. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC date `days` after `date` (`days` below 0: before it). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Whole days from the UTC date `from` to `date`, below 0 when it is earlier. */
export function daysBetween(from: string, date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_MS,
  );
}

export function toBase(
  amount: Decimal,
  currency: string,
  date: string,
  { baseCurrency, rate }: MoneyContext,
): Decimal | null {
  if (currency === baseCurrency) return amount;
  const found = rate(currency, baseCurrency, date);
  return found && amount.times(found);
}

// At the same moment, what adds comes before what takes away: a form that keeps
// only dates must not make a same-day purchase and sale look oversold.
const SAME_MOMENT_ORDER: Record<Transaction["type"], number> = {
  buy: 0,
  transfer_in: 0,
  income: 0,
  split: 1,
  sell: 2,
  transfer_out: 2,
};

export function inOrder(
  entries: readonly TransactionEntry[],
): TransactionEntry[] {
  return [...entries].sort((a, b) => {
    const byTime =
      Date.parse(a.value.executedAt) - Date.parse(b.value.executedAt);
    if (byTime !== 0) return byTime;
    const byType =
      SAME_MOMENT_ORDER[a.value.type] - SAME_MOMENT_ORDER[b.value.type];
    if (byType !== 0) return byType;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * The holding after a transaction, and how many units it moved. A reduction
 * moves only what was held: `counted` is smaller than asked when oversold.
 */
export function applyQuantity(
  held: Decimal,
  transaction: Transaction,
): { quantity: Decimal; counted: Decimal } {
  switch (transaction.type) {
    case "buy":
    case "transfer_in":
    case "income": {
      const counted = decimal(transaction.quantity);
      return { quantity: held.plus(counted), counted };
    }
    case "sell":
    case "transfer_out": {
      const asked = decimal(transaction.quantity);
      const counted = asked.gt(held) ? held : asked;
      return { quantity: held.minus(counted), counted };
    }
    case "split":
      return {
        quantity: held.times(decimal(transaction.ratio)),
        counted: ZERO,
      };
  }
}

/** What a trade's counted units came to and its fee for them, in the base currency. */
export function tradeAmounts(
  trade: Trade,
  counted: Decimal,
  money: MoneyContext,
): { gross: Decimal | null; fee: Decimal | null; feeCurrency: string } {
  const date = utcDate(trade.executedAt);
  const feeCurrency = trade.feeCurrency ?? trade.priceCurrency;
  return {
    gross: toBase(
      counted.times(decimal(trade.price)),
      trade.priceCurrency,
      date,
      money,
    ),
    feeCurrency,
    fee: trade.fee
      ? toBase(
          // An oversold trade pays only its counted part's share of the fee.
          decimal(trade.fee).times(counted).div(decimal(trade.quantity)),
          feeCurrency,
          date,
          money,
        )
      : ZERO,
  };
}
