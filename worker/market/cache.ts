import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { marketCache } from "../db/schema.ts";
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
  /** Stands in when the source fails, then the daily cleanup deletes it. */
  keepForMs: number;
}

export interface Cached<T> {
  value: T;
  fetchedAt: Date;
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
 * The cached value while it is fresh, otherwise a new one from `load`. When the
 * source fails, an older value that has not expired is better than nothing.
 */
export async function cached<T extends object>(
  db: Database,
  key: string,
  { freshForMs, keepForMs }: CacheTimes,
  load: () => Promise<T>,
): Promise<Cached<T>> {
  const [row] = await db
    .select()
    .from(marketCache)
    .where(eq(marketCache.key, key))
    .limit(1);
  const now = Date.now();
  if (row && now - row.fetchedAt.getTime() < freshForMs) {
    return { value: row.value as T, fetchedAt: row.fetchedAt };
  }
  try {
    const value = await load();
    await storeCached(db, [{ key, value }], keepForMs);
    return { value, fetchedAt: new Date(now) };
  } catch (error) {
    if (error instanceof MarketError && row && row.expiresAt.getTime() > now) {
      return { value: row.value as T, fetchedAt: row.fetchedAt };
    }
    throw error;
  }
}
