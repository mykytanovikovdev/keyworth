import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { marketCache } from "../db/schema.ts";
import { describeError } from "../describe-error.ts";
import { MarketError } from "./upstream.ts";

/*
 * Market data shared by every user, in Postgres: one call to a source serves
 * all of Keyworth, wherever its users are, which keeps within CoinGecko's
 * monthly allowance. Nothing here belongs to a user. Values are JSON objects:
 * a bare `null` would reach Postgres as SQL NULL.
 */

export interface CacheTimes {
  /** Served without asking the source again. */
  freshForMs: number;
  /** No longer fresh but under this age: served at once, loaded again after. */
  serveForMs?: number;
  /** Stands in when the source fails, then the daily cleanup deletes it. */
  keepForMs: number;
}

export interface Cached<T> {
  value: T;
  fetchedAt: Date;
}

/** Takes work to start once the answer is sent. */
export type Defer = (work: () => Promise<void>) => void;

/** Work after the answer: nothing waits for it, and a failure is logged as a route would. */
export async function afterAnswer(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(
      error instanceof MarketError
        ? `Market data unavailable: ${error.message}`
        : `Market data refresh failed\n${describeError(error)}`,
    );
  }
}

/** Several entries in one statement: never a batch of queries left running. */
export async function storeCached(
  db: Database,
  entries: readonly { key: string; value: object }[],
  keepForMs: number,
): Promise<void> {
  if (entries.length === 0) return;
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + keepForMs);
  await db
    .insert(marketCache)
    .values(
      entries.map(({ key, value }) => ({ key, value, fetchedAt, expiresAt })),
    )
    .onConflictDoUpdate({
      target: marketCache.key,
      set: {
        value: sql`excluded.value`,
        fetchedAt: sql`excluded.fetched_at`,
        expiresAt: sql`excluded.expires_at`,
      },
    });
}

/** The entries that have not expired; written only by this module, so trusted as `T`. */
export async function readCached<T>(
  db: Database,
  keys: readonly string[],
): Promise<Map<string, Cached<T>>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select()
    .from(marketCache)
    .where(
      and(
        inArray(marketCache.key, [...keys]),
        gt(marketCache.expiresAt, new Date()),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.key,
      { value: row.value as T, fetchedAt: row.fetchedAt },
    ]),
  );
}

/**
 * The cached value while it is fresh, otherwise a new one from `load`. With
 * `defer`, a value under `serveForMs` old is served at once and a new one loaded
 * after the answer (`refreshing`). When the source fails, an older value that
 * has not expired is better than nothing.
 */
export async function cached<T extends object>(
  db: Database,
  key: string,
  { freshForMs, serveForMs = 0, keepForMs }: CacheTimes,
  load: () => Promise<T>,
  defer?: Defer,
): Promise<Cached<T> & { refreshing: boolean }> {
  const [row] = await db
    .select()
    .from(marketCache)
    .where(eq(marketCache.key, key))
    .limit(1);
  const now = Date.now();
  const reload = async () => {
    const value = await load();
    await storeCached(db, [{ key, value }], keepForMs);
    return value;
  };
  if (!row) {
    return {
      value: await reload(),
      fetchedAt: new Date(now),
      refreshing: false,
    };
  }
  const old = { value: row.value as T, fetchedAt: row.fetchedAt };
  const age = now - row.fetchedAt.getTime();
  if (age < freshForMs) return { ...old, refreshing: false };
  if (defer && age < serveForMs) {
    defer(() => afterAnswer(reload));
    return { ...old, refreshing: true };
  }
  try {
    const value = await reload();
    return { value, fetchedAt: new Date(now), refreshing: false };
  } catch (error) {
    if (error instanceof MarketError && row.expiresAt.getTime() > now) {
      return { ...old, refreshing: false };
    }
    throw error;
  }
}
