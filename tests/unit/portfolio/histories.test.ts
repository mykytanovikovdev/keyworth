import { afterEach, describe, expect, it, vi } from "vitest";
import { askHistory } from "../../../src/features/portfolio/histories.ts";

/*
 * Which requests the browser makes for coins' histories. What the routes
 * answer is tested in tests/integration/market.test.ts.
 */

interface Request {
  method: string;
  path: string;
  /** The coins asked for, as "bitcoin 2026-01-01". */
  coins: string[];
}

const named = ({ asset, from }: { asset: string; from: string }) =>
  `${asset.slice("crypto:".length)} ${from}`;

const historyOf = (asset: string, from: string) => ({
  asset,
  currency: "USD",
  source: "coinmetrics",
  prices: { from, values: [`${asset} alone or together`] },
});

/**
 * The server: `ready` says whether it has a coin ready, `fails` which paths
 * answer 502. Returns the requests made, in order.
 */
function serve({
  ready = () => true,
  fails = () => false,
}: {
  ready?: (asset: string) => boolean;
  fails?: (path: string) => boolean;
} = {}): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((address: string, init: RequestInit = {}) => {
      const url = new URL(address, "https://keyworth.test");
      const method = init.method ?? "GET";
      const assets =
        method === "POST"
          ? (
              JSON.parse(init.body as string) as {
                assets: { asset: string; from: string }[];
              }
            ).assets
          : [
              {
                asset: url.searchParams.get("asset") ?? "",
                from: url.searchParams.get("from") ?? "",
              },
            ];
      requests.push({ method, path: url.pathname, coins: assets.map(named) });
      if (fails(address)) {
        return Promise.resolve(
          Response.json({ error: "market_unavailable" }, { status: 502 }),
        );
      }
      const histories = assets.map(({ asset, from }) => historyOf(asset, from));
      return Promise.resolve(
        Response.json(
          method === "POST"
            ? {
                histories: histories.map((history) =>
                  ready(history.asset) ? history : null,
                ),
              }
            : histories[0],
        ),
      );
    }),
  );
  return requests;
}

const together = (...coins: string[]): Request => ({
  method: "POST",
  path: "/api/market/histories",
  coins,
});
const alone = (coin: string): Request => ({
  method: "GET",
  path: "/api/market/history",
  coins: [coin],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("histories asked for in the same moment", () => {
  it("make one request, and each gets its own, the same coin from two days too", async () => {
    const requests = serve();
    const asked: [string, string][] = [
      ["crypto:bitcoin", "2026-01-01"],
      ["crypto:ethereum", "2025-06-30"],
      ["crypto:bitcoin", "2026-10-26"],
    ];

    const answers = await Promise.all(asked.map((one) => askHistory(...one)));

    expect(requests).toEqual([
      together(
        "bitcoin 2026-01-01",
        "ethereum 2025-06-30",
        "bitcoin 2026-10-26",
      ),
    ]);
    expect(answers).toEqual(asked.map((one) => historyOf(...one)));
  });

  it("name no coin in the address", async () => {
    serve();
    await Promise.all([
      askHistory("crypto:bitcoin", "2026-01-01"),
      askHistory("crypto:ethereum", "2026-01-01"),
    ]);

    expect(vi.mocked(fetch).mock.calls.map(([address]) => address)).toEqual([
      "/api/market/histories",
    ]);
  });

  it("join the request even a few promises later, not one asked for after it left", async () => {
    const requests = serve();

    const first = askHistory("crypto:bitcoin", "2026-01-01");
    await Promise.resolve();
    await Promise.resolve();
    const second = askHistory("crypto:ethereum", "2026-01-01");
    await Promise.all([first, second]);
    await askHistory("crypto:litecoin", "2026-01-01");

    expect(requests).toEqual([
      together("bitcoin 2026-01-01", "ethereum 2026-01-01"),
      alone("litecoin 2026-01-01"),
    ]);
  });

  it("go 20 a request, a last one alone as a single coin", async () => {
    const requests = serve();
    const coins = Array.from({ length: 41 }, (_, i) => `c${String(i)}`);

    const answers = await Promise.all(
      coins.map((coin) => askHistory(`crypto:${coin}`, "2026-01-01")),
    );

    const days = coins.map((coin) => `${coin} 2026-01-01`);
    // Sent at once; which is recorded first does not matter.
    expect(requests.sort((a, b) => b.coins.length - a.coins.length)).toEqual([
      together(...days.slice(0, 20)),
      together(...days.slice(20, 40)),
      alone("c40 2026-01-01"),
    ]);
    expect(answers.map(({ asset }) => asset)).toEqual(
      coins.map((coin) => `crypto:${coin}`),
    );
  });

  it("ask alone for what the server has not ready, and only for that", async () => {
    const requests = serve({ ready: (asset) => asset !== "crypto:rare" });

    const [bitcoin, rare] = await Promise.all([
      askHistory("crypto:bitcoin", "2026-01-01"),
      askHistory("crypto:rare", "2026-02-01"),
    ]);

    expect(requests).toEqual([
      together("bitcoin 2026-01-01", "rare 2026-02-01"),
      alone("rare 2026-02-01"),
    ]);
    expect(bitcoin).toEqual(historyOf("crypto:bitcoin", "2026-01-01"));
    expect(rare).toEqual(historyOf("crypto:rare", "2026-02-01"));
  });

  it("do not wait for a coin asked for alone, nor fail with it", async () => {
    serve({
      ready: (asset) => asset !== "crypto:rare",
      fails: (path) => path.includes("rare"),
    });

    const bitcoin = askHistory("crypto:bitcoin", "2026-01-01");
    const rare = askHistory("crypto:rare", "2026-01-01");

    await expect(rare).rejects.toMatchObject({ status: 502 });
    await expect(bitcoin).resolves.toMatchObject({ asset: "crypto:bitcoin" });
  });

  it("all fail when their request fails, and can be asked for again together", async () => {
    let down = true;
    const requests = serve({ fails: () => down });
    const ask = () =>
      Promise.allSettled([
        askHistory("crypto:bitcoin", "2026-01-01"),
        askHistory("crypto:ethereum", "2026-01-01"),
      ]);

    const failed = await ask();
    down = false;
    const again = await ask();

    expect(failed).toMatchObject([
      { status: "rejected", reason: { status: 502 } },
      { status: "rejected", reason: { status: 502 } },
    ]);
    expect(again.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(requests).toEqual([
      together("bitcoin 2026-01-01", "ethereum 2026-01-01"),
      together("bitcoin 2026-01-01", "ethereum 2026-01-01"),
    ]);
  });

  it.each([
    ["another kind of asset", "stock:AAPL", "2026-01-01"],
    ["a day that does not exist", "crypto:ethereum", "2026-02-30"],
  ])(
    "leave out %s, which the server would refuse them all for",
    async (_, asset, from) => {
      const requests = serve();

      await Promise.all([
        askHistory("crypto:bitcoin", "2026-01-01"),
        askHistory(asset, from),
        askHistory("crypto:litecoin", "2026-01-01"),
      ]);

      const posts = requests.filter(({ method }) => method === "POST");
      expect(posts).toEqual([
        together("bitcoin 2026-01-01", "litecoin 2026-01-01"),
      ]);
      expect(requests).toHaveLength(2);
    },
  );
});
