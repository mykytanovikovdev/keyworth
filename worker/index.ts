import { Hono, type MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { MeJson } from "../shared/schemas/me.ts";
import { createAuth } from "./auth.ts";
import { deleteExpiredData } from "./cleanup.ts";
import { describeError } from "./describe-error.ts";
import { connect } from "./db/client.ts";
import type { AppEnv } from "./env.ts";
import { freshForSeconds, requireSameOrigin } from "./limits.ts";
import { keys } from "./routes/keys.ts";
import { assets, market } from "./routes/market.ts";
import { vault } from "./routes/vault.ts";
import { securityHeaders } from "./security-headers.ts";

const api = new Hono<AppEnv>();

// Public and database-free; registered before the middleware below, so none
// of it runs for health checks.
api.get("/health", (c) => c.json({ status: "ok" }));

// Everything else gets a database pool for this request (connections open only
// when a query runs) and an auth instance built from this request's bindings.
api.use("*", async (c, next) => {
  const db = connect(c.env.HYPERDRIVE.connectionString);
  c.set("db", db);
  c.set("auth", createAuth(db, c.env));
  await next();
});

// Sign-in, the OAuth callback, sign-out, session and account deletion.
api.on(["GET", "POST"], "/auth/*", (c) => c.get("auth").handler(c.req.raw));

/**
 * Deny by default: every route registered after this needs a session. The user
 * comes only from the session cookie, never from the request body or URL.
 */
const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await c
    .get("auth")
    .api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const { id, name, email } = session.user;
  c.set("user", { id, name, email });
  c.set("session", {
    id: session.session.id,
    createdAt: session.session.createdAt,
  });
  return next();
};
api.use("*", requireSession);
// After the session check, so a request without a session still gets 401.
api.use("*", requireSameOrigin);

api.get("/me", (c) =>
  c.json<MeJson>({
    ...c.get("user"),
    freshForSeconds: freshForSeconds(c.get("session")),
  }),
);
// End-to-end encryption: wrapped keys and encrypted records (phase 3).
api.route("/keys", keys);
api.route("/vault", vault);
// Market data (phase 4): the same for everyone, behind the session all the same.
api.route("/market", market);
api.route("/assets", assets);

const app = new Hono<AppEnv>();

// Applies to every response the Worker generates, including 404s and errors.
app.use(securityHeaders);
app.route("/api", api);

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Never the error itself or the request: see describe-error.ts. The route's
// pattern, not the path, which can hold a coin's id (/api/assets/:id/logo).
app.onError((error, c) => {
  console.error(
    `Unhandled error on ${c.req.method} ${routePath(c, -1)}\n${describeError(error)}`,
  );
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: async (_controller, env) => {
    try {
      await deleteExpiredData(connect(env.HYPERDRIVE.connectionString));
    } catch (error) {
      console.error(`Scheduled cleanup failed\n${describeError(error)}`);
      // A new error, so the run shows as failed without the original's message.
      // eslint-disable-next-line preserve-caught-error -- see describe-error.ts
      throw new Error("Scheduled cleanup failed");
    }
  },
} satisfies ExportedHandler<Env>;
