import { useEffect, useState } from "react";
import { type Decimal, decimal } from "../../../shared/money/decimal.ts";
import type { AssetChoice } from "./form-values.ts";

/*
 * Finding a coin by typing. The 250 largest come with the price snapshot that
 * every user loads alike, so matching among them happens here and tells the
 * server nothing; only a coin outside them is searched for on the server. A
 * sale or a transfer out picks among the coins held instead, here alone.
 */

export interface CoinSource {
  /** The coins offered before anything is typed: the snapshot's, largest first. */
  top: readonly AssetChoice[];
  /**
   * Any coin, by name or symbol: the server's search. Without it only `top`
   * can be picked: the coins held, on a sale.
   */
  search?: (text: string) => Promise<AssetChoice[]>;
}

export interface HeldCoin extends AssetChoice {
  /** Units held now, plain digits. */
  quantity: string;
}

/**
 * The coins held, for a sale's list: the largest value first, as on the
 * portfolio (US dollar prices order them as well as any currency would), then
 * the ones without a price, by name.
 */
export function heldCoins(
  held: ReadonlyMap<string, Decimal>,
  assetOf: (assetId: string) => AssetChoice,
  priceOf: (assetId: string) => string | undefined,
): HeldCoin[] {
  const rows = [...held].map(([assetId, quantity]) => {
    const price = priceOf(assetId);
    return {
      coin: { ...assetOf(assetId), quantity: quantity.toString() },
      value: price === undefined ? null : quantity.times(decimal(price)),
    };
  });
  return rows
    .sort((a, b) => {
      if (a.value && b.value) return b.value.cmp(a.value);
      if (a.value || b.value) return a.value ? -1 : 1;
      return a.coin.name.localeCompare(b.coin.name, "en");
    })
    .map(({ coin }) => coin);
}

export interface CoinSearchState {
  coins: readonly AssetChoice[];
  isLoading: boolean;
  /** What the open list says when it has no coins. */
  emptyMessage: string;
}

/** Waits for typing to pause before asking the server. */
const PAUSE_MS = 300;

function matchesLocally(coin: AssetChoice, text: string) {
  const query = text.toLocaleLowerCase("en");
  return (
    coin.symbol.toLocaleLowerCase("en").startsWith(query) ||
    coin.name.toLocaleLowerCase("en").includes(query)
  );
}

export function useCoinSearch(
  source: CoinSource,
  text: string,
  chosen: AssetChoice | null,
): CoinSearchState {
  const query = text.trim();
  // The chosen coin's own name is no search: the list shows the largest.
  const browsing = query === "" || (chosen !== null && text === chosen.name);
  const local = browsing
    ? source.top
    : source.top.filter((coin) => matchesLocally(coin, query));
  const { search } = source;
  const remoteNeeded =
    search !== undefined &&
    !browsing &&
    local.length === 0 &&
    query.length >= 2;
  const [remote, setRemote] = useState<{
    query: string;
    coins: AssetChoice[] | null;
  }>({ query: "", coins: [] });

  useEffect(() => {
    if (!remoteNeeded) return;
    let current = true;
    const timer = window.setTimeout(() => {
      search(query).then(
        (coins) => {
          if (current) setRemote({ query, coins });
        },
        () => {
          if (current) setRemote({ query, coins: null });
        },
      );
    }, PAUSE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [remoteNeeded, query, search]);

  if (!remoteNeeded) {
    return {
      coins: local,
      isLoading: false,
      emptyMessage: search
        ? "Type at least two letters to search all coins."
        : `None of your coins match "${query}".`,
    };
  }
  const answered = remote.query === query;
  return {
    coins: answered ? (remote.coins ?? []) : [],
    isLoading: !answered,
    emptyMessage:
      answered && remote.coins === null
        ? "Search isn't available right now. Try again in a minute."
        : `No coins match "${query}".`,
  };
}
