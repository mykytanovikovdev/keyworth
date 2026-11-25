import { type Context, Hono } from "hono";
import {
  FIAT_CURRENCIES,
  STABLECOINS,
} from "../../shared/schemas/currencies.ts";
import { hasHiddenCharacters } from "../../shared/schemas/text.ts";
import {
  type AssetJson,
  type AssetSearchJson,
  cryptoAssetIdSchema,
  daySchema,
  historiesRequestSchema,
  type HistoriesJson,
  type HistoryJson,
  MARKET_LIMITS,
  type PricesJson,
  type QuoteJson,
  type RatesJson,
} from "../../shared/schemas/market.ts";
import type { AppEnv } from "../env.ts";
import { maxBody, rateLimit, readJson } from "../limits.ts";
import { spendCoinGeckoCall } from "../market/budget.ts";
import {
  afterAnswer,
  type Cached,
  cached,
  type Defer,
  readCached,
  storeCached,
} from "../market/cache.ts";
import {
  COINGECKO,
  dailyHistory,
  quotesFor,
  searchCoins,
  type StoredAsset,
  type StoredQuote,
  topQuotes,
} from "../market/coingecko.ts";
import {
  COIN_METRICS_CODES,
  coinMetricsPricesSince,
  FRANKFURTER,
  ratesSince,
} from "../market/frankfurter.ts";
import {
  dailySeries,
  emptySeries,
  keptSeries,
  mergeSeries,
  type SeriesRequest,
  sliceSeries,
  type StoredSeries,
} from "../market/series.ts";
import { fetchImage, MarketError } from "../market/upstream.ts";

/*
 * /api/market and /api/assets: prices, history, exchange rates, search and
 * logos, for signed-in users. Everyone gets the same snapshot of the 250
 * largest coins, so a request for it says nothing about what anyone owns. Only
 * coins outside it, a coin's history and a currency's rates are asked for by
 * name. See worker/market/docs/market-data.md.
 */

export const market = new Hono<AppEnv>();
export const assets = new Hono<AppEnv>();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Older than fresh, prices are shown with their time while newer ones load;
// past an hour they are too old for that (owner's decision, 2026-11-25).
const PRICES = { freshForMs: 10 * MINUTE, serveForMs: HOUR, keepForMs: DAY };
// CoinGecko's terms: refresh what is kept at least once a day.
const SEARCH = { freshForMs: DAY, keepForMs: DAY };
const COINGECKO_HISTORY = { freshForMs: 12 * HOUR, keepForMs: DAY };
// Frankfurter's past days do not change; a refresh asks for the last week again.
const SERIES = { freshForMs: 6 * HOUR, keepForMs: 90 * DAY };
const LOGO_MAX_BYTES = 100 * 1024;

const TOP = `${COINGECKO}:top`;
const quoteKey = (id: string) => `${COINGECKO}:quote:${id}`;
const searchKey = (query: string) => `${COINGECKO}:search:${query}`;
const logoKey = (id: string) => `${COINGECKO}:logo:${id}`;
const historyKey = (id: string) => `${COINGECKO}:history:${id}`;
const coinMetricsKey = (code: string) => `${FRANKFURTER}:price:${code}`;
const rateKey = (code: string) => `${FRANKFURTER}:rate:${code}`;

/** Currencies with a rate to the dollar: the dollar itself needs none. */
const RATE_CODES: ReadonlySet<string> = new Set([
  ...FIAT_CURRENCIES.flatMap(([code]) => (code === "USD" ? [] : [code])),
  ...STABLECOINS,
]);

/** Work that may finish after the answer, such as refreshing stale prices. */
const later =
  (c: Context<AppEnv>): Defer =>
  (work) => {
    c.executionCtx.waitUntil(work());
  };

/** A source's failure is a 502 and one log line, which names neither assets nor searches. */
function onMarketError(error: Error, c: Context<AppEnv>) {
  if (!(error instanceof MarketError)) throw error;
  console.error(`Market data unavailable: ${error.message}`);
  return c.json({ error: "market_unavailable" }, 502);
}
market.onError(onMarketError);
assets.onError(onMarketError);

