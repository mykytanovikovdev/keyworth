import { Hono } from "hono";
import { securityHeaders } from "./security-headers.ts";

const api = new Hono<{ Bindings: Env }>();

api.get("/health", (c) => c.json({ status: "ok" }));

const app = new Hono<{ Bindings: Env }>();

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
