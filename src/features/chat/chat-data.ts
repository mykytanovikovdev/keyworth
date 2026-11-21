import type { QueryClient } from "@tanstack/react-query";
import type { PriceSeries } from "../../../shared/metrics/history.ts";
import {
  addDays,
  type MoneyContext,
  type TransactionEntry,
} from "../../../shared/metrics/ledger.ts";
import type { PriceQuote } from "../../../shared/metrics/valuation.ts";
import type { PricesJson } from "../../../shared/schemas/market.ts";
import { DEFAULT_BASE_CURRENCY } from "../../../shared/schemas/settings.ts";
import { currenciesOf, firstDaysOf } from "../portfolio/inputs.ts";
import {
  historyQuery,
  priceSeries,
  quoteLookup,
  rateLookup,
  ratesQuery,
} from "../portfolio/market-data.ts";
import {
  type Period,
  type PortfolioSummary,
  summarize,
} from "../portfolio/summary.ts";
import { settingsQuery } from "../settings/settings-record.ts";
import type { AssetChoice } from "../transactions/form-values.ts";
import {
  assetsOf,
  outsideSnapshot,
  quotesQueries,
  snapshotQuery,
} from "../transactions/market.ts";
import { transactionsQuery } from "../transactions/queries.ts";

/*
 * What the chat's tools read: the decrypted transactions, the settings and the
 * market data, through the same queries as the portfolio and transactions
 * pages, so a question asked after looking at the portfolio costs no request.
 * Everything named after the user's coins is cached under ["vault", …] and
 * goes when the vault locks.
 */

/** How far back a coin's prices go when no transaction sets the start. */
const COIN_HISTORY_DAYS = 365;

export interface ChatData {
  records: readonly TransactionEntry[];
  baseCurrency: string;
  /** YYYY-MM-DD in UTC. */
  today: string;
  money: MoneyContext;
  /** Today's price, in its own currency (US dollars); null when unknown. */
  quote: (assetId: string) => PriceQuote | null;
  /** A coin's name and ticker; its id's last part when unknown. */
  assetOf: (assetId: string) => AssetChoice;
  /** The portfolio over a period, as the portfolio page computes it. */
  summary: (period: Period) => Promise<PortfolioSummary>;
  /** A coin's daily closes from a day, with today's price; null when unknown. */
  history: (assetId: string, from: string) => Promise<PriceSeries | null>;
  /** Today's prices of coins that may be outside the shared snapshot. */
  quotes: (assetIds: readonly string[]) => Promise<void>;
}

/** "crypto:bitcoin" → "BITCOIN", until the coin's real symbol is known. */
const fallbackName = (assetId: string) =>
  (assetId.split(":")[1] ?? assetId).toUpperCase();

export async function loadChatData(
  client: QueryClient,
  userId: string,
): Promise<ChatData> {
  const today = new Date().toISOString().slice(0, 10);
  const [list, settings, snapshot] = await Promise.all([
    client.query(transactionsQuery(userId)),
    client.query(settingsQuery(userId)),
    client.query(snapshotQuery),
  ]);
  const records = list.records;
  const baseCurrency = settings?.value?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
  const firstDays = firstDaysOf(records);
  const firstDay = [...firstDays.values()].sort()[0] ?? today;

  // Prices of coins held outside the snapshot, then of any asked about later.
  const answers: PricesJson[] = [snapshot];
  const fetchQuotes = async (assetIds: Iterable<string>) => {
    const outside = outsideSnapshot(snapshot, assetIds);
    const fetched = await Promise.all(
      quotesQueries(userId, outside).map((query) => client.query(query)),
    );
    answers.push(...fetched);
  };
  await fetchQuotes(firstDays.keys());
  const quote = (assetId: string) => quoteLookup(...answers)(assetId);
  const assetOf = (assetId: string): AssetChoice =>
    answers.flatMap(assetsOf).find(({ id }) => id === assetId) ?? {
      id: assetId,
      symbol: fallbackName(assetId),
      name: fallbackName(assetId),
    };

  // One set of rates for every question: from a week before the first
  // transaction (a weekend needs Friday's rate), or a year back for prices.
  const ratesFrom =
    [addDays(firstDay, -7), addDays(today, -COIN_HISTORY_DAYS - 7)].sort()[0] ??
    today;
  const rates = await client.query(
    ratesQuery(userId, currenciesOf(records, baseCurrency), ratesFrom),
  );
  const money: MoneyContext = { baseCurrency, rate: rateLookup(rates) };

  const history = async (assetId: string, from: string) => {
    try {
      const answer = await client.query(historyQuery(userId, assetId, from));
      const now = quote(assetId);
      return priceSeries(
        answer,
        now ? { date: today, price: now.price.toString() } : undefined,
      );
    } catch {
      return null;
    }
  };

  const summary = async (period: Period) => {
    const series = new Map(
      await Promise.all(
        [...firstDays].map(
          async ([assetId, from]) =>
            [assetId, await history(assetId, from)] as const,
        ),
      ),
    );
    return summarize(records, {
      money,
      quote,
      history: (assetId) => series.get(assetId) ?? null,
      period,
      today,
    });
  };

  return {
    records,
    baseCurrency,
    today,
    money,
    quote,
    assetOf,
    summary,
    history,
    quotes: fetchQuotes,
  };
}