// Where a logo is stays on the server: the browser asks /api/assets/:id/logo.
const publicAsset = ({ id, symbol, name, rank }: StoredAsset): AssetJson => ({
  id,
  symbol,
  name,
  rank,
});
const publicQuote = (quote: StoredQuote): QuoteJson => ({
  ...publicAsset(quote),
  price: quote.price,
});

/** The snapshot's own request loads it again; others take it as it is. */
const asItIs: Defer = () => undefined;

function topSnapshot(c: Context<AppEnv>, defer: Defer) {
  return cached(
    c.get("db"),
    TOP,
    PRICES,
    async () => {
      await spendCoinGeckoCall(c, { forUser: false });
      return topQuotes(c.env.COINGECKO_API_KEY);
    },
    defer,
  );
}

/** A coin outside the snapshot; `quote` is null for one the source does not know. */
interface QuoteEntry {
  quote: StoredQuote | null;
}

/**
 * Coins outside the snapshot, each cached on its own; the ones not fresh are
 * fetched together in one call, after the answer when every one of them is
 * cached and recent enough to serve. A coin the source does not know is cached
 * too, so asking again does not spend another call.
 */
async function quotesOutsideTop(
  c: Context<AppEnv>,
  ids: readonly string[],
): Promise<{ entries: Cached<QuoteEntry>[]; refreshing: boolean }> {
  const db = c.get("db");
  const known = await readCached<QuoteEntry>(db, ids.map(quoteKey));
  const ageOf = (id: string) => {
    const entry = known.get(quoteKey(id));
    return entry ? Date.now() - entry.fetchedAt.getTime() : Infinity;
  };
  const missing = ids.filter((id) => ageOf(id) >= PRICES.freshForMs);
  const refreshing =
    missing.length > 0 && missing.every((id) => ageOf(id) < PRICES.serveForMs);
  const fetchedAt = new Date();
  const found = new Map<string, StoredQuote>();
  const load = async () => {
    await spendCoinGeckoCall(c, { forUser: true });
    const quotes = await quotesFor(
      c.env.COINGECKO_API_KEY,
      missing.map((id) => id.slice("crypto:".length)),
    );
    for (const quote of quotes) found.set(quote.id, quote);
    await storeCached(
      db,
      missing.map((id) => ({
        key: quoteKey(id),
        value: { quote: found.get(id) ?? null },
      })),
      PRICES.keepForMs,
    );
  };
  if (refreshing) {
    later(c)(() => afterAnswer(load));
  } else if (missing.length > 0) {
    try {
      await load();
    } catch (error) {
      // Stale but unexpired entries stand in, as for the snapshot.
      if (
        !(error instanceof MarketError) ||
        missing.some((id) => !known.has(quoteKey(id)))
      ) {
        throw error;
      }
    }
  }
  const entries = ids.flatMap((id) => {
    const quote = found.get(id);
    if (quote) return [{ value: { quote }, fetchedAt }];
    const entry = known.get(quoteKey(id));
    return entry ? [entry] : [];
  });
  return { entries, refreshing };
}

const limitPrices = rateLimit("market", 120);

/** The snapshot; with `?ids=`, those coins only, wherever they come from. */
market.get("/prices", limitPrices, async (c) => {
  const param = c.req.query("ids");
  if (param === undefined) {
    const top = await topSnapshot(c, later(c));
    return c.json<PricesJson>({
      currency: "USD",
      fetchedAt: top.fetchedAt.toISOString(),
      refreshing: top.refreshing,
      quotes: top.value.map(publicQuote),
    });
  }

  const ids = [...new Set(param.split(","))];
  if (
    ids.length > MARKET_LIMITS.idsPerRequest ||
    !ids.every((id) => cryptoAssetIdSchema.safeParse(id).success)
  ) {
    return c.json({ error: "invalid_ids" }, 400);
  }
  const top = await topSnapshot(c, asItIs);
  const inTop = new Map(top.value.map((quote) => [quote.id, quote]));
  const outside = await quotesOutsideTop(
    c,
    ids.filter((id) => !inTop.has(id)),
  );
  const entries: Cached<QuoteEntry>[] = [
    ...ids.flatMap((id) => {
      const quote = inTop.get(id);
      return quote ? [{ value: { quote }, fetchedAt: top.fetchedAt }] : [];
    }),
    ...outside.entries,
  ];
  const times = entries.map(({ fetchedAt }) => fetchedAt.getTime());
  const oldest = times.length > 0 ? Math.min(...times) : Date.now();
  return c.json<PricesJson>({
    currency: "USD",
    fetchedAt: new Date(oldest).toISOString(),
    refreshing: outside.refreshing,
    quotes: entries.flatMap(({ value }) =>
      value.quote ? [publicQuote(value.quote)] : [],
    ),
  });
});

