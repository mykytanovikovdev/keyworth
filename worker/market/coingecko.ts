import { decimal } from "../../shared/money/decimal.ts";
import {
  type AssetJson,
  MARKET_LIMITS,
  type QuoteJson,
} from "../../shared/schemas/market.ts";
import { z } from "../../shared/schemas/zod.ts";
import { cleanText, fetchJson, MarketError } from "./upstream.ts";

/*
 * CoinGecko's Demo API: the coin list and search, current prices and logos.
 * Its answers are checked and reduced to what Keyworth shows before anything
 * keeps them. Its terms ask for "Powered by CoinGecko" next to its data and a
 * cache refreshed at least daily (see docs/market-data.md).
 */

export const COINGECKO = "coingecko";
const API = "https://api.coingecko.com/api/v3";
const IMAGE_HOST = "coin-images.coingecko.com";
const MAX_JSON_BYTES = 2 * 1024 * 1024;

/** A quote, and where its logo is: the logo route needs it, the browser never sees it. */
export interface StoredQuote extends QuoteJson {
  image: string | null;
}

export interface StoredAsset extends AssetJson {
  image: string | null;
}

const coingeckoId = z.string().regex(/^[a-z0-9-]{1,90}$/);

const coinSchema = z.object({
  id: coingeckoId,
  symbol: z.string(),
  name: z.string(),
  image: z.string().nullish(),
  current_price: z.number().nullable(),
  market_cap_rank: z.number().int().positive().nullish(),
});

const searchSchema = z.object({
  coins: z.array(z.unknown()),
});

const searchCoinSchema = z.object({
  id: coingeckoId,
  symbol: z.string(),
  name: z.string(),
  market_cap_rank: z.number().int().positive().nullish(),
  large: z.string().nullish(),
});

/** The small variant on CoinGecko's image host, or nothing. */
function logoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== IMAGE_HOST) return null;
  url.pathname = url.pathname.replace(/\/(thumb|large)\//, "/small/");
  return url.toString();
}

function asset(fields: {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank?: number | null | undefined;
}): AssetJson {
  return {
    id: `crypto:${fields.id}`,
    symbol: cleanText(fields.symbol, 20).toUpperCase(),
    name: cleanText(fields.name, 100),
    rank: fields.market_cap_rank ?? null,
  };
}

/** Coins it cannot read are left out rather than failing the whole answer. */
function quotesFrom(body: unknown): StoredQuote[] {
  if (!Array.isArray(body))
    throw new MarketError(COINGECKO, "unexpected answer");
  return body.flatMap((item): StoredQuote[] => {
    const coin = coinSchema.safeParse(item);
    if (!coin.success) return [];
    const price = coin.data.current_price;
    if (price === null || !Number.isFinite(price) || price < 0) return [];
    return [
      {
        ...asset(coin.data),
        // JSON brings a float, possibly written as 3.55e-7: plain digits from here on.
        price: decimal(String(price)).toString(),
        image: logoUrl(coin.data.image),
      },
    ];
  });
}

function get(apiKey: string, path: string, params: Record<string, string>) {
  const url = new URL(`${API}${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return fetchJson(
    COINGECKO,
    url,
    { "x-cg-demo-api-key": apiKey },
    MAX_JSON_BYTES,
  );
}

const marketsParams = {
  vs_currency: "usd",
  order: "market_cap_desc",
  per_page: "250",
  page: "1",
  sparkline: "false",
  precision: "full",
};

/** The 250 largest coins by market capitalization. One call. */
export async function topQuotes(apiKey: string): Promise<StoredQuote[]> {
  return quotesFrom(await get(apiKey, "/coins/markets", marketsParams));
}

/** These coins (CoinGecko ids, at most 250). One call. */
export async function quotesFor(
  apiKey: string,
  ids: readonly string[],
): Promise<StoredQuote[]> {
  return quotesFrom(
    await get(apiKey, "/coins/markets", {
      ...marketsParams,
      ids: ids.join(","),
    }),
  );
}

export async function searchCoins(
  apiKey: string,
  query: string,
): Promise<StoredAsset[]> {
  const body = searchSchema.safeParse(await get(apiKey, "/search", { query }));
  if (!body.success) throw new MarketError(COINGECKO, "unexpected answer");
  return body.data.coins
    .flatMap((item): StoredAsset[] => {
      const coin = searchCoinSchema.safeParse(item);
      return coin.success
        ? [{ ...asset(coin.data), image: logoUrl(coin.data.large) }]
        : [];
    })
    .slice(0, MARKET_LIMITS.searchResults);
}
