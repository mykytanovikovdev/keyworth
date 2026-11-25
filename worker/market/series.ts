import {
  type DailySeriesJson,
  HISTORY_START,
} from "../../shared/schemas/market.ts";
import type { Database } from "../db/client.ts";
import {
  afterAnswer,
  type Cached,
  type CacheTimes,
  type Defer,
  readCached,
  storeCached,
} from "./cache.ts";
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
  /** The first day the caller needs. */
  from: string;
  /** The source's points from `since` to `until` (days), or to its latest. */
  load: (since: string, until?: string) => Promise<DailyPoint[]>;
}

/** What the cache keeps for a series. */
export interface StoredSeries extends DailySeriesJson {
  /**
   * The first day the source was asked from: every day from here on is known,
   * as a value or as none. Absent in entries written before series began at
   * the day asked for; those were asked from HISTORY_START.
   */
  askedFrom?: string;
}

/** Frankfurter takes about a second per year of days: one piece, one call. */
const PIECE_DAYS = 366;
/** Calls at once: a request has six connections, and the database holds one. */
const CALLS_AT_ONCE = 4;
/** Calls one request may make: the Free plan allows 50 subrequests. */
const CALLS_PER_REQUEST = 30;
/** A refresh never asks for more than this, even after a long silence. */
const REFRESH_DAYS_AT_MOST = 31;

/** What the routes send: never the cache's own bookkeeping. */
const shown = ({ from, values }: DailySeriesJson): DailySeriesJson => ({
  from,
  values,
});

/** Runs at most `size` tasks at once, in the order given. */
function limiter(size: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= size) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

/** Days `first` to `last` (null: the latest) in pieces of a year, newest first. */
function pieces(
  first: number,
  last: number | null,
  latest: number,
): [since: string, until: string | undefined][] {
  const result: [string, string | undefined][] = [];
  let end = last ?? latest;
  let open = last === null;
  while (end >= first) {
    const start = Math.max(first, end - PIECE_DAYS + 1);
    // The newest piece stays open: a bank east of UTC may already have tomorrow.
    result.push([dayString(start), open ? undefined : dayString(end)]);
    open = false;
    end = start - 1;
  }
  return result;
}

interface Plan {
  request: SeriesRequest;
  old: StoredSeries | null;
  /** Newest first; the series can then be kept even if older pieces were cut. */
  ranges: [since: string, until: string | undefined][];
  /** Served now and refreshed after the answer. */
  later: boolean;
}

/** What a request needs of its source, given what the cache has. */
function planOf(
  request: SeriesRequest,
  entry: Cached<StoredSeries> | undefined,
  { freshForMs }: CacheTimes,
  deferrable: boolean,
): Plan {
  const now = Date.now();
  const latest = Math.floor(now / DAY_MS) + 1;
  const old = entry?.value ?? null;
  const asked = dayNumber(request.from) ?? FIRST_DAY;
  const want = Math.max(FIRST_DAY, asked - OVERLAP_DAYS);
  if (!entry || !old) {
    return { request, old, ranges: pieces(want, null, latest), later: false };
  }
  const askedFrom = dayNumber(old.askedFrom ?? HISTORY_START) ?? FIRST_DAY;
  const ranges: [string, string | undefined][] = [];
  const stale = now - entry.fetchedAt.getTime() >= freshForMs;
  if (stale) {
    // From the last week before the last day known, or before the last
    // refresh when the source has been silent since.
    const fetched = Math.floor(entry.fetchedAt.getTime() / DAY_MS);
    const oldFrom = old.values.length > 0 ? dayNumber(old.from) : null;
    const lastDay =
      oldFrom === null ? fetched : oldFrom + old.values.length - 1;
    const since = Math.max(
      askedFrom,
      Math.min(lastDay, fetched) - OVERLAP_DAYS,
      fetched - REFRESH_DAYS_AT_MOST,
    );
    ranges.push(...pieces(since, null, latest));
  }
  if (want < askedFrom) ranges.push(...pieces(want, askedFrom - 1, latest));
  // Only a refresh can wait: days asked for and not cached cannot.
  const later = stale && want >= askedFrom && deferrable;
  return { request, old, ranges, later };
}

/**
 * Starts the calls of `count` plans: each gets an equal share of the request's
 * calls, newest days first; the next request goes on from where this one
 * stopped.
 */
function updater(count: number) {
  const share = Math.max(1, Math.floor(CALLS_PER_REQUEST / Math.max(1, count)));
  const limit = limiter(CALLS_AT_ONCE);
  return (plan: Plan): Update => {
    const ranges = plan.ranges.slice(0, share);
    // Started now, all of them, so the calls of every series overlap.
    const loads = Promise.allSettled(
      ranges.map(([since, until]) =>
        limit(() => plan.request.load(since, until)),
      ),
    );
    const firstAsked = Math.min(
      ...ranges.map(([since]) => dayNumber(since) ?? FIRST_DAY),
    );
    return { plan, loads, firstAsked };
  };
}

