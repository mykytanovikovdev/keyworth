import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssetSearchJson,
  HistoryJson,
  PricesJson,
  RatesJson,
} from "../../shared/schemas/market.ts";
import { COINGECKO_BUDGET } from "../../worker/market/budget.ts";
import {
  api,
  expectWorkerHeaders,
  fetchWorker,
  query,
  signedIn,
} from "./helpers.ts";

/*
 * Market data through the real routes, with CoinGecko's and Frankfurter's
 * answers replaced at fetch. The cache is shared by every user, so each test
 * starts it empty; one file, because files run in parallel on one database.
 */

const IMAGES = "https://coin-images.coingecko.com/coins/images";

interface Call {
  url: URL;
  headers: Headers;
  redirect: Request["redirect"];
}

/**
 * Answers the sources' requests with `answer`, records them, and refuses any
 * other host. Install it after signing in: the sign-in helper's own fetch mock
 * restores the real fetch when it is done, which would remove this one.
 */
function mockSources(answer: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (
        !url.hostname.endsWith("coingecko.com") &&
        url.hostname !== "api.frankfurter.dev"
      ) {
        throw new Error(`Unexpected request to ${url.hostname}`);
      }
      calls.push({ url, headers: request.headers, redirect: request.redirect });
      return Promise.resolve(answer(url));
    });
  return { calls, spy };
}

const coin = (fields: Record<string, unknown>) => ({
  symbol: "btc",
  name: "Bitcoin",
  image: `${IMAGES}/1/large/bitcoin.png?1`,
  current_price: 75966,
  market_cap_rank: 1,
  ...fields,
});

const MARKETS = [
  coin({ id: "bitcoin" }),
  coin({
    id: "tiny-coin",
    symbol: "tiny",
    // Bidi override, zero-width space and a newline, as a hostile name could.
    name: "Tiny‮​\nCoin",
    current_price: 3.55498e-7,
    market_cap_rank: 200,
    image: `${IMAGES}/2/thumb/tiny.png`,
  }),
  coin({ id: "no-price", current_price: null }),
  coin({ id: "negative-price", current_price: -1 }),
  // Not real prices: kept, they would be hundreds of digits.
  coin({ id: "absurd-price", current_price: 1e308 }),
  coin({ id: "vanishing-price", current_price: 5e-324 }),
  coin({ id: "Not An Id" }),
  coin({ id: "elsewhere", image: "https://evil.example/logo.png" }),
];

const json = (body: unknown) => Response.json(body);

const defaultAnswer = (url: URL) => {
  if (url.pathname.endsWith("/coins/markets") && !url.searchParams.has("ids")) {
    return json(MARKETS);
  }
  throw new Error(`Unexpected ${url.pathname}`);
};

const prices = async (cookie: string, ids?: string) => {
  const response = await api(
    `/api/market/prices${ids === undefined ? "" : `?ids=${ids}`}`,
    { cookie },
  );
  return {
    status: response.status,
    body: response.ok ? await response.json<PricesJson>() : null,
  };
};

beforeEach(async () => {
  await query(
    "delete from market_cache where key like 'coingecko:%' or key like 'frankfurter:%'",
  );
  // The shared budget counts every call this file makes.
  await query("delete from upstream_calls");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the market routes", () => {
  it("need a session", async () => {
    mockSources(defaultAnswer);
    for (const path of [
      "/api/market/prices",
      "/api/assets/search?q=bit",
      "/api/assets/crypto:bitcoin/logo",
      "/api/market/history?asset=crypto:bitcoin&from=2026-01-01",
      "/api/market/rates?quotes=EUR&from=2026-01-01",
    ]) {
      const response = await fetchWorker(path);
      expect(response.status, path).toBe(401);
      expectWorkerHeaders(response);
    }
  });
});

