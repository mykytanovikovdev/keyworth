import { lt } from "drizzle-orm";
import type { Database } from "./db/client.ts";
import {
  apiRateLimits,
  deviceUnlocks,
  rateLimit,
  session,
} from "./db/schema.ts";
import { DEVICE_MAX_AGE_DAYS } from "./routes/keys.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Longer than any limit's window, so no counter still in use disappears. */
const COUNTER_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Deletes what no longer has a use, on the schedule in wrangler.jsonc: expired
 * sessions with the IP address and browser they hold (a remembered device goes
 * with its session), remembered devices past their limit, and old request
 * counters. The privacy policy promises how long these stay; nothing else
 * removes them while their owner stays away.
 */
export async function deleteExpiredData(db: Database): Promise<void> {
  const now = Date.now();
  const counterCutoff = now - COUNTER_MAX_AGE_MS;
  await db.delete(session).where(lt(session.expiresAt, new Date(now)));
  await db
    .delete(deviceUnlocks)
    .where(
      lt(deviceUnlocks.createdAt, new Date(now - DEVICE_MAX_AGE_DAYS * DAY_MS)),
    );
  await db.delete(rateLimit).where(lt(rateLimit.lastRequest, counterCutoff));
  await db
    .delete(apiRateLimits)
    .where(lt(apiRateLimits.windowStart, new Date(counterCutoff)));
}
