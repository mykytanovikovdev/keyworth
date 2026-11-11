import { sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../env.ts";
import { consume } from "../limits.ts";
import { COINGECKO } from "./coingecko.ts";
import { MarketError } from "./upstream.ts";

/*
 * CoinGecko's Demo plan gives all of Keyworth 100 calls a minute and 10,000 a
 * month. The per-route limits are per user, so without a shared budget one
 * account (or a stolen session) asking for new coins could spend the month in
 * an hour and leave every user without prices. Past a budget, a route serves
 * what the cache still has, or says the market is unavailable.
 */

export const COINGECKO_BUDGET = Object.freeze({
  /** All users together. */
  perMinute: 30,
  /** All users together, per UTC day: about 9,600 a month. */
  perDay: 320,
  /** One user's coins and searches asked for by name, per hour. */
  perUserPerHour: 60,
});

/**
 * Takes one call from CoinGecko's budget before a call is made; throws a
 * MarketError past it, which the routes treat like the source failing. A call
 * made for one user (a coin or a search by name) also counts against that
 * user's hour; the snapshot, the same for everyone, does not.
 */
export async function spendCoinGeckoCall(
  c: Context<AppEnv>,
  { forUser }: { forUser: boolean },
): Promise<void> {
  if (forUser) {
    const { allowed } = await consume(
      c,
      "coingecko",
      COINGECKO_BUDGET.perUserPerHour,
      60 * 60,
    );
    if (!allowed) throw new MarketError(COINGECKO, "over a user's budget");
  }
  const result = await c.get("db").execute<{
    minute_count: number;
    day_count: number;
  }>(sql`
    insert into upstream_calls
      (source, minute_start, minute_count, day_start, day_count)
    values (${COINGECKO}, date_trunc('minute', now(), 'UTC'), 1,
            date_trunc('day', now(), 'UTC'), 1)
    on conflict (source) do update set
      minute_count = case
        when upstream_calls.minute_start = date_trunc('minute', now(), 'UTC')
        then upstream_calls.minute_count + 1 else 1 end,
      minute_start = date_trunc('minute', now(), 'UTC'),
      day_count = case
        when upstream_calls.day_start = date_trunc('day', now(), 'UTC')
        then upstream_calls.day_count + 1 else 1 end,
      day_start = date_trunc('day', now(), 'UTC')
    returning minute_count, day_count`);
  const row = result.rows[0];
  if (
    !row ||
    row.minute_count > COINGECKO_BUDGET.perMinute ||
    row.day_count > COINGECKO_BUDGET.perDay
  ) {
    throw new MarketError(COINGECKO, "over Keyworth's budget");
  }
}
