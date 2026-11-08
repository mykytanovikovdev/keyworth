import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultRecordJson } from "../../../shared/schemas/vault.ts";
import { ApiError, httpApi } from "../../../src/vault/api.ts";

/*
 * The browser's HTTP client for /api/vault, against a stubbed fetch: it follows
 * the server's pages and maps errors. The server's side is tested in
 * tests/integration/vault.test.ts.
 */

const record = (id: string): VaultRecordJson => ({
  id,
  kind: "transaction",
  revision: 1,
  envelope: { v: 1, alg: "A256GCM", iv: "A".repeat(16), ct: "A".repeat(363) },
  updatedAt: "2026-11-08T10:00:00.000Z",
});

/** Answers each call with the next response and records what was asked. */
function serve(...answers: Response[]) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      const answer = answers.shift();
      if (!answer) throw new Error(`Unexpected request to ${url}`);
      return Promise.resolve(answer);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpApi.records", () => {
  it("follows the pages to the last one and returns every record in order", async () => {
    const calls = serve(
      Response.json({ records: [record("a"), record("b")], next: "1_cursor" }),
      Response.json({ records: [record("c")], next: null }),
    );

    const records = await httpApi.records("transaction");

    expect(records.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(calls.map(({ url }) => url)).toEqual([
      "/api/vault?kind=transaction",
      "/api/vault?kind=transaction&after=1_cursor",
    ]);
  });

  it("stops when the server repeats a cursor instead of asking forever", async () => {
    serve(
      Response.json({ records: [record("a")], next: "1_same" }),
      Response.json({ records: [record("a")], next: "1_same" }),
    );

    await expect(httpApi.records("transaction")).rejects.toThrow(
      "repeated a page cursor",
    );
  });
});

describe("httpApi.deleteRecord", () => {
  it("deletes by id, and a record already gone is a not_found error", async () => {
    const calls = serve(
      new Response(null, { status: 204 }),
      Response.json({ error: "not_found" }, { status: 404 }),
    );

    await httpApi.deleteRecord("record-1");
    const gone = httpApi.deleteRecord("record-1");

    await expect(gone).rejects.toBeInstanceOf(ApiError);
    await expect(gone).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(calls).toEqual([
      { url: "/api/vault/record-1", method: "DELETE" },
      { url: "/api/vault/record-1", method: "DELETE" },
    ]);
  });
});
