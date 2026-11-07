import { toNumber } from "../money/decimal.ts";
import type { HistoryPoint, PricePoint } from "./history.ts";

/*
 * Statistics on returns. Returns are ratios, not sums of money, so these are
 * plain `number`s: the arithmetic on them needs no exact digits, and square
 * roots would round anyway.
 */

/** A return for a date: 0.01 is 1%. */
export interface DatedReturn {
  date: string;
  value: number;
}

/** Crypto trades every day; stocks will pass 252. */
export const CRYPTO_PERIODS_PER_YEAR = 365;

/** Below this many returns, a correlation says nothing. */
const MIN_RETURNS_FOR_CORRELATION = 3;

/** Variance below this is float noise on returns that did not change. */
const NO_VARIATION = 1e-24;

/**
 * The portfolio's own performance, day by day, with money put in or taken out
 * left out: what it was worth at the end, plus what left during the day, less
 * what was transferred in at the close, against what it started with, plus what
 * was bought. A day that cannot be priced, or the day after it, has no return.
 */
export function timeWeightedReturns(
  points: readonly HistoryPoint[],
): DatedReturn[] {
  const returns: DatedReturn[] = [];
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
      continue;
    }
    const start = before.value.plus(today.inflow);
    if (start.eq("0")) continue;
    const end = today.value.plus(today.outflow).minus(today.movedIn);
    returns.push({
      date: today.date,
      value: toNumber(end.minus(start).div(start)),
    });
  }
  return returns;
}

/** The change over the whole period: the returns compounded. */
export function periodReturn(returns: readonly DatedReturn[]): number {
  return returns.reduce((product, { value }) => product * (1 + value), 1) - 1;
}

/** Growth of 1 through the returns, starting at 1. */
export function growthIndex(returns: readonly DatedReturn[]): number[] {
  const index = [1];
  for (const { value } of returns) {
    index.push((index.at(-1) ?? 1) * (1 + value));
  }
  return index;
}

/** The deepest fall from a peak, as a negative ratio: -0.25 is 25% down. */
export function maxDrawdown(series: readonly number[]): number {
  let peak = -Infinity;
  let deepest = 0;
  for (const value of series) {
    if (value > peak) peak = value;
    if (peak > 0) deepest = Math.min(deepest, value / peak - 1);
  }
  return deepest;
}

/** Annualized: the sample standard deviation of the returns. Needs two of them. */
export function volatility(
  returns: readonly DatedReturn[],
  periodsPerYear: number = CRYPTO_PERIODS_PER_YEAR,
): number | null {
  if (returns.length < 2) return null;
  const values = returns.map(({ value }) => value);
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance * periodsPerYear);
}

/** Simple returns between consecutive points, whatever the gap between them. */
export function priceReturns(points: readonly PricePoint[]): DatedReturn[] {
  const returns: DatedReturn[] = [];
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1];
    const today = points[index];
    if (!before || !today || before.price.eq("0")) continue;
    returns.push({
      date: today.date,
      value: toNumber(today.price.minus(before.price).div(before.price)),
    });
  }
  return returns;
}

/**
 * Pearson correlation of two assets' returns, from -1 to 1. Only over the dates
 * both have, so a stock's weekend does not pair with a coin's Monday move. null
 * when there are too few dates, or one of them never moved.
 */
export function correlation(
  a: readonly PricePoint[],
  b: readonly PricePoint[],
): number | null {
  const datesInB = new Set(b.map(({ date }) => date));
  const datesInBoth = new Set(
    a.filter(({ date }) => datesInB.has(date)).map(({ date }) => date),
  );
  const onCommonDates = (points: readonly PricePoint[]) =>
    priceReturns(points.filter(({ date }) => datesInBoth.has(date))).map(
      ({ value }) => value,
    );
  const x = onCommonDates(a);
  const y = onCommonDates(b);
  if (x.length < MIN_RETURNS_FOR_CORRELATION || x.length !== y.length) {
    return null;
  }

  const meanX = average(x);
  const meanY = average(y);
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  x.forEach((valueX, index) => {
    const dx = valueX - meanX;
    const dy = (y[index] ?? meanY) - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  });
  if (varianceX < NO_VARIATION || varianceY < NO_VARIATION) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