/**
 * The series, in the order asked for, each from the day asked (a week earlier,
 * so a weekend at the start has the Friday before it). The cache keeps each
 * series from the earliest day anyone asked for:
 * - none cached: the source is asked from that day, in pieces of a year;
 * - asked for days before the cached ones: those days are asked for and added;
 * - cached but stale: served as it is, and the last days are asked again after
 *   the answer (`defer`; without it, before);
 * - a source that fails leaves an unexpired series as it is.
 * The calls run a few at a time; each series is stored as soon as it is
 * merged, so a request stopped part of the way keeps what it did.
 */
export async function dailySeries(
  db: Database,
  requests: readonly SeriesRequest[],
  times: CacheTimes,
  defer?: Defer,
): Promise<DailySeriesJson[]> {
  const known = await readCached<StoredSeries>(
    db,
    requests.map(({ key }) => key),
  );
  const plans = requests.map((request) =>
    planOf(request, known.get(request.key), times, defer !== undefined),
  );

  const asking = plans.filter(({ ranges }) => ranges.length > 0);
  const update = updater(asking.length);
  const immediate = asking.filter(({ later }) => !later).map(update);
  const afterwards = asking.filter(({ later }) => later);
  const results = new Map<SeriesRequest, DailySeriesJson>();
  for (const started of immediate) {
    results.set(
      started.plan.request,
      await store(db, started, times.keepForMs),
    );
  }
  if (afterwards.length > 0 && defer) {
    defer(() => refresh(db, afterwards.map(update), times.keepForMs));
  }
  return plans.map(({ request, old }) =>
    shown(results.get(request) ?? old ?? emptySeries()),
  );
}

/**
 * The series that `known` (what the cache has) can answer without a source.
 * The others are left out: none cached, or not from the day asked. A stale one
 * is served as it is and asked again after the answer, as `dailySeries` does.
 */
export function keptSeries(
  db: Database,
  known: ReadonlyMap<string, Cached<StoredSeries>>,
  requests: readonly SeriesRequest[],
  times: CacheTimes,
  defer: Defer,
): Map<SeriesRequest, DailySeriesJson> {
  const plans = requests.map((request) =>
    planOf(request, known.get(request.key), times, true),
  );
  // Once each, however many times a series was asked for.
  const stale = new Map(
    plans.flatMap((plan) =>
      plan.later ? [[plan.request.key, plan] as const] : [],
    ),
  );
  if (stale.size > 0) {
    const updates = [...stale.values()].map(updater(stale.size));
    defer(() => refresh(db, updates, times.keepForMs));
  }
  return new Map(
    plans.flatMap(({ request, old, ranges, later }) =>
      old && (later || ranges.length === 0)
        ? [[request, shown(old)] as const]
        : [],
    ),
  );
}

interface Update {
  plan: Plan;
  loads: Promise<PromiseSettledResult<DailyPoint[]>[]>;
  /** The earliest day this update asks for. */
  firstAsked: number;
}

/**
 * Merges a series' answers into what was cached and stores it. When a call
 * failed, an unexpired old series stands in, unless `fallBack` is off.
 */
async function store(
  db: Database,
  { plan: { request, old }, loads, firstAsked }: Update,
  keepForMs: number,
  fallBack = true,
): Promise<DailySeriesJson> {
  const answers = await loads;
  const failed = answers.find(
    (answer): answer is PromiseRejectedResult => answer.status === "rejected",
  );
  if (failed) {
    if (fallBack && failed.reason instanceof MarketError && old) return old;
    throw failed.reason;
  }
  const points = answers.flatMap((answer) =>
    answer.status === "fulfilled" ? answer.value : [],
  );
  const merged = mergeSeries(old, points);
  const oldAsked = old
    ? (dayNumber(old.askedFrom ?? HISTORY_START) ?? FIRST_DAY)
    : Infinity;
  const series: StoredSeries = {
    ...merged,
    askedFrom: dayString(Math.min(oldAsked, firstAsked)),
  };
  await storeCached(db, [{ key: request.key, value: series }], keepForMs);
  return series;
}

/** Refreshes after the answer, each on its own: one failing stops no other. */
async function refresh(
  db: Database,
  updates: Update[],
  keepForMs: number,
): Promise<void> {
  for (const update of updates) {
    await afterAnswer(() => store(db, update, keepForMs, false));
  }
}