describe("prices", () => {
  it("serves the snapshot as plain digits and clean text, keeping only what can be shown", async () => {
    const { cookie } = await signedIn("prices");
    const { calls } = mockSources(defaultAnswer);

    const { status, body } = await prices(cookie);

    expect(status).toBe(200);
    expect(body?.currency).toBe("USD");
    expect(body?.quotes).toEqual([
      {
        id: "crypto:bitcoin",
        symbol: "BTC",
        name: "Bitcoin",
        rank: 1,
        price: "75966",
      },
      {
        id: "crypto:tiny-coin",
        symbol: "TINY",
        name: "Tiny Coin",
        rank: 200,
        price: "0.000000355498",
      },
      {
        id: "crypto:elsewhere",
        symbol: "BTC",
        name: "Bitcoin",
        rank: 1,
        price: "75966",
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("x-cg-demo-api-key")).toBe(
      "test-coingecko-key",
    );
    // A redirect would carry the key's header elsewhere: it is a failure.
    expect(calls[0]?.redirect).toBe("manual");
    expect(calls[0]?.url.searchParams.get("precision")).toBe("full");
  });

  it("asks the source once for everyone within 10 minutes, then again", async () => {
    const alice = await signedIn("prices-a");
    const bob = await signedIn("prices-b");
    const { calls } = mockSources(defaultAnswer);

    await prices(alice.cookie);
    await prices(bob.cookie);
    expect(calls).toHaveLength(1);

    await query(
      "update market_cache set fetched_at = now() - interval '11 minutes' where key = 'coingecko:top'",
    );
    await prices(alice.cookie);
    expect(calls).toHaveLength(2);
  });

  it("keeps serving older prices while the source fails, saying how old they are", async () => {
    let up = true;
    const { cookie } = await signedIn("prices-stale");
    mockSources((url) =>
      up ? defaultAnswer(url) : new Response("down", { status: 503 }),
    );
    const first = await prices(cookie);
    await query(
      "update market_cache set fetched_at = now() - interval '2 hours' where key = 'coingecko:top'",
    );
    up = false;

    const second = await prices(cookie);

    expect(second.status).toBe(200);
    expect(second.body?.quotes).toEqual(first.body?.quotes);
    expect(
      Date.parse(first.body?.fetchedAt ?? "") -
        Date.parse(second.body?.fetchedAt ?? ""),
    ).toBeGreaterThan(60 * 60 * 1000);
  });

  it.each([
    ["is down", () => new Response("down", { status: 503 })],
    [
      "answers too much",
      () => new Response("[" + " ".repeat(3 * 1024 * 1024) + "]"),
    ],
    ["answers something else", () => json({ error: "nope" })],
    ["is unreachable", () => Promise.reject(new TypeError("network"))],
    [
      "runs out of time mid-answer",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("[{"));
              controller.error(new DOMException("timed out", "TimeoutError"));
            },
          }),
        ),
    ],
  ])(
    "answers 502 when the source %s and nothing is cached, and logs no request",
    async (_, answer) => {
      const { cookie } = await signedIn("prices-down");
      mockSources(answer);
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const { status } = await prices(cookie, "crypto:secret-holding");

      expect(status).toBe(502);
      expect(log).toHaveBeenCalledOnce();
      expect(String(log.mock.calls[0]?.[0])).toMatch(
        /^Market data unavailable: coingecko: /,
      );
      expect(String(log.mock.calls[0]?.[0])).not.toMatch(
        /secret-holding|markets|\?/,
      );
    },
  );

  it("does not serve prices past a day, whatever happens", async () => {
    let up = true;
    const { cookie } = await signedIn("prices-expired");
    mockSources((url) =>
      up ? defaultAnswer(url) : new Response("down", { status: 503 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await prices(cookie);
    await query(
      "update market_cache set fetched_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where key = 'coingecko:top'",
    );
    up = false;

    expect((await prices(cookie)).status).toBe(502);
  });
});

describe("prices by id", () => {
  const outsideTop = (url: URL) =>
    url.searchParams.has("ids")
      ? json([
          coin({
            id: "obscure-coin",
            symbol: "obs",
            name: "Obscure",
            current_price: 0.5,
            market_cap_rank: null,
          }),
        ])
      : defaultAnswer(url);

  it("takes coins in the snapshot from it, and asks only for the others, once", async () => {
    const { cookie } = await signedIn("ids");
    const { calls } = mockSources(outsideTop);

    const first = await prices(
      cookie,
      "crypto:bitcoin,crypto:obscure-coin,crypto:unknown-coin",
    );

    expect(first.body?.quotes.map(({ id, price }) => [id, price])).toEqual([
      ["crypto:bitcoin", "75966"],
      ["crypto:obscure-coin", "0.5"],
    ]);
    const byId = calls.filter(({ url }) => url.searchParams.has("ids"));
    expect(byId.map(({ url }) => url.searchParams.get("ids"))).toEqual([
      "obscure-coin,unknown-coin",
    ]);

    // Both are cached now, the unknown one too: no new call.
    await prices(cookie, "crypto:obscure-coin,crypto:unknown-coin");
    expect(calls.filter(({ url }) => url.searchParams.has("ids"))).toHaveLength(
      1,
    );
  });

  it.each([
    ["an id without its kind", "bitcoin"],
    ["an id with a space", "crypto:bit coin"],
    [
      "more than 50 ids",
      Array.from({ length: 51 }, (_, i) => `crypto:c${String(i)}`).join(","),
    ],
  ])("refuses %s", async (_, ids) => {
    const { cookie } = await signedIn("ids-bad");
    mockSources(defaultAnswer);
    expect((await prices(cookie, encodeURIComponent(ids))).status).toBe(400);
  });
});

describe("search", () => {
  const SEARCH = {
    coins: [
      {
        id: "litecoin",
        symbol: "LTC",
        name: "Litecoin",
        market_cap_rank: 26,
        large: `${IMAGES}/2/large/litecoin.png`,
      },
      { id: "Bad Id", symbol: "X", name: "X" },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `lite-${String(i)}`,
        symbol: "lt",
        name: `Lite ${String(i)}`,
      })),
    ],
  };

  it("finds coins once a day per search, whatever the case and spaces", async () => {
    const { cookie } = await signedIn("search");
    const { calls } = mockSources(() => json(SEARCH));

    const response = await api("/api/assets/search?q=%20LiteCoin%20", {
      cookie,
    });
    await api("/api/assets/search?q=litecoin", { cookie });

    const { assets } = await response.json<AssetSearchJson>();
    expect(assets).toHaveLength(20);
    expect(assets[0]).toEqual({
      id: "crypto:litecoin",
      symbol: "LTC",
      name: "Litecoin",
      rank: 26,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("query")).toBe("litecoin");
  });

  it.each([
    ["an empty search", ""],
    ["a search longer than 50 characters", "x".repeat(51)],
    ["a search with a hidden character", "bit%E2%80%AEcoin"],
    ["a search on two lines", "bit%0Acoin"],
  ])("refuses %s", async (_, q) => {
    const { cookie } = await signedIn("search-bad");
    mockSources(() => json(SEARCH));
    const response = await api(`/api/assets/search?q=${q}`, { cookie });
    expect(response.status).toBe(400);
  });
});

