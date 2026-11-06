import { type Decimal, ZERO } from "../money/decimal.ts";
import { type MoneyContext, toBase } from "./ledger.ts";
import type { Position } from "./positions.ts";

/*
 * What positions are worth today, in the base currency: their value, unrealized
 * P&L and share of the portfolio. Prices and rates come from the caller.
 */

export interface PriceQuote {
  price: Decimal;
  currency: string;
}

export interface ValuedPosition {
  position: Position;
  /** null when its price or a rate is missing. */
  value: Decimal | null;
  /** null when the value or the cost is unknown. */
  unrealizedPnl: Decimal | null;
  /** Of the known total, from 0 to 1; null when the value is unknown. */
  share: Decimal | null;
}

export interface PortfolioValue {
  rows: ValuedPosition[];
  /** The sum of the values that are known. */
  total: Decimal;
  /** False when `total` leaves out a position that is held. */
  complete: boolean;
}

export function valuePositions(
  positions: readonly Position[],
  {
    money,
    quote,
    date,
  }: {
    money: MoneyContext;
    quote: (assetId: string) => PriceQuote | null;
    /** Today, as a UTC date: which day's rates to use. */
    date: string;
  },
): PortfolioValue {
  const values = positions.map((position) => {
    // A closed position is worth nothing, whatever its asset's price.
    if (position.quantity.eq(ZERO)) return ZERO;
    const found = quote(position.assetId);
    return (
      found &&
      toBase(position.quantity.times(found.price), found.currency, date, money)
    );
  });
  const total = values.reduce<Decimal>(
    (sum, value) => (value ? sum.plus(value) : sum),
    ZERO,
  );

  return {
    total,
    complete: values.every((value) => value !== null),
    rows: positions.map((position, index): ValuedPosition => {
      const value = values[index] ?? null;
      return {
        position,
        value,
        unrealizedPnl:
          value && position.amounts
            ? value.minus(position.amounts.costBasis)
            : null,
        share: value && (total.gt(ZERO) ? value.div(total) : ZERO),
      };
    }),
  };
}
