import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok" }));

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((error, c) => {
  // Never log request bodies: /api/chat and /api/vault carry user data.
  console.error(`Unhandled error on ${c.req.method} ${c.req.path}`, error);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
