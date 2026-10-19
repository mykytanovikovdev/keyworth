import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE_URL = "https://keyworth.test";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`${BASE_URL}${path}`, init));

// Headers every Worker response must carry, whatever the route or status.
const WORKER_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-robots-tag": "noindex, nofollow",
};

function expectWorkerHeaders(response: Response) {
  for (const [name, value] of Object.entries(WORKER_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
  expect(response.headers.has("x-powered-by")).toBe(false);
}

describe("GET /api/health", () => {
  it("reports ok", async () => {
    const response = await fetchWorker("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("sets the Worker security headers", async () => {
    expectWorkerHeaders(await fetchWorker("/api/health"));
  });
});

describe("unknown routes", () => {
  it.each(["/api/does-not-exist", "/api", "/not-an-api-path"])(
    "%s returns a JSON 404 with security headers",
    async (path) => {
      const response = await fetchWorker(path);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
      expectWorkerHeaders(response);
    },
  );

  it("does not accept other methods on existing routes", async () => {
    const response = await fetchWorker("/api/health", { method: "POST" });

    expect(response.status).toBe(404);
    expectWorkerHeaders(response);
  });
});
