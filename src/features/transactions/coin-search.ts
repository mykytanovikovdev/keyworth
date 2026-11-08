import { useEffect, useState } from "react";
import type { AssetChoice } from "./form-values.ts";

/*
 * Finding a coin by typing. The 250 largest come with the price snapshot that
 * every user loads alike, so matching among them happens here and tells the
 * server nothing; only a coin outside them is searched for on the server.
 */

export interface CoinSource {
  /** The shared snapshot's coins, largest first. */
  top: readonly AssetChoice[];
  /** Any coin, by name or symbol: the server's search. */
  search: (text: string) => Promise<AssetChoice[]>;
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
  const remoteNeeded = !browsing && local.length === 0 && query.length >= 2;
  const [remote, setRemote] = useState<{
    query: string;
    coins: AssetChoice[] | null;
  }>({ query: "", coins: [] });

  useEffect(() => {
    if (!remoteNeeded) return;
    let current = true;
    const timer = window.setTimeout(() => {
      source.search(query).then(
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
  }, [remoteNeeded, query, source]);

  if (!remoteNeeded) {
    return {
      coins: local,
      isLoading: false,
      emptyMessage: "Type at least two letters to search all coins.",
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
