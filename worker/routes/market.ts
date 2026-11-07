import { type Context, Hono } from "hono";
import {
  type AssetJson,
  type AssetSearchJson,
  cryptoAssetIdSchema,
  MARKET_LIMITS,
  type PricesJson,
  type QuoteJson,
} from "../../shared/schemas/market.ts";
import type { AppEnv } from "../env.ts";
import { rateLimit } from "../limits.ts";
import {
  type Cached,
  cached,
  readCached,
  storeCached,
} from "../market/cache.ts";
import {
  COINGECKO,
  quotesFor,
  searchCoins,
  type StoredAsset,
  type StoredQuote,
  topQuotes,
} from "../market/coingecko.ts";
import { fetchImage, MarketError } from "../market/upstream.ts";

/*
 * /api/market and /api/assets: prices, search and logos, for signed-in users.
 * Everyone gets the same snapshot of the 250 largest coins, so a request for it
 * says nothing about what anyone owns. Only coins outside it are asked for by
 * id. See worker/market/docs/market-data.md.
 */

export const market = new Hono<AppEnv>();
export const assets = new Hono<AppEnv>();

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const PRICES = { freshForMs: 10 * MINUTE, keepForMs: DAY };
// CoinGecko's terms: refresh what is kept at least once a day.
const SEARCH = { freshForMs: DAY, keepForMs: DAY };
const LOGO_MAX_BYTES = 100 * 1024;

const TOP = `${COINGECKO}:top`;
const quoteKey = (id: string) => `${COINGECKO}:quote:${id}`;
const searchKey = (query: string) => `${COINGECKO}:search:${query}`;
const logoKey = (id: string) => `${COINGECKO}:logo:${id}`;

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

function topSnapshot(c: Context<AppEnv>) {
  return cached(c.get("db"), TOP, PRICES, () =>
    topQuotes(c.env.COINGECKO_API_KEY),
  );
}

/** A coin outside the snapshot; `quote` is null for one the source does not know. */
interface QuoteEntry {
  quote: StoredQuote | null;
}

/**
 * Coins outside the snapshot, each cached on its own; the ones not cached are
 * fetched together in one call. A coin the source does not know is cached too,
 * so asking again does not spend another call.
 */
async function quotesOutsideTop(
  c: Context<AppEnv>,
  ids: readonly string[],
): Promise<Cached<QuoteEntry>[]> {
  const db = c.get("db");
  const known = await readCached<QuoteEntry>(db, ids.map(quoteKey));
  const fresh = (id: string) => {
    const entry = known.get(quoteKey(id));
    return entry && Date.now() - entry.fetchedAt.getTime() < PRICES.freshForMs
      ? entry
      : undefined;
  };
  const missing = ids.filter((id) => !fresh(id));
  const fetchedAt = new Date();
  const found = new Map<string, StoredQuote>();
  if (missing.length > 0) {
    try {
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
  return ids.flatMap((id) => {
    const quote = found.get(id);
    if (quote) return [{ value: { quote }, fetchedAt }];
    const entry = known.get(quoteKey(id));
    return entry ? [entry] : [];
  });
}

const limitPrices = rateLimit("market", 120);

/** The snapshot; with `?ids=`, those coins only, wherever they come from. */
market.get("/prices", limitPrices, async (c) => {
  const top = await topSnapshot(c);
  const param = c.req.query("ids");
  if (param === undefined) {
    return c.json<PricesJson>({
      currency: "USD",
      fetchedAt: top.fetchedAt.toISOString(),
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
    ...outside,
  ];
  const oldest = Math.min(
    ...entries.map(({ fetchedAt }) => fetchedAt.getTime()),
    top.fetchedAt.getTime(),
  );
  return c.json<PricesJson>({
    currency: "USD",
    fetchedAt: new Date(oldest).toISOString(),
    quotes: entries.flatMap(({ value }) =>
      value.quote ? [publicQuote(value.quote)] : [],
    ),
  });
});

const limitSearch = rateLimit("search", 60);

assets.get("/search", limitSearch, async (c) => {
  const query = (c.req.query("q") ?? "").trim().toLowerCase();
  if (query.length === 0 || query.length > MARKET_LIMITS.queryLength) {
    return c.json({ error: "invalid_query" }, 400);
  }
  const db = c.get("db");
  const found = await cached(db, searchKey(query), SEARCH, () =>
    searchCoins(c.env.COINGECKO_API_KEY, query),
  );
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
 * owns. Kept in Cloudflare's cache for a day.
 */
assets.get("/:id/logo", async (c) => {
  const id = c.req.param("id");
  if (!cryptoAssetIdSchema.safeParse(id).success) {
    return c.json({ error: "invalid_id" }, 400);
  }
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

  const cacheKey = new Request(image);
  let stored = await caches.default.match(cacheKey);
  if (!stored) {
    const logo = await fetchImage(COINGECKO, new URL(image), LOGO_MAX_BYTES);
    stored = new Response(logo.body, {
      headers: {
        "Content-Type": logo.type,
        "Cache-Control": `max-age=${String(DAY / 1000)}`,
      },
    });
    await caches.default.put(cacheKey, stored.clone());
  }
  return c.body(await stored.arrayBuffer(), 200, {
    "Content-Type": stored.headers.get("Content-Type") ?? "image/png",
    // Not user data, and the same for everyone: the browser may keep it.
    "Cache-Control": `private, max-age=${String(DAY / 1000)}`,
  });
});
