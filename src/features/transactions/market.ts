import { queryOptions, type UseQueryResult } from "@tanstack/react-query";
import { type Decimal, decimal } from "../../../shared/money/decimal.ts";
import {
  type AssetSearchJson,
  cryptoAssetIdSchema,
  type HistoryJson,
  MARKET_LIMITS,
  type PricesJson,
  type QuoteJson,
  type RatesJson,
} from "../../../shared/schemas/market.ts";
import { ApiError } from "../../vault/api.ts";
import type { AssetChoice } from "./form-values.ts";
import type { PriceOnDay } from "./TransactionForm.tsx";

/*
 * Market data for the transaction screens, from Keyworth's own server (the
 * page may connect nowhere else). The snapshot of the 250 largest coins is the
 * same request for everyone and says nothing about a user, so it is cached as
 * shared data. Anything asked for by name (a coin outside it, a price on a
 * day) says what the user holds: those are cached under ["vault", …], which
 * the app clears when the vault locks.
 */

/** A JSON answer from Keyworth's server; anything but 2xx is an `ApiError`. */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      const parsed = (await response.json()) as unknown;
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON: the status alone has to do.
    }
    throw new ApiError(response.status, body);
  }
  return (await response.json()) as T;
}

const FIVE_MINUTES = 5 * 60 * 1000;

const choiceOf = ({ id, symbol, name }: QuoteJson): AssetChoice => ({
  id,
  symbol,
  name,
});

/** The 250 largest coins and their prices: the same for every user. */
export const snapshotQuery = queryOptions({
  queryKey: ["market", "snapshot"],
  queryFn: () => getJson<PricesJson>("/api/market/prices"),
  staleTime: FIVE_MINUTES,
});

/** Coins outside the snapshot, by id: what the user holds, so a vault query. */
export const quotesQuery = (userId: string, ids: readonly string[]) => {
  const asked = [...new Set(ids)].sort().slice(0, MARKET_LIMITS.idsPerRequest);
  return queryOptions({
    queryKey: ["vault", userId, "quotes", ...asked],
    queryFn: () =>
      getJson<PricesJson>(
        `/api/market/prices?ids=${encodeURIComponent(asked.join(","))}`,
      ),
    enabled: asked.length > 0,
    staleTime: FIVE_MINUTES,
  });
};

/**
 * The coins to ask for by name: those the snapshot does not have. None until
 * the snapshot is in: before it, every coin would look outside, and the
 * server would learn ones it already gives everyone. Only crypto ids the
 * route takes: another kind would make it refuse the whole request.
 */
export function outsideSnapshot(
  snapshot: PricesJson | undefined,
  assetIds: Iterable<string>,
): string[] {
  if (!snapshot) return [];
  const inSnapshot = new Set(snapshot.quotes.map(({ id }) => id));
  return [...new Set(assetIds)].filter(
    (id) => !inSnapshot.has(id) && cryptoAssetIdSchema.safeParse(id).success,
  );
}

/** Coins outside the snapshot as queries of at most 50, all of them asked. */
export function quotesQueries(userId: string, ids: readonly string[]) {
  const sorted = [...new Set(ids)].sort();
  const queries = [];
  for (let at = 0; at < sorted.length; at += MARKET_LIMITS.idsPerRequest) {
    queries.push(
      quotesQuery(userId, sorted.slice(at, at + MARKET_LIMITS.idsPerRequest)),
    );
  }
  return queries;
}

/**
 * Those queries read as one answer: the quotes that have come, still loading
 * while any is, and one refetch for all. For `useQueries`' `combine`; kept
 * outside components, so the result is recomputed only when results change.
 */
export function combineQuotes(results: UseQueryResult<PricesJson>[]) {
  const answers = results.flatMap(({ data }) => (data ? [data] : []));
  const data: PricesJson | undefined =
    answers.length === 0
      ? undefined
      : {
          currency: "USD",
          fetchedAt: answers
            .map(({ fetchedAt }) => fetchedAt)
            .reduce((a, b) => (b < a ? b : a)),
          quotes: answers.flatMap(({ quotes }) => quotes),
        };
  return {
    data,
    isLoading: results.some(({ isLoading }) => isLoading),
    refetch: () => Promise.all(results.map(({ refetch }) => refetch())),
  };
}

export const assetsOf = (prices: PricesJson | undefined): AssetChoice[] =>
  prices?.quotes.map(choiceOf) ?? [];

/** Any coin by name or symbol: the server's search, kept a day under its text. */
export async function searchCoins(text: string): Promise<AssetChoice[]> {
  const found = await getJson<AssetSearchJson>(
    `/api/assets/search?q=${encodeURIComponent(text)}`,
  );
  return found.assets.map(({ id, symbol, name }) => ({ id, symbol, name }));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE = decimal("1");
const dayBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** The last value of a series on or before a day: a holiday keeps the rate before it. */
export function valueOn(
  series: { from: string; values: (string | null)[] } | undefined,
  day: string,
): string | null {
  if (!series) return null;
  const start = Date.parse(`${series.from}T00:00:00Z`);
  const index = Math.round((Date.parse(`${day}T00:00:00Z`) - start) / DAY_MS);
  for (let i = Math.min(index, series.values.length - 1); i >= 0; i--) {
    const value = series.values[i];
    if (value) return value;
  }
  return null;
}

/** A price to offer: cents for a coin worth a dollar or more, six significant digits below. */
function offered(price: Decimal): string {
  // Strict decimals take no plain numbers, 1 included.
  return price.gte(ONE) ? price.round(2).toFixed(2) : price.prec(6).toString();
}

/**
 * A coin's price on a day, in a currency: the day's close from its history,
 * or the current price for today, converted at the day's rate. Null when the
 * sources have none. Today's price comes from what the page already has
 * (`priceNow`, the snapshot of the 250 largest included) before the coin is
 * asked for by name, so a coin in the snapshot is never named to the server.
 */
export async function priceOnDay(
  assetId: string,
  day: string,
  currency: string,
  today: string,
  priceNow: (assetId: string) => string | undefined = () => undefined,
): Promise<PriceOnDay | null> {
  let usd: string | null;
  let source: string;
  if (day >= today) {
    usd =
      priceNow(assetId) ??
      (
        await getJson<PricesJson>(
          `/api/market/prices?ids=${encodeURIComponent(assetId)}`,
        )
      ).quotes[0]?.price ??
      null;
    source = "CoinGecko";
  } else {
    const history = await getJson<HistoryJson>(
      `/api/market/history?asset=${encodeURIComponent(assetId)}&from=${day}`,
    );
    usd =
      history.prices.from === day ? (history.prices.values[0] ?? null) : null;
    source = history.source === "coinmetrics" ? "Coin Metrics" : "CoinGecko";
  }
  if (usd === null) return null;
  if (currency === "USD") return { price: offered(decimal(usd)), source };
  // A week back, so a weekend or a rate not yet published has one before it.
  const rates = await getJson<RatesJson>(
    `/api/market/rates?quotes=${encodeURIComponent(currency)}&from=${dayBefore(day, 7)}`,
  );
  const rate = valueOn(rates.rates[currency], day);
  if (rate === null) return null;
  return { price: offered(decimal(usd).times(decimal(rate))), source };
}
