import { STABLECOINS } from "../../shared/schemas/currencies.ts";
import type { DailyPoint } from "./series.ts";
import { fetchJson, MarketError, plainDigits, plausible } from "./upstream.ts";

/*
 * Frankfurter, no key: central banks' exchange rates, blended across the banks
 * that publish each currency, and Coin Metrics' daily reference rates for 35
 * large coins, USDT and USDC among them (CC BY-NC 4.0: non-commercial use, with
 * credit). See docs/market-data.md.
 */

export const FRANKFURTER = "frankfurter";
const API = "https://api.frankfurter.dev/v2";
/** A whole series since 2010 is about 400 KB. */
const MAX_JSON_BYTES = 1024 * 1024;
/** Frankfurter's key for Coin Metrics. Its blend mixes in exchanges' rates. */
const COIN_METRICS = "CM";

/**
 * CoinGecko id to Coin Metrics code, written out: a symbol names different
 * coins on different lists. Each pair was checked on 2026-11-07 by comparing
 * the two sources' prices (all within 5%).
 */
export const COIN_METRICS_CODES: ReadonlyMap<string, string> = new Map([
  ["aave", "AAVE"],
  ["algorand", "ALGO"],
  ["aptos", "APT"],
  ["arbitrum", "ARB"],
  ["avalanche-2", "AVAX"],
  ["axie-infinity", "AXS"],
  ["bitcoin", "BTC"],
  ["bitcoin-cash", "BCH"],
  ["cardano", "ADA"],
  ["chainlink", "LINK"],
  ["chiliz", "CHZ"],
  ["cosmos", "ATOM"],
  ["curve-dao-token", "CRV"],
  ["decentraland", "MANA"],
  ["ethena", "ENA"],
  ["ethereum", "ETH"],
  ["ethereum-classic", "ETC"],
  ["filecoin", "FIL"],
  ["havven", "SNX"],
  ["hedera-hashgraph", "HBAR"],
  ["internet-computer", "ICP"],
  ["litecoin", "LTC"],
  ["near", "NEAR"],
  ["ondo-finance", "ONDO"],
  ["polkadot", "DOT"],
  ["polygon-ecosystem-token", "POL"],
  ["ripple", "XRP"],
  ["solana", "SOL"],
  ["stellar", "XLM"],
  ["sui", "SUI"],
  ["tether", "USDT"],
  ["tezos", "XTZ"],
  ["uniswap", "UNI"],
  ["usd-coin", "USDC"],
  ["zcash", "ZEC"],
]);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One pair, day by day from `since`. Rows are checked by hand rather than with
 * zod: a series has thousands, and zod's jitless parsing costs too much CPU per
 * row for a Worker. A row that does not fit is left out.
 */
async function pair(
  base: string,
  quote: string,
  since: string,
  provider?: string,
): Promise<DailyPoint[]> {
  const url = new URL(`${API}/rates`);
  url.searchParams.set("base", base);
  url.searchParams.set("quotes", quote);
  url.searchParams.set("from", since);
  if (provider) url.searchParams.set("providers", provider);
  const body = await fetchJson(FRANKFURTER, url, {}, MAX_JSON_BYTES);
  if (!Array.isArray(body)) {
    throw new MarketError(FRANKFURTER, "unexpected answer");
  }
  const points: DailyPoint[] = [];
  for (const row of body as unknown[]) {
    if (typeof row !== "object" || row === null) continue;
    const fields = row as Record<string, unknown>;
    const { date, rate } = fields;
    if (
      fields.base !== base ||
      fields.quote !== quote ||
      typeof date !== "string" ||
      !DAY.test(date) ||
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      !plausible(rate)
    ) {
      continue;
    }
    points.push([date, plainDigits(rate)]);
  }
  return points;
}

const isStablecoin = (code: string) =>
  (STABLECOINS as readonly string[]).includes(code);

/**
 * Units of a currency per US dollar. Asked this way round, Frankfurter gives
 * five significant digits, plenty for converting a portfolio. A stablecoin's
 * rate is Coin Metrics' only.
 */
export function ratesSince(code: string, since: string) {
  return pair(
    "USD",
    code,
    since,
    isStablecoin(code) ? COIN_METRICS : undefined,
  );
}

/**
 * A coin's price in US dollars at each day's end (00:00 UTC), from Coin
 * Metrics. Asked as the coin's rate to the dollar, it keeps every digit; the
 * other way round has five.
 */
export function coinMetricsPricesSince(code: string, since: string) {
  return pair(code, "USD", since, COIN_METRICS);
}
