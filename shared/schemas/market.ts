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
} as const;

/** The first day with a market price for Bitcoin: no series starts earlier. */
export const HISTORY_START = "2010-07-18";

/** A UTC day, as `from` in the history and rates requests. */
export const daySchema = z.iso.date();

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

export interface RatesJson {
  base: "USD";
  /** Units of each currency per US dollar, by code. */
  rates: Record<string, DailySeriesJson>;
}
