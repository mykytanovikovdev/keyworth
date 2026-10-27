import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { describeError } from "../../worker/describe-error.ts";
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

describe("error logs", () => {
  it("name the error, its Postgres code and where it came from, never the query's data", () => {
    const ciphertext = "envelope-bytes-from-the-request";
    const cause = Object.assign(new Error(`value out of range: ${ciphertext}`), {
      code: "22003",
    });
    const error = new DrizzleQueryError(
      "update vault_records set ciphertext = $1 where user_id = $2",
      [ciphertext, "user-id"],
      cause,
    );

    const logged = describeError(error);

    expect(logged).toMatch(/^DrizzleQueryError\npostgres 22003\n\s+at /);
    expect(logged).not.toContain(ciphertext);
    expect(logged).not.toContain("vault_records");
    expect(logged).not.toContain("user-id");
  });

  it("leave out a JSON parse error's quote of the body", () => {
    let error: unknown;
    try {
      JSON.parse('{"passphrase": "hunter2"');
    } catch (caught) {
      error = caught;
    }

    expect(describeError(error)).toMatch(/^SyntaxError\n/);
    expect(describeError(error)).not.toContain("hunter2");
  });
});
