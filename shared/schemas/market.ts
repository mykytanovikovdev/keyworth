import { z } from "./zod.ts";

/*
 * What /api/market and /api/assets return. An asset id names its kind and its
 * source's id: "crypto:" and CoinGecko's, so stocks can join later without a
 * clash. Types only for responses: the browser trusts its own server.
 */

export const cryptoAssetIdSchema = z.string().regex(/^crypto:[a-z0-9-]{1,90}$/);

export const MARKET_LIMITS = {
  /** Asset ids in one prices request. */
  idsPerRequest: 50,
  /** Characters in a search. */
  queryLength: 50,
  /** Results of a search. */
  searchResults: 20,
  /** Currencies in one rates request. */
  quotesPerRequest: 10,
  /** Coins in one request for several histories. */
  historiesPerRequest: 20,
} as const;

/** The first day with a market price for Bitcoin: no series starts earlier. */
export const HISTORY_START = "2010-07-18";

/** A UTC day, as `from` in the history and rates requests. */
export const daySchema = z.iso.date();

/** A coin's history, from a day. */
export const historyRequestSchema = z.strictObject({
  asset: cryptoAssetIdSchema,
  from: daySchema,
});

/** The body of `POST /api/market/histories`: coins, each from its own day. */
export const historiesRequestSchema = z.strictObject({
  assets: z
    .array(historyRequestSchema)
    .min(1)
    .max(MARKET_LIMITS.historiesPerRequest),
});

export type HistoriesRequest = z.infer<typeof historiesRequestSchema>;

export interface AssetJson {
  id: string;
  /** Upper case, as exchanges show it. */
  symbol: string;
  name: string;
  /** By market capitalization; null when the source does not rank it. */
  rank: number | null;
}

export interface QuoteJson extends AssetJson {
  /** In US dollars, plain digits. */
  price: string;
}

export interface PricesJson {
  currency: "USD";
  /** When the oldest of these prices was fetched (ISO 8601). */
  fetchedAt: string;
  /** Newer prices are being loaded: asked for again in a moment, they are there. */
  refreshing: boolean;
  quotes: QuoteJson[];
}

export interface AssetSearchJson {
  assets: AssetJson[];
}

/**
 * One value per UTC day: `values[i]` is for `from` plus i days, null where the
 * source has none. Days, not dated points: half the size, and no date to parse.
 */
export interface DailySeriesJson {
  from: string;
  values: (string | null)[];
}

export interface HistoryJson {
  asset: string;
  currency: "USD";
  /** Whose prices these are: the screen credits them next to the chart. */
  source: "coinmetrics" | "coingecko";
  /** The price at each day's end (00:00 UTC), plain digits; the latest day is yesterday. */
  prices: DailySeriesJson;
}

export interface HistoriesJson {
  /** In the order asked; null: not ready in the cache, ask for it on its own. */
  histories: (HistoryJson | null)[];
}

export interface RatesJson {
  base: "USD";
  /** Units of each currency per US dollar, by code. */
  rates: Record<string, DailySeriesJson>;
}
