import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssetSearchJson,
  PricesJson,
} from "../../shared/schemas/market.ts";
import {
  api,
  expectWorkerHeaders,
  fetchWorker,
  query,
  signedIn,
} from "./helpers.ts";

/*
 * Market data through the real routes, with CoinGecko's answers replaced at
 * fetch. The cache is shared by every user, so each test starts it empty.
 */

const IMAGES = "https://coin-images.coingecko.com/coins/images";

interface Call {
  url: URL;
  headers: Headers;
}

/**
 * Answers CoinGecko's requests with `answer`, records them, and refuses any other
 * host. Install it after signing in: the sign-in helper's own fetch mock restores
 * the real fetch when it is done, which would remove this one.
 */
function mockSources(answer: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (!url.hostname.endsWith("coingecko.com")) {
        throw new Error(`Unexpected request to ${url.hostname}`);
      }
      calls.push({ url, headers: request.headers });
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
  await query("delete from market_cache where key like 'coingecko:%'");
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

describe("what the cache keeps", () => {
  it("nothing about who asked", async () => {
    const user = await signedIn("cache-privacy");
    mockSources((url) =>
      url.pathname.endsWith("/search")
        ? json({ coins: [] })
        : defaultAnswer(url),
    );
    await prices(user.cookie);
    await api("/api/assets/search?q=private", { cookie: user.cookie });

    const rows = await query<{ key: string; value: string }>(
      "select key, value::text from market_cache where key like 'coingecko:%'",
    );
    expect(rows.map(({ key }) => key).sort()).toEqual([
      "coingecko:search:private",
      "coingecko:top",
    ]);
    for (const { key, value } of rows) {
      for (const personal of [user.userId, user.email, user.ip]) {
        expect(`${key} ${value}`).not.toContain(personal);
      }
    }
  });
});
