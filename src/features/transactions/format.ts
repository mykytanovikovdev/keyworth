import { decimal } from "../../../shared/money/decimal.ts";

/*
 * How transactions read on screen: dates in words, amounts with every digit
 * they have. Numbers stay strings until here, so a quantity with 18 decimal
 * places is shown as typed, not as a float would round it.
 */

const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});
const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "December 20, 2025": the date a user confirms (YYYY-MM-DD or ISO, UTC). */
export const dateInWords = (iso: string) =>
  LONG_DATE.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));

/** "Dec 20, 2025": for lists. */
export const shortDate = (iso: string) => SHORT_DATE.format(new Date(iso));

/** Plain digits with thousands separated: "60000.03" → "60,000.03". */
export function groupDigits(plain: string): string {
  const [whole = "", fraction] = plain.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** A quantity of a coin: "0.5 BTC". */
export const quantity = (amount: string, symbol: string) =>
  `${groupDigits(amount)} ${symbol}`;

// A currency's symbol, found once: building a number format for every amount
// on a list of thousands is what a long list would spend its time on.
const symbols = new Map<string, string | undefined>();
function symbolOf(currency: string): string | undefined {
  if (!symbols.has(currency)) {
    symbols.set(
      currency,
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value,
    );
  }
  return symbols.get(currency);
}

/**
 * An amount in a currency: "$60,000.03", "€1,250.00", "1,000.00 USDT".
 * Two decimals at least, every decimal it has beyond them.
 */
export function money(amount: string, currency: string): string {
  const value = decimal(amount);
  const decimals = Math.max(2, amount.split(".")[1]?.length ?? 0);
  const plain = value.toFixed(decimals);
  if (currency.length !== 3) return `${groupDigits(plain)} ${currency}`;
  const symbol = symbolOf(currency);
  return symbol && symbol !== currency
    ? `${symbol}${groupDigits(plain)}`
    : `${groupDigits(plain)} ${currency}`;
}
