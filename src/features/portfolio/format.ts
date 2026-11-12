import type { Decimal } from "../../../shared/money/decimal.ts";
import { money as moneyText } from "../transactions/format.ts";
import type { Period } from "./summary.ts";

/*
 * How the portfolio's figures read: money in the base currency with cents, a
 * sign on every change, and percentages with one decimal.
 */

export const HIDDEN = "••••••";

/** "$48,210.55": two decimals, in the base currency. */
export const money = (amount: Decimal, currency: string) =>
  moneyText(amount.toFixed(2), currency);

/** "+$1,943.10" or "−$412.80". */
export function signedMoney(amount: Decimal, currency: string): string {
  const text = money(amount.abs(), currency);
  if (amount.eq("0")) return text;
  return `${amount.gt("0") ? "+" : "−"}${text}`;
}

const PERCENT = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "4.2%". */
export const percent = (ratio: number) => PERCENT.format(ratio);

/** "+4.2%" or "−3.1%"; "0.0%" when it rounds to nothing. */
export function signedPercent(ratio: number): string {
  const text = PERCENT.format(Math.abs(ratio));
  if (text === PERCENT.format(0)) return text;
  return `${ratio > 0 ? "+" : "−"}${text}`;
}

// One format per currency and precision, kept: a chart asks for every tick.
const compactFormats = new Map<string, Intl.NumberFormat>();

/** "$48.2K": axis ticks, where every digit would crowd the chart. */
export function compactMoney(amount: number, currency: string): string {
  const digits = amount !== 0 && Math.abs(amount) < 1000 ? 2 : 1;
  const key = `${currency} ${String(digits)}`;
  let format = compactFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: "compact",
      maximumFractionDigits: digits,
    });
    compactFormats.set(key, format);
  }
  return format.format(amount);
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const FULL_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);

/** Under the chart: "Oct 1" within three months, "Oct 2025" beyond. */
export const axisDate = (date: string, period: Period) =>
  (period === "1Y" || period === "All" ? MONTH_YEAR : MONTH_DAY).format(
    atNoon(date),
  );

/** In the hover box: "Oct 1, 2025". */
export const fullDate = (date: string) => FULL_DAY.format(atNoon(date));

/**
 * "past month", "since Sep 2025": what a period's figures cover. A portfolio
 * younger than the period says when it started: "since Oct 12, 2026", "today".
 */
export function periodWords(
  period: Period,
  {
    from,
    shortened,
    today,
  }: { from: string; shortened: boolean; today: string },
): string {
  if (from === today) return "today";
  if (shortened) return `since ${fullDate(from)}`;
  switch (period) {
    case "1W":
      return "past week";
    case "1M":
      return "past month";
    case "3M":
      return "past 3 months";
    case "1Y":
      return "past year";
    case "All":
      return `since ${MONTH_YEAR.format(atNoon(from))}`;
  }
}
