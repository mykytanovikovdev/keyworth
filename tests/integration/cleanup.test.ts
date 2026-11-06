import { env } from "cloudflare:workers";
import { createScheduledController } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../worker/index.ts";
import {
  fetchWorker,
  invite,
  query,
  signInWithGoogle,
  uniqueUser,
} from "./helpers.ts";

// The real handler, as Cloudflare calls it. Other test files run at the same
// time on the same database, so each test looks only at its own rows.
const runCleanup = () =>
  worker.scheduled(createScheduledController({ cron: "0 3 * * *" }), env);

async function signedIn(label: string) {
  const user = uniqueUser(label);
  await invite(user.email);
  const { cookie } = await signInWithGoogle(user);
  const [row] = await query<{ id: string }>(
    `select id from "user" where email = $1`,
    [user.email],
  );
  return { cookie, userId: row?.id ?? "" };
}

const rememberDevice = (userId: string, age: string) =>
  query(
    `insert into device_unlocks
       (session_id, user_id, token_hash, iv, wrapped_key, created_at)
     select id, user_id, decode(repeat('00', 32), 'hex'),
            decode(repeat('00', 12), 'hex'), decode(repeat('00', 48), 'hex'),
            now() - $2::interval
       from session where user_id = $1`,
    [userId, age],
  );

const countRows = async (table: string, userId: string) => {
  const [row] = await query<{ count: string }>(
    `select count(*) from ${table} where user_id = $1`,
    [userId],
  );
  return Number(row?.count);
};

const me = (cookie: string) => fetchWorker("/api/me", { headers: { cookie } });

describe("the daily cleanup", () => {
  it("deletes an expired session with its remembered device, and nothing else", async () => {
    const expired = await signedIn("cleanup-expired");
    const active = await signedIn("cleanup-active");
    await rememberDevice(expired.userId, "1 day");
    await rememberDevice(active.userId, "1 day");
    await query(
      `update session set expires_at = now() - interval '1 minute' where user_id = $1`,
      [expired.userId],
    );

    await runCleanup();

    expect(await countRows("session", expired.userId)).toBe(0);
    expect(await countRows("device_unlocks", expired.userId)).toBe(0);
    // The account itself stays: only its sign-in ended.
    expect(
      await query(`select 1 from "user" where id = $1`, [expired.userId]),
    ).toHaveLength(1);

    expect(await countRows("session", active.userId)).toBe(1);
    expect(await countRows("device_unlocks", active.userId)).toBe(1);
    expect((await me(active.cookie)).status).toBe(200);
  });

  it("deletes a remembered device past its limit but keeps its session", async () => {
    const old = await signedIn("cleanup-old-device");
    const recent = await signedIn("cleanup-new-device");
    await rememberDevice(old.userId, "14 days 1 minute");
    await rememberDevice(recent.userId, "13 days 23 hours");

    await runCleanup();

    expect(await countRows("device_unlocks", old.userId)).toBe(0);
    expect((await me(old.cookie)).status).toBe(200);
    expect(await countRows("device_unlocks", recent.userId)).toBe(1);
  });

  it("deletes request counters no limit can still need", async () => {
    const { userId } = await signedIn("cleanup-counters");
    const label = crypto.randomUUID();
    await query(
      `insert into rate_limit (id, key, count, last_request) values
         ($1, $1, 1, $2), ($3, $3, 1, $4)`,
      [
        `${label}-old`,
        Date.now() - 61 * 60 * 1000,
        `${label}-recent`,
        Date.now() - 59 * 60 * 1000,
      ],
    );
    await query(
      `insert into api_rate_limits (user_id, bucket, window_start, count) values
         ($1, 'old', now() - interval '61 minutes', 1),
         ($1, 'recent', now() - interval '59 minutes', 1)`,
      [userId],
    );

    await runCleanup();

    expect(
      await query(`select id from rate_limit where id like $1`, [`${label}%`]),
    ).toEqual([{ id: `${label}-recent` }]);
    expect(
      await query(`select bucket from api_rate_limits where user_id = $1`, [
        userId,
      ]),
    ).toEqual([{ bucket: "recent" }]);
  });
});
