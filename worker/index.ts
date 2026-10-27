import { Hono, type MiddlewareHandler } from "hono";
import { createAuth } from "./auth.ts";
import { describeError } from "./describe-error.ts";
import { connect } from "./db/client.ts";
import type { AppEnv } from "./env.ts";
import { requireSameOrigin } from "./limits.ts";
import { keys } from "./routes/keys.ts";
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

api.get("/me", (c) => c.json(c.get("user")));
// End-to-end encryption: wrapped keys and encrypted records (phase 3).
api.route("/keys", keys);
api.route("/vault", vault);

const app = new Hono<AppEnv>();

// Applies to every response the Worker generates, including 404s and errors.
app.use(securityHeaders);
app.route("/api", api);

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Never the error itself or the request: see describe-error.ts.
app.onError((error, c) => {
  console.error(
    `Unhandled error on ${c.req.method} ${c.req.path}\n${describeError(error)}`,
  );
  return c.json({ error: "internal_error" }, 500);
});

export default app;