const limitHistory = rateLimit("history", 120);

/** A coin's history from Coin Metrics, by its code there. */
const coinMetricsRequest = (code: string, from: string): SeriesRequest => ({
  key: coinMetricsKey(code),
  from,
  load: (since, until) => coinMetricsPricesSince(code, since, until),
});

/**
 * A coin's daily prices from `from` (a day): Coin Metrics' long history for the
 * 35 coins it covers, otherwise CoinGecko's past year. One source per coin, so
 * a chart has no seam where two sources disagree.
 */
market.get("/history", limitHistory, async (c) => {
  const asset = c.req.query("asset") ?? "";
  const from = c.req.query("from") ?? "";
  if (!cryptoAssetIdSchema.safeParse(asset).success) {
    return c.json({ error: "invalid_asset" }, 400);
  }
  if (!daySchema.safeParse(from).success) {
    return c.json({ error: "invalid_from" }, 400);
  }
  const db = c.get("db");
  const id = asset.slice("crypto:".length);
  const code = COIN_METRICS_CODES.get(id);
  if (code) {
    const [series] = await dailySeries(
      db,
      [coinMetricsRequest(code, from)],
      SERIES,
      later(c),
    );
    return c.json<HistoryJson>({
      asset,
      currency: "USD",
      source: "coinmetrics",
      prices: sliceSeries(series ?? emptySeries(), from),
    });
  }
  const { value } = await cached(
    db,
    historyKey(id),
    COINGECKO_HISTORY,
    async () => {
      await spendCoinGeckoCall(c, { forUser: true });
      return mergeSeries(null, await dailyHistory(c.env.COINGECKO_API_KEY, id));
    },
  );
  return c.json<HistoryJson>({
    asset,
    currency: "USD",
    source: "coingecko",
    prices: sliceSeries(value, from),
  });
});

/**
 * Several coins' histories in one request, from the cache alone: a portfolio's
 * chart needs all of its coins, and each request costs a session check and a
 * counter. What is not cached from the day asked is null, and the browser asks
 * for that coin above, so a slow source holds up no other coin. A POST: which
 * coins someone holds, and since when, stays out of the address.
 */
market.post("/histories", limitHistory, maxBody(4 * 1024), async (c) => {
  const body = historiesRequestSchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: "invalid_body" }, 400);
  const coins = body.data.assets.map(({ asset, from }) => {
    const id = asset.slice("crypto:".length);
    const code = COIN_METRICS_CODES.get(id);
    const series = code ? coinMetricsRequest(code, from) : undefined;
    return { asset, from, id, series };
  });
  const db = c.get("db");
  const known = await readCached<StoredSeries>(db, [
    ...new Set(coins.map(({ id, series }) => series?.key ?? historyKey(id))),
  ]);
  const kept = keptSeries(
    db,
    known,
    coins.flatMap(({ series }) => series ?? []),
    SERIES,
    later(c),
  );
  // Stale, CoinGecko's is loaded again before it is served: no refresh of days.
  const fresh = (id: string) => {
    const entry = known.get(historyKey(id));
    return entry &&
      Date.now() - entry.fetchedAt.getTime() < COINGECKO_HISTORY.freshForMs
      ? entry.value
      : undefined;
  };
  return c.json<HistoriesJson>({
    histories: coins.map(({ asset, from, id, series }) => {
      const prices = series ? kept.get(series) : fresh(id);
      return prices
        ? {
            asset,
            currency: "USD",
            source: series ? "coinmetrics" : "coingecko",
            prices: sliceSeries(prices, from),
          }
        : null;
    }),
  });
});

const limitRates = rateLimit("rates", 60);