describe("logos", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const images = (type: string) => (url: URL) =>
    url.hostname === "coin-images.coingecko.com"
      ? new Response(PNG, { headers: { "content-type": type } })
      : defaultAnswer(url);

  it("serves a known coin's logo, the small one, and keeps it a day", async () => {
    const { cookie } = await signedIn("logo");
    const { calls } = mockSources(images("image/png"));
    await prices(cookie);

    const first = await api("/api/assets/crypto:tiny-coin/logo", { cookie });
    const second = await api("/api/assets/crypto:tiny-coin/logo", { cookie });

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(first.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(first.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PNG);
    expect(second.status).toBe(200);
    const fetched = calls.filter(({ url }) =>
      url.hostname.startsWith("coin-images"),
    );
    expect(fetched.map(({ url }) => url.pathname)).toEqual([
      "/coins/images/2/small/tiny.png",
    ]);
  });

  it("serves a cached logo without the database", async () => {
    const { cookie } = await signedIn("logo-cached");
    const { calls } = mockSources(images("image/png"));
    await query(
      `insert into market_cache (key, value, fetched_at, expires_at)
       values ('coingecko:logo:crypto:cached-coin',
               '{"image": "${IMAGES}/5/small/cached.png"}',
               now(), now() + interval '1 day')`,
    );
    const first = await api("/api/assets/crypto:cached-coin/logo", { cookie });
    expect(first.status).toBe(200);

    // Nothing left to say where the logo is: only the cache can answer.
    await query("delete from market_cache where key like 'coingecko:logo:%'");
    const again = await api("/api/assets/crypto:cached-coin/logo", { cookie });

    expect(again.status).toBe(200);
    expect(again.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(PNG);
    expect(calls).toHaveLength(1);
  });

  it("knows a logo from a search too", async () => {
    const { cookie } = await signedIn("logo-search");
    mockSources((url) =>
      url.pathname.endsWith("/search")
        ? json({
            coins: [
              {
                id: "searched-coin",
                symbol: "S",
                name: "Searched",
                large: `${IMAGES}/9/large/searched.png`,
              },
            ],
          })
        : images("image/png")(url),
    );
    await api("/api/assets/search?q=searched", { cookie });

    const response = await api("/api/assets/crypto:searched-coin/logo", {
      cookie,
    });
    expect(response.status).toBe(200);
  });

  it("has none for a coin it has not seen, or one whose logo is on another host", async () => {
    const { cookie } = await signedIn("logo-unknown");
    mockSources(images("image/png"));
    await prices(cookie);

    for (const id of ["crypto:never-seen", "crypto:elsewhere"]) {
      const response = await api(`/api/assets/${id}/logo`, { cookie });
      expect(response.status, id).toBe(404);
    }
  });

  it("refuses a logo over 100 KB", async () => {
    const { cookie } = await signedIn("logo-large");
    mockSources((url) =>
      url.hostname === "coin-images.coingecko.com"
        ? new Response(new Uint8Array(100 * 1024 + 1), {
            headers: { "content-type": "image/png" },
          })
        : defaultAnswer(url),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await prices(cookie);
    // A logo URL not cached by an earlier test.
    await query(
      `update market_cache set value = jsonb_set(value, '{0,image}', '"${IMAGES}/1/small/too-large.png"') where key = 'coingecko:top'`,
    );

    const response = await api("/api/assets/crypto:bitcoin/logo", { cookie });
    expect(response.status).toBe(502);
  });

  it("logs an unexpected failure by its route, never by the coin it named", async () => {
    const { cookie } = await signedIn("logo-error-log");
    mockSources(defaultAnswer);
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // A stored address that cannot be fetched: a bug, not a source failing.
    await query(
      `insert into market_cache (key, value, fetched_at, expires_at)
       values ('coingecko:logo:crypto:secret-coin', '{"image": "not an address"}',
               now(), now() + interval '1 day')`,
    );

    const response = await api("/api/assets/crypto:secret-coin/logo", {
      cookie,
    });

    expect(response.status).toBe(500);
    const lines = logged.mock.calls.map((args) => args.join(" "));
    expect(
      lines.some((line) => line.includes("GET /api/assets/:id/logo")),
    ).toBe(true);
    expect(lines.join("\n")).not.toContain("secret-coin");
  });

  it("refuses an SVG: it is a document that could run script", async () => {
    const { cookie } = await signedIn("logo-svg");
    mockSources(images("image/svg+xml"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await query("delete from market_cache where key like 'coingecko:%'");
    await prices(cookie);
    // A logo URL not cached by an earlier test.
    await query(
      `update market_cache set value = jsonb_set(value, '{0,image}', '"${IMAGES}/1/small/svg-only.png"') where key = 'coingecko:top'`,
    );

    const response = await api("/api/assets/crypto:bitcoin/logo", { cookie });
    expect(response.status).toBe(502);
  });
});

describe("limits", () => {
  it("stops each read that can reach a source at its limit a minute, before any call", async () => {
    const user = await signedIn("market-limits");
    const { calls } = mockSources(defaultAnswer);
    const reads = [
      ["market", 120, "/api/market/prices"],
      [
        "history",
        120,
        "/api/market/history?asset=crypto:bitcoin&from=2026-01-01",
      ],
      ["rates", 60, "/api/market/rates?quotes=EUR&from=2026-01-01"],
      ["search", 60, "/api/assets/search?q=bit"],
    ] as const;
    // Seeded, not sent: every request here keeps a database connection.
    for (const [bucket, limit] of reads) {
      await query(
        `insert into api_rate_limits (user_id, bucket, window_start, count)
         values ($1, $2, now(), $3)`,
        [user.userId, bucket, limit],
      );
    }

    for (const [, , path] of reads) {
      const response = await api(path, { cookie: user.cookie });
      expect(response.status, path).toBe(429);
      expect(response.headers.get("retry-after"), path).toBe("60");
    }
    expect(calls).toEqual([]);
  });

  it("refuses a source's redirect instead of following it", async () => {
    const { cookie } = await signedIn("market-redirect");
    mockSources(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/markets" },
        }),
    );

    expect((await prices(cookie)).status).toBe(502);
  });
});

describe("CoinGecko's budget", () => {
  it("is spent by all users together: past a day's budget, the cache answers, or nothing", async () => {
    const { cookie } = await signedIn("budget-shared");
    const { calls } = mockSources(defaultAnswer);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await prices(cookie)).status).toBe(200);
    await query(
      `update market_cache set fetched_at = now() - interval '11 minutes'
        where key = 'coingecko:top'`,
    );
    await query(`update upstream_calls set day_count = $1`, [
      COINGECKO_BUDGET.perDay,
    ]);

    const stale = await prices(cookie);
    await query("delete from market_cache where key = 'coingecko:top'");
    const none = await prices(cookie);

    expect(stale.status).toBe(200);
    expect(stale.body?.quotes.length).toBeGreaterThan(0);
    expect(none.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("gives each user an hour's budget for coins and searches by name; the snapshot does not count", async () => {
    const user = await signedIn("budget-user");
    const { calls } = mockSources(defaultAnswer);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await query(
      `insert into api_rate_limits (user_id, bucket, window_start, count)
       values ($1, 'coingecko', now(), $2)`,
      [user.userId, COINGECKO_BUDGET.perUserPerHour],
    );

    const snapshot = await prices(user.cookie);
    const byName = await prices(user.cookie, "crypto:new-coin");
    const search = await api("/api/assets/search?q=newcoin", {
      cookie: user.cookie,
    });

    expect(snapshot.status).toBe(200);
    expect(byName.status).toBe(502);
    expect(search.status).toBe(502);
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      "/api/v3/coins/markets",
    ]);
  });
});

describe("what the cache keeps", () => {
  it("nothing about who asked", async () => {
    const user = await signedIn("cache-privacy");
    mockSources((url) => {
      if (url.hostname === "api.frankfurter.dev") {
        return json(fxRows("USD", "GEL", [["2026-03-01", 2.7]]));
      }
      if (url.pathname.endsWith("/search")) return json({ coins: [] });
      if (url.pathname.endsWith("/market_chart")) {
        return json({ prices: [], market_caps: [], total_volumes: [] });
      }
      return defaultAnswer(url);
    });
    await prices(user.cookie);
    await api("/api/assets/search?q=private", { cookie: user.cookie });
    await history(user.cookie, "crypto:held-coin", "2026-03-01");
    await rates(user.cookie, "GEL", "2026-03-01");

    const rows = await query<{ key: string; value: string }>(
      "select key, value::text from market_cache where key like 'coingecko:%' or key like 'frankfurter:%'",
    );
    expect(rows.map(({ key }) => key).sort()).toEqual([
      "coingecko:history:held-coin",
      "coingecko:search:private",
      "coingecko:top",
      "frankfurter:rate:GEL",
    ]);
    for (const { key, value } of rows) {
      for (const personal of [user.userId, user.email, user.ip]) {
        expect(`${key} ${value}`).not.toContain(personal);
      }
    }
  });
});

/** Frankfurter's rows for one pair. */
const fxRows = (base: string, quote: string, points: [string, unknown][]) =>
  points.map(([date, rate]) => ({ date, base, quote, rate }));

/** A day (YYYY-MM-DD, UTC) `days` after `day`. */
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** A day relative to today (UTC). */
const daysFromToday = (days: number) =>
  addDays(new Date().toISOString().slice(0, 10), days);

const history = async (cookie: string, asset: string, from: string) => {
  const response = await api(
    `/api/market/history?asset=${asset}&from=${from}`,
    { cookie },
  );
  return {
    status: response.status,
    body: response.ok ? await response.json<HistoryJson>() : null,
  };
};

const rates = async (cookie: string, quotes: string, from: string) => {
  const response = await api(
    `/api/market/rates?quotes=${quotes}&from=${from}`,
    { cookie },
  );
  return {
    status: response.status,
    body: response.ok ? await response.json<RatesJson>() : null,
  };
};

const frankfurter = (calls: Call[]) =>
  calls.filter(({ url }) => url.hostname === "api.frankfurter.dev");

describe("history from Coin Metrics", () => {
  const BTC = fxRows("BTC", "USD", [
    ["2026-03-01", 61000.5],
    ["2026-03-02", 3.55e-7],
    // 2026-03-03 missing: a gap stays a gap.
    ["2026-03-04", 63000.25],
  ]);

  it("serves a covered coin's prices from the asked day, a value per day, plain digits", async () => {
    const { cookie } = await signedIn("history-cm");
    const { calls } = mockSources(() => json(BTC));

    const { status, body } = await history(
      cookie,
      "crypto:bitcoin",
      "2026-03-02",
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      asset: "crypto:bitcoin",
      currency: "USD",
      source: "coinmetrics",
      prices: { from: "2026-03-02", values: ["0.000000355", null, "63000.25"] },
    });
    const [call] = frankfurter(calls);
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      base: "BTC",
      quotes: "USD",
      providers: "CM",
      from: "2026-02-23",
    });
  });

  it("leaves out rows it cannot read, and days that cannot be", async () => {
    const { cookie } = await signedIn("history-cm-bad");
    mockSources(() =>
      json([
        ...BTC,
        ...fxRows("BTC", "EUR", [["2026-03-03", 1]]),
        ...fxRows("ETH", "USD", [["2026-03-03", 2]]),
        ...fxRows("BTC", "USD", [
          ["2026-03-03", -1],
          ["2026-03-03", "62000"],
          ["2026-02-30", 3],
          ["9999-12-31", 4],
          ["2009-01-03", 5],
        ]),
        null,
        "row",
      ]),
    );

    const { body } = await history(cookie, "crypto:bitcoin", "2026-01-01");

    expect(body?.prices).toEqual({
      from: "2026-03-01",
      values: ["61000.5", "0.000000355", null, "63000.25"],
    });
  });

  it("asks once for everyone; once stale, serves it at once and asks for the last week after the answer", async () => {
    const alice = await signedIn("history-cm-a");
    const bob = await signedIn("history-cm-b");
    const recent = fxRows("BTC", "USD", [
      [daysFromToday(-3), 61000],
      [daysFromToday(-2), 62000],
    ]);
    let answer = recent;
    const { calls } = mockSources(() => json(answer));

    await history(alice.cookie, "crypto:bitcoin", daysFromToday(-3));
    await history(bob.cookie, "crypto:bitcoin", daysFromToday(-3));
    expect(frankfurter(calls)).toHaveLength(1);

    await query(
      "update market_cache set fetched_at = now() - interval '7 hours' where key = 'frankfurter:price:BTC'",
    );
    // A revised last day and a new one.
    answer = fxRows("BTC", "USD", [
      [daysFromToday(-2), 62001],
      [daysFromToday(-1), 63000],
    ]);
    const stale = await history(
      alice.cookie,
      "crypto:bitcoin",
      daysFromToday(-3),
    );

    expect(stale.body?.prices.values).toEqual(["61000", "62000"]);
    await vi.waitFor(async () => {
      const [row] = await query<{ fresh: boolean }>(
        "select fetched_at > now() - interval '1 hour' as fresh from market_cache where key = 'frankfurter:price:BTC'",
      );
      expect(row?.fresh).toBe(true);
    });
    expect(frankfurter(calls)[1]?.url.searchParams.get("from")).toBe(
      daysFromToday(-9),
    );
    const { body } = await history(
      alice.cookie,
      "crypto:bitcoin",
      daysFromToday(-3),
    );
    expect(body?.prices).toEqual({
      from: daysFromToday(-3),
      values: ["61000", "62001", "63000"],
    });
    expect(frankfurter(calls)).toHaveLength(2);
  });

  it("asks a source silent for months again for the last month only", async () => {
    const { cookie } = await signedIn("history-cm-silent");
    const { calls } = mockSources(() => json(BTC));
    await history(cookie, "crypto:bitcoin", "2026-03-01");
    await query(
      "update market_cache set fetched_at = now() - interval '7 hours' where key = 'frankfurter:price:BTC'",
    );

    await history(cookie, "crypto:bitcoin", "2026-03-01");

    await vi.waitFor(() => {
      expect(frankfurter(calls)).toHaveLength(2);
    });
    const since = frankfurter(calls)[1]?.url.searchParams.get("from") ?? "";
    const fetchedDay = new Date(Date.now() - 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(since).toBe(addDays(fetchedDay, -31));
  });

  it("keeps serving what it has while Frankfurter fails, and answers 502 when it has nothing", async () => {
    let up = true;
    const { cookie } = await signedIn("history-cm-down");
    mockSources(() => (up ? json(BTC) : new Response("down", { status: 503 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await history(cookie, "crypto:bitcoin", "2026-03-01");
    await query(
      "update market_cache set fetched_at = now() - interval '7 hours' where key = 'frankfurter:price:BTC'",
    );
    up = false;

    const stale = await history(cookie, "crypto:bitcoin", "2026-03-01");
    const missing = await history(cookie, "crypto:ethereum", "2026-03-01");

    expect(stale.body?.prices).toEqual(first.body?.prices);
    expect(missing.status).toBe(502);
    // One line for the refresh after the stale answer, one for the 502.
    await vi.waitFor(() => {
      expect(log).toHaveBeenCalledTimes(2);
    });
    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      "Market data unavailable: frankfurter: status 503",
      "Market data unavailable: frankfurter: status 503",
    ]);
  });
});

describe("history from CoinGecko", () => {
  const midnight = (day: string) => Date.parse(`${day}T00:00:00Z`);
  const CHART = {
    prices: [
      [midnight("2026-03-05"), 0.5],
      [midnight("2026-03-06"), 4.2e-7],
      [midnight("2026-03-07"), 0.75],
      // The current price, not a day's close.
      [midnight("2026-03-07") + 11 * 60 * 60 * 1000, 0.8],
      [midnight("2026-03-08"), null],
      ["2026-03-09", 1],
    ],
    market_caps: [],
    total_volumes: [],
  };

  it("serves another coin's past year, each close on the day it ends, once a day", async () => {
    const { cookie } = await signedIn("history-cg");
    const { calls } = mockSources(() => json(CHART));

    const first = await history(cookie, "crypto:obscure-coin", "2026-01-01");
    await history(cookie, "crypto:obscure-coin", "2026-01-01");

    expect(first.body).toEqual({
      asset: "crypto:obscure-coin",
      currency: "USD",
      source: "coingecko",
      prices: {
        from: "2026-03-04",
        values: ["0.5", "0.00000042", "0.75"],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe(
      "/api/v3/coins/obscure-coin/market_chart",
    );
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      vs_currency: "usd",
      days: "365",
      interval: "daily",
      precision: "full",
    });
    expect(calls[0]?.headers.get("x-cg-demo-api-key")).toBe(
      "test-coingecko-key",
    );
  });

  it("has nothing for a coin CoinGecko does not know, and does not ask again that day", async () => {
    const { cookie } = await signedIn("history-cg-unknown");
    const { calls } = mockSources(
      () => new Response('{"error":"coin not found"}', { status: 404 }),
    );

    const first = await history(cookie, "crypto:no-such-coin", "2026-01-01");
    await history(cookie, "crypto:no-such-coin", "2026-01-01");

    expect(first.status).toBe(200);
    expect(first.body?.prices.values).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["an asset without its kind", "asset=bitcoin&from=2026-01-01"],
    ["no asset", "from=2026-01-01"],
    ["no day", "asset=crypto:bitcoin"],
    ["a day that does not exist", "asset=crypto:bitcoin&from=2026-02-30"],
    ["a time instead of a day", "asset=crypto:bitcoin&from=2026-01-01T00:00"],
  ])("refuses %s", async (_, params) => {
    const { cookie } = await signedIn("history-bad");
    mockSources(() => json(CHART));
    const response = await api(`/api/market/history?${params}`, { cookie });
    expect(response.status).toBe(400);
  });
});

describe("exchange rates", () => {
  const answer = (url: URL) => {
    const quote = url.searchParams.get("quotes") ?? "";
    return json(
      fxRows("USD", quote, [
        ["2026-03-01", quote === "USDT" ? 1.0014 : 0.9],
        ["2026-03-02", quote === "USDT" ? 0.9986 : 0.91],
      ]),
    );
  };

  it("serves units per dollar for each currency, a stablecoin's from Coin Metrics", async () => {
    const { cookie } = await signedIn("rates");
    const { calls } = mockSources(answer);

    const { status, body } = await rates(cookie, "EUR,USDT,EUR", "2026-03-02");

    expect(status).toBe(200);
    expect(body).toEqual({
      base: "USD",
      rates: {
        EUR: { from: "2026-03-02", values: ["0.91"] },
        USDT: { from: "2026-03-02", values: ["0.9986"] },
      },
    });
    expect(
      frankfurter(calls).map(({ url }) => Object.fromEntries(url.searchParams)),
    ).toEqual([
      { base: "USD", quotes: "EUR", from: "2026-02-23" },
      { base: "USD", quotes: "USDT", from: "2026-02-23", providers: "CM" },
    ]);
  });

  it("adds the days before the cached ones when someone asks for them, and only those", async () => {
    const { cookie } = await signedIn("rates-earlier");
    const { calls } = mockSources(answer);

    await rates(cookie, "EUR", "2026-03-01");
    await rates(cookie, "EUR", "2026-03-01");
    await rates(cookie, "EUR", "2026-01-10");

    expect(
      frankfurter(calls).map(({ url }) => Object.fromEntries(url.searchParams)),
    ).toEqual([
      { base: "USD", quotes: "EUR", from: "2026-02-22" },
      { base: "USD", quotes: "EUR", from: "2026-01-03", to: "2026-02-21" },
    ]);
  });

  it("serves what it has when the source fails while adding earlier days", async () => {
    let up = true;
    const { cookie } = await signedIn("rates-earlier-down");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSources((url) =>
      up ? answer(url) : new Response("down", { status: 503 }),
    );
    const cached = await rates(cookie, "EUR", "2026-03-01");
    up = false;

    const earlier = await rates(cookie, "EUR", "2026-01-10");

    expect(earlier.status).toBe(200);
    expect(earlier.body?.rates).toEqual(cached.body?.rates);
  });

  it("asks for a long range in pieces of a year, newest first, the newest open", async () => {
    const { cookie } = await signedIn("rates-pieces");
    const { calls } = mockSources(answer);
    const asked = daysFromToday(-800);

    const { status } = await rates(cookie, "EUR", asked);

    expect(status).toBe(200);
    expect(
      frankfurter(calls).map(({ url }) => [
        url.searchParams.get("from"),
        url.searchParams.get("to"),
      ]),
    ).toEqual([
      [daysFromToday(-364), null],
      [daysFromToday(-730), daysFromToday(-365)],
      [addDays(asked, -7), daysFromToday(-731)],
    ]);
  });

  it("makes at most 30 calls a request, shared between the currencies; the next request goes on", async () => {
    const { cookie } = await signedIn("rates-share");
    const { calls } = mockSources(answer);
    const ten = "AUD,CAD,CHF,CNY,EUR,GBP,GEL,JPY,PLN,SEK";

    await rates(cookie, ten, "2012-01-01");
    const first = frankfurter(calls).length;
    const perCurrency = Map.groupBy(frankfurter(calls), ({ url }) =>
      url.searchParams.get("quotes"),
    );
    await rates(cookie, "EUR", "2012-01-01");

    expect(first).toBe(30);
    expect([...perCurrency.values()].map((list) => list.length)).toEqual(
      Array.from({ length: 10 }, () => 3),
    );
    // The fourth year back, for EUR only: the newest three are cached.
    expect(frankfurter(calls)[first]?.url.searchParams.get("to")).toBe(
      addDays(
        perCurrency.get("EUR")?.[2]?.url.searchParams.get("from") ?? "",
        -1,
      ),
    );
  });

  it("asks only for the currencies it does not have yet", async () => {
    const { cookie } = await signedIn("rates-cache");
    const { calls } = mockSources(answer);

    await rates(cookie, "EUR", "2026-03-01");
    await rates(cookie, "EUR,GEL", "2026-03-01");

    expect(
      frankfurter(calls).map(({ url }) => url.searchParams.get("quotes")),
    ).toEqual(["EUR", "GEL"]);
  });

  it("keeps each currency it got even when a later one fails, so the next request goes on from there", async () => {
    const { cookie } = await signedIn("rates-partial");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls } = mockSources((url) =>
      url.searchParams.get("quotes") === "GEL"
        ? new Response("down", { status: 503 })
        : answer(url),
    );

    const failed = await rates(cookie, "EUR,GEL", "2026-03-01");
    const kept = await query<{ key: string }>(
      "select key from market_cache where key like 'frankfurter:rate:%' order by key",
    );

    expect(failed.status).toBe(502);
    expect(kept.map(({ key }) => key)).toEqual(["frankfurter:rate:EUR"]);
    expect(
      frankfurter(calls).map(({ url }) => url.searchParams.get("quotes")),
    ).toEqual(["EUR", "GEL"]);
  });

  it.each([
    ["the dollar itself", "USD"],
    ["a code in lower case", "eur"],
    ["a code no central bank publishes", "XYZ"],
    ["a coin", "BTC"],
    ["nothing", ""],
    ["more than 10 currencies", "EUR,GBP,CHF,JPY,GEL,RON,RUB,PLN,CZK,SEK,NOK"],
  ])("refuses %s", async (_, quotes) => {
    const { cookie } = await signedIn("rates-bad");
    mockSources(answer);
    expect((await rates(cookie, quotes, "2026-03-01")).status).toBe(400);
  });
});

describe("how long the cache keeps a source's data", () => {
  it("CoinGecko's a day at most, Frankfurter's 90 days", async () => {
    const { cookie } = await signedIn("cache-lifetimes");
    mockSources((url) =>
      url.hostname === "api.frankfurter.dev"
        ? json(fxRows("USD", "EUR", [["2026-03-01", 0.9]]))
        : json({ prices: [], market_caps: [], total_volumes: [] }),
    );
    await history(cookie, "crypto:obscure-coin", "2026-03-01");
    await rates(cookie, "EUR", "2026-03-01");

    // Postgres sends numeric as text.
    const rows = await query<{ key: string; days: string }>(
      "select key, extract(epoch from expires_at - fetched_at) / 86400 as days from market_cache where key like 'coingecko:%' or key like 'frankfurter:%' order by key",
    );
    expect(rows.map(({ key, days }) => [key, Number(days)])).toEqual([
      ["coingecko:history:obscure-coin", 1],
      ["frankfurter:rate:EUR", 90],
    ]);
  });
});
