import type {
  MoneyContext,
  TransactionEntry,
} from "../../../shared/metrics/ledger.ts";
import { computePositions } from "../../../shared/metrics/positions.ts";
import { type Decimal, decimal, ZERO } from "../../../shared/money/decimal.ts";
import {
  type Transaction,
  transactionSchema,
} from "../../../shared/schemas/transaction.ts";

/*
 * The rules every new or changed transaction meets, whichever way it comes in
 * (the form, the chat, a CSV file). Pure: the service applies them before it
 * encrypts anything.
 */

/** A trade's clock may run a little ahead of this device's. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

export type TransactionProblem =
  /** It does not fit the schema; the paths name the fields. */
  | { kind: "invalid"; fields: string[] }
  | { kind: "in-the-future" }
  /**
   * A sale or a transfer out, this one or a later one, would move more units
   * than were held at its moment.
   */
  | {
      kind: "oversold";
      transactionId: string;
      assetId: string;
      executedAt: string;
      /** Units it moves. */
      asked: string;
      /** Units held just before it. */
      held: string;
    }
  /** The record was changed or deleted on another device since it was read. */
  | { kind: "changed-elsewhere" };

/** The value as a transaction, or why it is not one. */
export function parseTransaction(
  value: unknown,
  now: number,
): { value: Transaction } | { problem: TransactionProblem } {
  const parsed = transactionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      problem: {
        kind: "invalid",
        fields: [
          ...new Set(parsed.error.issues.map(({ path }) => path.join("."))),
        ],
      },
    };
  }
  if (Date.parse(parsed.data.executedAt) > now + FUTURE_TOLERANCE_MS) {
    return { problem: { kind: "in-the-future" } };
  }
  return { value: parsed.data };
}

// Only quantities matter here: no amount is converted.
const NO_RATES: MoneyContext = { baseCurrency: "USD", rate: () => null };

function shortfalls(entries: readonly TransactionEntry[]) {
  const short = new Map<string, Decimal>();
  for (const issue of computePositions(entries, NO_RATES).issues) {
    if (issue.kind === "oversold")
      short.set(issue.transactionId, issue.missing);
  }
  return short;
}

/**
 * Sales and transfers out that a change leaves short, or shorter than they
 * were. One already short before (an import, say) may stay as it is: refusing
 * every change until it is fixed would block fixing it.
 */
export function ledgerProblems(
  before: readonly TransactionEntry[],
  after: readonly TransactionEntry[],
): TransactionProblem[] {
  const was = shortfalls(before);
  const problems: TransactionProblem[] = [];
  for (const [id, missing] of shortfalls(after)) {
    const earlier = was.get(id);
    if (earlier && !missing.gt(earlier)) continue;
    const transaction = after.find((entry) => entry.id === id)?.value;
    if (
      !transaction ||
      (transaction.type !== "sell" && transaction.type !== "transfer_out")
    ) {
      continue;
    }
    problems.push({
      kind: "oversold",
      transactionId: id,
      assetId: transaction.assetId,
      executedAt: transaction.executedAt,
      asked: transaction.quantity,
      held: decimal(transaction.quantity).minus(missing).toString(),
    });
  }
  return problems;
}

/**
 * Units of a coin held at a moment, as a sale or a transfer out then would
 * find them: every transaction up to that moment counts, except `leaving`,
 * the one being edited (its own quantity is what the user is choosing).
 * Oversold earlier sales count only what was held, as everywhere else.
 */
export function heldAt(
  entries: readonly TransactionEntry[],
  assetId: string,
  executedAt: string,
  leaving?: string,
): Decimal {
  const moment = Date.parse(executedAt);
  const before = entries.filter(
    ({ id, value }) =>
      id !== leaving &&
      value.assetId === assetId &&
      Date.parse(value.executedAt) <= moment,
  );
  return (
    computePositions(before, NO_RATES).positions.find(
      (position) => position.assetId === assetId,
    )?.quantity ?? decimal("0")
  );
}

/**
 * The coins held now, more than zero of each, leaving out `leaving` (the
 * transaction being edited): the only coins a sale or a transfer out can take
 * from, on any day. With none of a coin left today, taking some out earlier
 * leaves a later sale or transfer short, and `ledgerProblems` refuses that.
 */
export function heldNow(
  entries: readonly TransactionEntry[],
  leaving?: string,
): Map<string, Decimal> {
  const held = new Map<string, Decimal>();
  const counted = entries.filter(({ id }) => id !== leaving);
  for (const position of computePositions(counted, NO_RATES).positions) {
    if (position.quantity.gt(ZERO))
      held.set(position.assetId, position.quantity);
  }
  return held;
}
