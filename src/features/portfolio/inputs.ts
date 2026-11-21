import {
  type TransactionEntry,
  utcDate,
} from "../../../shared/metrics/ledger.ts";

/*
 * What the market data for a portfolio is asked from: the day each coin was
 * first held, and every currency its transactions are priced in. Shared by
 * the portfolio page and the chat's tools, so both ask for the same data and
 * share its cache.
 */

/** The first day each coin was held: its history is asked from then. */
export function firstDaysOf(
  records: readonly TransactionEntry[],
): Map<string, string> {
  const first = new Map<string, string>();
  for (const { value } of records) {
    const day = utcDate(value.executedAt);
    const known = first.get(value.assetId);
    if (!known || day < known) first.set(value.assetId, day);
  }
  return first;
}

/** The base currency and every currency a price or a fee is given in. */
export function currenciesOf(
  records: readonly TransactionEntry[],
  baseCurrency: string,
): string[] {
  return [
    ...new Set([
      baseCurrency,
      ...records.flatMap(({ value }): string[] => {
        switch (value.type) {
          case "buy":
          case "sell":
            return value.feeCurrency
              ? [value.priceCurrency, value.feeCurrency]
              : [value.priceCurrency];
          case "transfer_in":
          case "income":
            return [value.priceCurrency];
          default:
            return [];
        }
      }),
    ]),
  ];
}
