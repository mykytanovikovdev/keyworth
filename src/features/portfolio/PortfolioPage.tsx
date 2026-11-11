import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { addDays, utcDate } from "../../../shared/metrics/ledger.ts";
import { Button, Notice } from "../../ui/index.ts";
import { useTransactionEditor } from "../transactions/editor.tsx";
import {
  historyQuery,
  priceSeries,
  quoteLookup,
  rateLookup,
  ratesQuery,
} from "./market-data.ts";
import { PortfolioNotices } from "./PortfolioNotices.tsx";
import { type PortfolioState, PortfolioView } from "./PortfolioView.tsx";
import { useHiddenAmounts, usePeriod } from "./preferences.ts";
import { summarize } from "./summary.ts";

/*
 * The portfolio page, the app's start page: the decrypted transactions, today's
 * prices, each coin's history and the rates between currencies, put together
 * by summarize() and shown by PortfolioView. "Add transaction" opens the same
 * form as the transactions page.
 */

const TIME = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });

export function PortfolioPage() {
  const {
    userId,
    transactions,
    snapshot,
    outside,
    baseCurrency,
    assetOf,
    openAdd,
    dialog,
  } = useTransactionEditor();
  const [period, setPeriod] = usePeriod();
  const [hidden, setHidden] = useHiddenAmounts();
  const today = new Date().toISOString().slice(0, 10);

  const records = useMemo(
    () => transactions.data?.records ?? [],
    [transactions.data],
  );
  // The first day each coin was held: its history is asked from then.
  const firstDays = useMemo(() => {
    const first = new Map<string, string>();
    for (const { value } of records) {
      const day = utcDate(value.executedAt);
      const known = first.get(value.assetId);
      if (!known || day < known) first.set(value.assetId, day);
    }
    return first;
  }, [records]);
  const firstDay = [...firstDays.values()].sort()[0] ?? today;
  const currencies = useMemo(
    () => [
      ...new Set([
        baseCurrency,
        ...records.flatMap(({ value }): string[] => {
          switch (value.type) {
            case "buy":
            case "sell":
              return value.feeCurrency
                ? [value.priceCurrency, value.feeCurrency]
                : [value.priceCurrency];
            case "transfer_in":
            case "income":
              return [value.priceCurrency];
            default:
              return [];
          }
        }),
      ]),
    ],
    [baseCurrency, records],
  );
  // A week earlier: a first transaction on a weekend needs Friday's rate.
  const rates = useQuery(ratesQuery(userId, currencies, addDays(firstDay, -7)));
  const ratesNeeded = currencies.some((code) => code !== "USD");
  const assetIds = useMemo(() => [...firstDays.keys()], [firstDays]);
  // Combined into one stable value: a new array every render would redo the
  // whole summary each time.
  const histories = useQueries({
    queries: [...firstDays].map(([assetId, from]) =>
      historyQuery(userId, assetId, from),
    ),
    combine: (results) => ({
      data: results.map(({ data }) => data),
      failed: results.map(({ isError }) => isError),
      ready: results.every(({ isPending }) => !isPending),
    }),
  });

  const quote = useMemo(
    () => quoteLookup(snapshot.data, outside.data),
    [snapshot.data, outside.data],
  );
  const pricesFailed = snapshot.isError || (ratesNeeded && rates.isError);
  // isLoading, not isPending: a query with nothing to ask stays pending.
  const pricesLoading =
    snapshot.isPending || outside.isLoading || (ratesNeeded && rates.isLoading);

  const summary = useMemo(() => {
    if (!transactions.data || records.length === 0 || pricesLoading) {
      return null;
    }
    const series = new Map(
      assetIds.map((assetId, index) => {
        const history = histories.data[index];
        const now = quote(assetId);
        return [
          assetId,
          history
            ? priceSeries(
                history,
                now ? { date: today, price: now.price.toString() } : undefined,
              )
            : null,
        ];
      }),
    );
    return summarize(records, {
      money: { baseCurrency, rate: rateLookup(rates.data ?? {}) },
      quote,
      history: histories.ready
        ? (assetId) => series.get(assetId) ?? null
        : null,
      period,
      today,
    });
  }, [
    transactions.data,
    records,
    pricesLoading,
    assetIds,
    histories,
    quote,
    baseCurrency,
    rates.data,
    period,
    today,
  ]);

  if (transactions.isError) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col items-start gap-4 px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
        <Notice tone="error">
          Your transactions couldn&apos;t load. Check your connection and try
          again.
        </Notice>
        <Button onPress={() => void transactions.refetch()}>Try again</Button>
      </div>
    );
  }

  const state: PortfolioState = transactions.isPending
    ? { kind: "loading" }
    : records.length === 0
      ? { kind: "empty" }
      : summary
        ? { kind: "ready", summary }
        : { kind: "loading" };

  const held = summary?.holdings ?? [];
  const symbols = (assetIds: string[]) =>
    assetIds.map((assetId) => assetOf(assetId).symbol);
  const unpriced = symbols(
    held.filter(({ price }) => price === null).map(({ assetId }) => assetId),
  );
  const uncharted = symbols(
    held
      .filter(
        ({ assetId, price }) =>
          price !== null &&
          histories.failed[assetIds.indexOf(assetId)] === true,
      )
      .map(({ assetId }) => assetId),
  );

  return (
    <>
      <PortfolioView
        state={state}
        baseCurrency={baseCurrency}
        assetOf={assetOf}
        period={period}
        onPeriodChange={setPeriod}
        hidden={hidden}
        onHiddenChange={setHidden}
        onAdd={openAdd}
        notices={
          <PortfolioNotices
            damaged={transactions.data?.damaged.length ?? 0}
            unpriced={unpriced}
            uncharted={uncharted}
            pricesFailed={pricesFailed}
            oversold={
              summary?.issues.some(({ kind }) => kind === "oversold") ?? false
            }
            onRetry={() => {
              void snapshot.refetch();
              void outside.refetch();
              if (ratesNeeded) void rates.refetch();
            }}
          />
        }
        {...(snapshot.data &&
          !pricesFailed && {
            pricesAsOf: TIME.format(new Date(snapshot.data.fetchedAt)),
          })}
      />
      {dialog}
    </>
  );
}