/** Units of each currency per US dollar, day by day from `from`. */
market.get("/rates", limitRates, async (c) => {
  const quotes = [...new Set((c.req.query("quotes") ?? "").split(","))];
  const from = c.req.query("from") ?? "";
  if (
    quotes.length > MARKET_LIMITS.quotesPerRequest ||
    !quotes.every((code) => RATE_CODES.has(code))
  ) {
    return c.json({ error: "invalid_quotes" }, 400);
  }
  if (!daySchema.safeParse(from).success) {
    return c.json({ error: "invalid_from" }, 400);
  }
  const series = await dailySeries(
    c.get("db"),
    quotes.map((code) => ({
      key: rateKey(code),
      from,
      load: (since: string, until?: string) => ratesSince(code, since, until),
    })),
    SERIES,
    later(c),
  );
  return c.json<RatesJson>({
    base: "USD",
    rates: Object.fromEntries(
      quotes.map((code, index) => [
        code,
        sliceSeries(series[index] ?? emptySeries(), from),
      ]),
    ),
  });
});

const limitSearch = rateLimit("search", 60);

assets.get("/search", limitSearch, async (c) => {
  const raw = c.req.query("q") ?? "";
  // One spelling per search for the cache: composed, lower case, no edges.
  const query = raw.normalize("NFC").trim().toLowerCase();
  if (
    query.length === 0 ||
    query.length > MARKET_LIMITS.queryLength ||
    hasHiddenCharacters(raw)
  ) {
    return c.json({ error: "invalid_query" }, 400);
  }
  const db = c.get("db");
  const found = await cached(db, searchKey(query), SEARCH, async () => {
    await spendCoinGeckoCall(c, { forUser: true });
    return searchCoins(c.env.COINGECKO_API_KEY, query);
  });
  // Where their logos are, for coins outside the snapshot.
  await storeCached(
    db,
    found.value.flatMap(({ id, image }) =>
      image ? [{ key: logoKey(id), value: { image } }] : [],
    ),
    SEARCH.keepForMs,
  );
  return c.json<AssetSearchJson>({ assets: found.value.map(publicAsset) });
});

/**
 * A coin's logo, through Keyworth: the page's CSP allows images from its own
 * origin only, and fetching from CoinGecko directly would tell it what the user
 * owns. Kept in Cloudflare's cache for a day, under this route's own address:
 * a portfolio asks for dozens at once, and a cached one needs no database.
 */
assets.get("/:id/logo", async (c) => {
  const id = c.req.param("id");
  if (!cryptoAssetIdSchema.safeParse(id).success) {
    return c.json({ error: "invalid_id" }, 400);
  }
  // The same for everyone; the address names the coin only, never the user.
  const cacheKey = new Request(new URL(`/api/assets/${id}/logo`, c.req.url));
  const cached = await caches.default.match(cacheKey);
  if (cached) return logoResponse(c, cached);

  // Where its logo is: in the snapshot, its own quote, or a search result.
  const known = await readCached<unknown>(c.get("db"), [
    TOP,
    quoteKey(id),
    logoKey(id),
  ]);
  const inTop = known.get(TOP)?.value as StoredQuote[] | undefined;
  const single = known.get(quoteKey(id))?.value as QuoteEntry | undefined;
  const searched = known.get(logoKey(id))?.value as
    { image: string } | undefined;
  const image =
    inTop?.find((entry) => entry.id === id)?.image ??
    single?.quote?.image ??
    searched?.image ??
    null;
  if (!image) return c.json({ error: "unknown_asset" }, 404);

  const logo = await fetchImage(COINGECKO, new URL(image), LOGO_MAX_BYTES);
  const stored = new Response(logo.body, {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": `max-age=${String(DAY / 1000)}`,
    },
  });
  await caches.default.put(cacheKey, stored.clone());
  return logoResponse(c, stored);
});

async function logoResponse(c: Context<AppEnv>, stored: Response) {
  return c.body(await stored.arrayBuffer(), 200, {
    "Content-Type": stored.headers.get("Content-Type") ?? "image/png",
    // Not user data, and the same for everyone: the browser may keep it.
    "Cache-Control": `private, max-age=${String(DAY / 1000)}`,
  });
}
