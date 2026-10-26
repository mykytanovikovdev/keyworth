import { Hono, type MiddlewareHandler } from "hono";
import { createAuth, type Auth } from "./auth.ts";
import { connect, type Database } from "./db/client.ts";
import { securityHeaders } from "./security-headers.ts";

interface SessionUser {
  id: string;
  name: string;
  email: string;
}

interface AppEnv {
  Bindings: Env;
  Variables: { db: Database; auth: Auth; user: SessionUser };
}

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
  return next();
};
api.use("*", requireSession);

api.get("/me", (c) => c.json(c.get("user")));

const app = new Hono<AppEnv>();

// Applies to every response the Worker generates, including 404s and errors.
app.use(securityHeaders);
app.route("/api", api);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  // Never log request bodies: /api/chat and /api/vault carry user data.
  console.error(`Unhandled error on ${c.req.method} ${c.req.path}`, error);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
