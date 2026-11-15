import { sql } from "drizzle-orm";
import type { Context } from "hono";
import type { Database } from "../db/client.ts";
import type { AppEnv } from "../env.ts";
import { countUse, verdict } from "../limits.ts";
import { CHAT_MODEL } from "./model.ts";

/*
 * Who may ask the model now: the user within the chat's rate, and Keyworth
 * within the model's daily budget for all users together. Workers AI gives
 * 10,000 neurons a day free; the budget stays under it, so the chat costs
 * nothing even on a paid Workers plan. Counted in Postgres per UTC day, the
 * day Cloudflare's allowance follows.
 */

export const CHAT_BUDGET = Object.freeze({
  /** Neurons per UTC day, all users together. */
  perDay: 9_000,
});

/** Requests per user per minute: each step of a question is a request. */
export const CHAT_RATE = 20;

/** Next midnight UTC: when today's budget resets. */
export function budgetResetsAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

export type Admission =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited"; retryAfter: number }
  | { allowed: false; reason: "budget" };

/**
 * Counts this request against the user's rate and reads today's spending, in
 * one round trip to the database. The budget is checked before the model is
 * asked; a step's cost is known only after it, so the day's last steps may go
 * past it by a step or two: that is why it sits below the free allowance.
 */
export async function admit(c: Context<AppEnv>): Promise<Admission> {
  const result = await c.get("db").execute<{
    count: number;
    retry_after: number;
    day_spent: number;
  }>(sql`
    with rate as (${countUse(c.get("user").id, "chat", 60)})
    select rate.count, rate.retry_after,
      coalesce((select day_spent from model_usage
                where model = ${CHAT_MODEL.id}
                  and day_start = date_trunc('day', now(), 'UTC')), 0)
        as day_spent
    from rate`);
  const row = result.rows[0];
  const rate = verdict(row, CHAT_RATE);
  if (!rate.allowed) {
    return {
      allowed: false,
      reason: "rate_limited",
      retryAfter: rate.retryAfter,
    };
  }
  if ((row?.day_spent ?? 0) >= CHAT_BUDGET.perDay) {
    return { allowed: false, reason: "budget" };
  }
  return { allowed: true };
}

/** Adds what a step cost to today's count; a new day starts from it. */
export async function spend(db: Database, neurons: number): Promise<void> {
  await db.execute(sql`
    insert into model_usage (model, day_start, day_spent)
    values (${CHAT_MODEL.id}, date_trunc('day', now(), 'UTC'), ${neurons})
    on conflict (model) do update set
      day_spent = case
        when model_usage.day_start = date_trunc('day', now(), 'UTC')
        then model_usage.day_spent + ${neurons} else ${neurons} end,
      day_start = date_trunc('day', now(), 'UTC')`);
}
