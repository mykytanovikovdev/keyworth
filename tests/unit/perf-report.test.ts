import { describe, expect, it } from "vitest";
import {
  formatReport,
  routeOf,
  sampleOf,
  splitJsonObjects,
  summarize,
  tally,
  type Sample,
} from "../../scripts/perf-report.ts";

const event = (fields: {
  method?: string;
  url: string;
  outcome?: string;
  status?: number;
  cpuTime?: number;
  wallTime?: number;
  colo?: string;
  placement?: string;
}) => ({
  outcome: fields.outcome ?? "ok",
  cpuTime: fields.cpuTime ?? 1,
  wallTime: fields.wallTime ?? 10,
  event: {
    request: {
      method: fields.method ?? "GET",
      url: fields.url,
      headers: {
        cookie: "secret-session",
        ...(fields.placement && { "cf-placement": fields.placement }),
      },
      cf: fields.colo ? { colo: fields.colo } : {},
    },
    response: { status: fields.status ?? 200 },
  },
});

describe("splitJsonObjects", () => {
  it("splits indented objects and keeps the unfinished one for later", () => {
    const first = JSON.stringify(
      { a: "{ not a brace }", b: { c: 1 } },
      null,
      2,
    );
    const second = JSON.stringify({ quote: 'a \\" b' }, null, 2);
    const { objects, rest } = splitJsonObjects(
      `${first}\n${second.slice(0, 5)}`,
    );

    expect(objects.map((text) => JSON.parse(text) as unknown)).toEqual([
      { a: "{ not a brace }", b: { c: 1 } },
    ]);
    const done = splitJsonObjects(rest + second.slice(5));
    expect(done.objects.map((text) => JSON.parse(text) as unknown)).toEqual([
      { quote: 'a \\" b' },
    ]);
    expect(done.rest).toBe("");
  });
});

describe("routeOf", () => {
  it("groups by route: ids become :id, query strings go", () => {
    expect(
      routeOf("GET", "https://keyworth.app/api/assets/crypto%3Abitcoin/logo"),
    ).toBe("GET /api/assets/:id/logo");
    expect(
      routeOf(
        "PUT",
        "https://keyworth.app/api/vault/0b8f6c1e-7d2a-4c3b-9e5f-1a2b3c4d5e6f",
      ),
    ).toBe("PUT /api/vault/:id");
    expect(routeOf("GET", "https://keyworth.app/api/market/history?id=x")).toBe(
      "GET /api/market/history",
    );
  });
});

describe("sampleOf", () => {
  it("keeps timings and the entry location, nothing else", () => {
    const sample = sampleOf(
      event({
        method: "POST",
        url: "https://keyworth.app/api/chat",
        cpuTime: 3,
        wallTime: 900,
        colo: "FRA",
        placement: "remote-FRA",
      }),
    );

    expect(sample).toEqual({
      route: "POST /api/chat",
      outcome: "ok",
      status: 200,
      cpuMs: 3,
      wallMs: 900,
      colo: "FRA",
    });
    expect(JSON.stringify(sample)).not.toContain("secret-session");
  });

  it("ignores events that are not requests (the daily cleanup)", () => {
    expect(sampleOf({ event: { cron: "0 3 * * *" } })).toBeNull();
    expect(sampleOf(null)).toBeNull();
  });
});

describe("summarize", () => {
  const sample = (
    route: string,
    cpuMs: number,
    wallMs: number,
    outcome = "ok",
    status = 200,
  ): Sample => ({
    route,
    outcome,
    status,
    cpuMs,
    wallMs,
    colo: "FRA",
  });

  it("gives each route its count, medians, maxima and failures, slowest first", () => {
    const rows = summarize([
      sample("GET /api/vault", 4, 200),
      sample("POST /api/chat", 2, 5000),
      sample("GET /api/vault", 6, 300),
      sample("GET /api/vault", 5, 220, "exceededCpu"),
      sample("GET /api/market/rates", 9, 8000, "ok", 500),
      sample("GET /api/market/rates", 9, 7000, "ok", 502),
    ]);

    expect(rows).toEqual([
      {
        route: "GET /api/market/rates",
        count: 2,
        cpuMedian: 9,
        cpuMax: 9,
        wallMedian: 7500,
        wallMax: 8000,
        failed: 2,
      },
      {
        route: "POST /api/chat",
        count: 1,
        cpuMedian: 2,
        cpuMax: 2,
        wallMedian: 5000,
        wallMax: 5000,
        failed: 0,
      },
      {
        route: "GET /api/vault",
        count: 3,
        cpuMedian: 5,
        cpuMax: 6,
        wallMedian: 220,
        wallMax: 300,
        failed: 1,
      },
    ]);
  });

  it("prints a table with where the Worker ran", () => {
    const report = formatReport([sample("GET /api/me", 1, 50)]);

    expect(report).toContain("GET /api/me");
    expect(report).toContain("Entered Cloudflare at: FRA ×1");
    expect(formatReport([])).toBe("No requests seen.");
  });
});

describe("tally", () => {
  it("counts values, most frequent first", () => {
    expect(tally(["FRA", "TBS", "FRA", null])).toBe("FRA ×2, TBS ×1, none ×1");
  });
});
