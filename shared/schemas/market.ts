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
} as const;

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
