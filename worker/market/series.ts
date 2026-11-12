import {
  type DailySeriesJson,
  HISTORY_START,
} from "../../shared/schemas/market.ts";
import type { Database } from "../db/client.ts";
import { type CacheTimes, readCached, storeCached } from "./cache.ts";
import { MarketError } from "./upstream.ts";

/*
 * Daily series (a coin's prices, a currency's rates), each kept whole in the
 * shared cache as one value per day from its first day. Serving a range is a
 * slice, and a refresh asks the source only for the last days: a whole series
 * since 2010 is about 6,000 rows, worth parsing once, not on every refresh.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A day (YYYY-MM-DD, UTC) and its value, plain digits. */
export type DailyPoint = readonly [day: string, value: string];

/** A refresh asks for the last week again: late publications, revised blends. */
const OVERLAP_DAYS = 7;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAY_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Days since 1970-01-01, or null for anything but a real day in YYYY-MM-DD
 * form ("2026-02-30" is not one, though Date.parse takes it for March 2).
 * Cheap on purpose: it runs for every point of a series, thousands at first.
 */
function dayNumber(day: string): number | null {
  const match = DAY_FORMAT.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  if (length === undefined || date < 1 || date > length) return null;
  return Date.UTC(year, month - 1, date) / DAY_MS;
}

const dayString = (number: number) =>
  new Date(number * DAY_MS).toISOString().slice(0, 10);

const FIRST_DAY = dayNumber(HISTORY_START) ?? 0;

/** A source with nothing for this coin or currency: cached too, so asked again only when stale. */
export const emptySeries = (): DailySeriesJson => ({
  from: HISTORY_START,
  values: [],
});

/**
 * Points replace what `old` had for their days; days nobody knows stay null.
 * Days before HISTORY_START or after tomorrow are dropped: a source's date in
 * the year 9999 must not become millions of empty days. Tomorrow, because a
 * bank east of UTC publishes its rate for a day that has begun there.
 */
export function mergeSeries(
  old: DailySeriesJson | null,
  points: readonly DailyPoint[],
): DailySeriesJson {
  const latest = Math.floor(Date.now() / DAY_MS) + 1;
  const known: [number, string][] = [];
  let first = Infinity;
  let last = -Infinity;
  for (const [day, value] of points) {
    const number = dayNumber(day);
    if (number === null || number < FIRST_DAY || number > latest) continue;
    known.push([number, value]);
    first = Math.min(first, number);
    last = Math.max(last, number);
  }
  const oldFrom = old && old.values.length > 0 ? dayNumber(old.from) : null;
  if (old && oldFrom !== null) {
    first = Math.min(first, oldFrom);
    last = Math.max(last, oldFrom + old.values.length - 1);
  }
  if (!Number.isFinite(first)) return old ?? emptySeries();
  const values = new Array<string | null>(last - first + 1).fill(null);
  if (old && oldFrom !== null) {
    const offset = oldFrom - first;
    old.values.forEach((value, index) => {
      values[offset + index] = value;
    });
  }
  for (const [number, value] of known) values[number - first] = value;
  return { from: dayString(first), values };
}

/** The series from `day` on; all of it when it starts later. */
export function sliceSeries(
  series: DailySeriesJson,
  day: string,
): DailySeriesJson {
  const skip = (dayNumber(day) ?? 0) - (dayNumber(series.from) ?? 0);
  if (skip <= 0) return series;
  return { from: day, values: series.values.slice(skip) };
}

export interface SeriesRequest {
  key: string;
  /** The source's points from `since` (a day) to its latest. */
  load: (since: string) => Promise<DailyPoint[]>;
}

/**
 * The series, in the order asked for. A fresh one comes from the cache; a stale
 * one is extended from the source; a source that fails leaves an unexpired one
 * as it is. The sources are asked together; the cache is written once.
 */
export async function dailySeries(
  db: Database,
  requests: readonly SeriesRequest[],
  { freshForMs, keepForMs }: CacheTimes,
): Promise<DailySeriesJson[]> {
  const known = await readCached<DailySeriesJson>(
    db,
    requests.map(({ key }) => key),
  );
  const now = Date.now();
  // One after another, each stored as soon as it is merged: ten whole series
  // cost about 20 ms of CPU, more than a Worker on the free plan has, and a
  // request stopped part of the way must not lose what it already did. The
  // next request finds those cached and goes on from there.
  const results: DailySeriesJson[] = [];
  for (const { key, load } of requests) {
    const entry = known.get(key);
    if (entry && now - entry.fetchedAt.getTime() < freshForMs) {
      results.push(entry.value);
      continue;
    }
    const old = entry?.value ?? null;
    const oldFrom = old && old.values.length > 0 ? dayNumber(old.from) : null;
    const since =
      old && oldFrom !== null
        ? dayString(oldFrom + old.values.length - 1 - OVERLAP_DAYS)
        : HISTORY_START;
    let series: DailySeriesJson;
    try {
      series = mergeSeries(old, await load(since));
    } catch (error) {
      if (error instanceof MarketError && old) {
        results.push(old);
        continue;
      }
      throw error;
    }
    await storeCached(db, [{ key, value: series }], keepForMs);
    results.push(series);
  }
  return results;
}
