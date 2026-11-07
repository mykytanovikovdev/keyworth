import { decimal } from "../../../shared/money/decimal.ts";
import type {
  MoneyContext,
  TransactionEntry,
} from "../../../shared/metrics/ledger.ts";
import {
  type Transaction,
  transactionSchema,
} from "../../../shared/schemas/transaction.ts";

/*
 * Transactions for the calculation tests, through the real schema: a fixture the
 * app could not store would prove nothing.
 */

const at = (date: string) => `${date}T12:00:00Z`;

function make(fields: Record<string, unknown>): Transaction {
  return transactionSchema.parse({
    assetId: "btc",
    source: "manual",
    priceCurrency: "USD",
    ...fields,
  });
}

type Extra = Record<string, unknown>;

export const buy = (
  date: string,
  quantity: string,
  price: string,
  extra: Extra = {},
) => make({ type: "buy", executedAt: at(date), quantity, price, ...extra });

export const sell = (
  date: string,
  quantity: string,
  price: string,
  extra: Extra = {},
) => make({ type: "sell", executedAt: at(date), quantity, price, ...extra });

export const transferIn = (
  date: string,
  quantity: string,
  price: string,
  extra: Extra = {},
) =>
  make({
    type: "transfer_in",
    executedAt: at(date),
    quantity,
    price,
    ...extra,
  });

export const transferOut = (
  date: string,
  quantity: string,
  extra: Extra = {},
) => make({ type: "transfer_out", executedAt: at(date), quantity, ...extra });

export const income = (
  date: string,
  quantity: string,
  price: string,
  extra: Extra = {},
) => make({ type: "income", executedAt: at(date), quantity, price, ...extra });

export const split = (date: string, ratio: string, extra: Extra = {}) =>
  make({ type: "split", executedAt: at(date), ratio, ...extra });

/** Ids t1, t2, ... in the order given. */
export const entries = (...transactions: Transaction[]): TransactionEntry[] =>
  transactions.map((value, index) => ({ id: `t${String(index + 1)}`, value }));

/** Base currency USD; a test that asks for any rate gets none. */
export const USD: MoneyContext = { baseCurrency: "USD", rate: () => null };

/** Base currency USD, with rates given as "EUR 2025-01-01": "1.1". */
export const usdWithRates = (rates: Record<string, string>): MoneyContext => ({
  baseCurrency: "USD",
  rate: (from, _to, date) => {
    const found = rates[`${from} ${date}`];
    return found ? decimal(found) : null;
  },
});
