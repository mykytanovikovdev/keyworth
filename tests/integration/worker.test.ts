import { describe, expect, it } from "vitest";
import { expectWorkerHeaders, fetchWorker } from "./helpers.ts";

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
  it("a path outside /api returns a JSON 404 with security headers", async () => {
    const response = await fetchWorker("/not-an-api-path");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expectWorkerHeaders(response);
  });

  // The API is deny-by-default: without a session, an unknown route looks the
  // same as a protected one, so its existence is not revealed.
  it.each([
    ["GET", "/api/does-not-exist"],
    ["GET", "/api"],
    ["POST", "/api/health"],
  ])(
    "%s %s without a session returns a JSON 401 with security headers",
    async (method, path) => {
      const response = await fetchWorker(path, { method });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expectWorkerHeaders(response);
    },
  );
});
