import { sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { CHAT_MODEL } from "./model.ts";

/*
 * The model's daily budget for all of Keyworth together. Workers AI gives
 * 10,000 neurons a day free; the budget stays under it, so the chat costs
 * nothing even on a paid Workers plan, where more would be charged. Counted in
 * Postgres per UTC day, the day Cloudflare's allowance follows.
 */

export const CHAT_BUDGET = Object.freeze({
  /** Neurons per UTC day, all users together. */
  perDay: 9_000,
});

/** Next midnight UTC: when today's budget resets. */
export function budgetResetsAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

/**
 * Whether today's budget has room for another answer. Checked before the
 * model is asked; the answer's cost is known only after it, so the last answer
 * of a day may go past the budget by one answer. That is why the budget sits
 * below the free allowance.
 */
export async function budgetLeft(db: Database): Promise<boolean> {
  const result = await db.execute<{ day_spent: number }>(sql`
    select day_spent from model_usage
    where model = ${CHAT_MODEL.id}
      and day_start = date_trunc('day', now(), 'UTC')`);
  const spent = result.rows[0]?.day_spent ?? 0;
  return spent < CHAT_BUDGET.perDay;
}

/** Adds what an answer cost to today's count; a new day starts from it. */
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
