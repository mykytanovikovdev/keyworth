import { type Decimal, decimal, ZERO } from "../money/decimal.ts";
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
 * Positions by the average cost method, from the transactions alone: nothing
 * here is stored. Rules and a worked example: docs/calculations.md.
 */

export interface PositionAmounts {
  /** What the units still held cost, in the base currency. */
  costBasis: Decimal;
  /** Cost per unit; null when nothing is held. */
  averageCost: Decimal | null;
  realizedPnl: Decimal;
  income: Decimal;
}

export interface Position {
  assetId: string;
  quantity: Decimal;
  /** null when a rate is missing: a partial sum would look like a real one. */
  amounts: PositionAmounts | null;
}

export type LedgerIssue =
  | {
      kind: "oversold";
      transactionId: string;
      assetId: string;
      /** The units it asked to move beyond what was held; they are not counted. */
      missing: Decimal;
    }
  | {
      kind: "missing-rate";
      transactionId: string;
      assetId: string;
      currency: string;
      date: string;
    };

interface Holding {
  quantity: Decimal;
  costBasis: Decimal;
  realizedPnl: Decimal;
  income: Decimal;
  complete: boolean;
}

export function computePositions(
  entries: readonly TransactionEntry[],
  money: MoneyContext,
): { positions: Position[]; issues: LedgerIssue[] } {
  const holdings = new Map<string, Holding>();
  const issues: LedgerIssue[] = [];

  for (const { id, value: transaction } of inOrder(entries)) {
    const { assetId } = transaction;
    const date = utcDate(transaction.executedAt);
    const holding = holdings.get(assetId) ?? {
      quantity: ZERO,
      costBasis: ZERO,
      realizedPnl: ZERO,
      income: ZERO,
      complete: true,
    };
    holdings.set(assetId, holding);
    const missingRate = (currency: string) => {
      holding.complete = false;
      issues.push({
        kind: "missing-rate",
        transactionId: id,
        assetId,
        currency,
        date,
      });
    };

    const before = holding.quantity;
    const { quantity, counted } = applyQuantity(before, transaction);
    // The cost that leaves with the counted units. All of it when they are all
    // that was held, so a closed position has a cost of exactly zero.
    const costOfCounted = () =>
      counted.eq(before)
        ? holding.costBasis
        : holding.costBasis.times(counted).div(before);

    switch (transaction.type) {
      case "buy": {
        const { gross, fee, feeCurrency } = tradeAmounts(
          transaction,
          counted,
          money,
        );
        if (!gross) missingRate(transaction.priceCurrency);
        if (!fee) missingRate(feeCurrency);
        if (gross && fee) {
          holding.costBasis = holding.costBasis.plus(gross).plus(fee);
        }
        break;
      }
      case "sell": {
        if (counted.lt(decimal(transaction.quantity))) {
          issues.push({
            kind: "oversold",
            transactionId: id,
            assetId,
            missing: decimal(transaction.quantity).minus(counted),
          });
        }
        if (counted.eq(ZERO)) break;
        const { gross, fee, feeCurrency } = tradeAmounts(
          transaction,
          counted,
          money,
        );
        if (!gross) missingRate(transaction.priceCurrency);
        if (!fee) missingRate(feeCurrency);
        const cost = costOfCounted();
        if (gross && fee) {
          holding.realizedPnl = holding.realizedPnl
            .plus(gross)
            .minus(fee)
            .minus(cost);
        }
        holding.costBasis = holding.costBasis.minus(cost);
        break;
      }
      case "transfer_out": {
        if (counted.lt(decimal(transaction.quantity))) {
          issues.push({
            kind: "oversold",
            transactionId: id,
            assetId,
            missing: decimal(transaction.quantity).minus(counted),
          });
        }
        if (counted.eq(ZERO)) break;
        holding.costBasis = holding.costBasis.minus(costOfCounted());
        break;
      }
      case "transfer_in":
      case "income": {
        const worth = toBase(
          counted.times(decimal(transaction.price)),
          transaction.priceCurrency,
          date,
          money,
        );
        if (!worth) {
          missingRate(transaction.priceCurrency);
          break;
        }
        holding.costBasis = holding.costBasis.plus(worth);
        if (transaction.type === "income") {
          holding.income = holding.income.plus(worth);
        }
        break;
      }
      case "split":
        // The same money across more or fewer units.
        break;
    }
    holding.quantity = quantity;
  }

  const positions = [...holdings].map(([assetId, holding]): Position => ({
    assetId,
    quantity: holding.quantity,
    amounts: holding.complete
      ? {
          costBasis: holding.costBasis,
          averageCost: holding.quantity.gt(ZERO)
            ? holding.costBasis.div(holding.quantity)
            : null,
          realizedPnl: holding.realizedPnl,
          income: holding.income,
        }
      : null,
  }));
  return { positions, issues };
}
