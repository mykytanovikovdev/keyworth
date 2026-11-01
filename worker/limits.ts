import { sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { FRESH_SESSION_SECONDS } from "./auth.ts";
import type { AppEnv } from "./env.ts";

/*
 * Guards shared by the app's own routes. Better Auth limits its own routes;
 * these cover everything after the session check.
 */

/**
 * At most `limit` requests per user per window, counted in Postgres: Workers
 * share no memory between requests, and Cloudflare's rate-limiting binding
 * counts per location and only approximately. One upsert per guarded request,
 * so it guards writes only; reads cost a round trip already.
 */
export function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds = 60,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const window = sql.raw(`interval '${String(windowSeconds)} seconds'`);
    const result = await c.get("db").execute<{
      count: number;
      retry_after: number;
    }>(sql`
      insert into api_rate_limits (user_id, bucket, window_start, count)
      values (${c.get("user").id}, ${bucket}, now(), 1)
      on conflict (user_id, bucket) do update set
        count = case when api_rate_limits.window_start < now() - ${window}
                     then 1 else api_rate_limits.count + 1 end,
        window_start = case when api_rate_limits.window_start < now() - ${window}
                            then now() else api_rate_limits.window_start end
      returning count,
        ceil(extract(epoch from window_start + ${window} - now()))::int
          as retry_after`);
    const row = result.rows[0];
    if ((row?.count ?? 0) > limit) {
      // Seconds until this window ends, not the window's full length.
      c.header("Retry-After", String(Math.max(1, row?.retry_after ?? 1)));
      return c.json({ error: "rate_limited" }, 429);
    }
    return next();
  };
}

/** Refuses bodies larger than `maxBytes` before they are read. */
export function maxBody(maxBytes: number): MiddlewareHandler<AppEnv> {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => c.json({ error: "body_too_large" }, 413),
  });
}

/**
 * Whole seconds this session still counts as a recent sign-in; 0 once it does
 * not. Counted on the server, so a wrong clock on the device cannot make the
 * browser expect the opposite of what requireFreshSession decides.
 */
export function freshForSeconds(session: { createdAt: Date }): number {
  const left =
    FRESH_SESSION_SECONDS * 1000 - (Date.now() - session.createdAt.getTime());
  return Math.max(0, Math.floor(left / 1000));
}

/**
 * Changes that could lock a user out (replacing a wrapped key) need a sign-in
 * from the last 10 minutes, like account deletion: a stolen session cookie
 * alone is not enough.
 */
export const requireFreshSession: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  if (freshForSeconds(c.get("session")) === 0) {
    return c.json({ error: "session_not_fresh" }, 403);
  }
  return next();
};

/**
 * State-changing requests must come from the app's own pages. The session
 * cookie is SameSite=Lax, which already keeps other sites' forms and fetches
 * from carrying it; checking Origin as well (as Better Auth does for its own
 * routes) does not depend on that cookie setting.
 */
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  if (c.req.header("origin") !== new URL(c.env.BETTER_AUTH_URL).origin) {
    return c.json({ error: "forbidden_origin" }, 403);
  }
  return next();
};

/** Parses a JSON body; null when it is not JSON at all. */
export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return null;
  }
}
