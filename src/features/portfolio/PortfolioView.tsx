import {
  ArrowDownRight,
  ArrowUpRight,
  Eye,
  EyeOff,
  FileUp,
  Minus,
  PieChart,
  Plus,
} from "lucide-react";
import type { ReactNode } from "react";
import { decimal } from "../../../shared/money/decimal.ts";
import {
  AllocationBar,
  Button,
  Card,
  IconButton,
  SegmentedControl,
  Skeleton,
  TextLink,
  ValueChart,
} from "../../ui/index.ts";
import { AssetLogo } from "../transactions/AssetLogo.tsx";
import {
  groupDigits,
  quantity as quantityText,
} from "../transactions/format.ts";
import {
  axisDate,
  compactMoney,
  fullDate,
  HIDDEN,
  money,
  percent,
  periodWords,
  signedMoney,
  signedPercent,
} from "./format.ts";
import { type Period, PERIODS, type PortfolioSummary } from "./summary.ts";

export interface AssetName {
  symbol: string;
  name: string;
}

export type PortfolioState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; summary: PortfolioSummary };

interface PortfolioViewProps {
  state: PortfolioState;
  baseCurrency: string;
  assetOf: (assetId: string) => AssetName;
  period: Period;
  onPeriodChange?: (period: Period) => void;
  hidden: boolean;
  onHiddenChange?: (hidden: boolean) => void;
  onAdd?: () => void;
  /** Opens "Import transactions": offered while there is nothing yet. */
  onImport?: () => void;
  /** Warnings above the figures: prices that failed, unreadable records. */
  notices?: ReactNode;
  /** "2:20 PM": when today's prices were fetched. */
  pricesAsOf?: string;
  /** False in mockups: logos come from Keyworth's server. */
  useImages?: boolean;
}

/** Gain or loss: sign, arrow and color together, never color alone. */
function Change({
  ratio,
  children,
}: {
  ratio: number | null;
  children: ReactNode;
}) {
  const tone =
    ratio === null || ratio === 0
      ? "text-fg-muted"
      : ratio > 0
        ? "text-gain"
        : "text-loss";
  const Icon =
    ratio === null || ratio === 0
      ? Minus
      : ratio > 0
        ? ArrowUpRight
        : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${tone}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {children}
    </span>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <Card tone="surface" className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <span className="text-xs text-fg-muted">{label}</span>
      <div className="text-base font-semibold tracking-tight break-words tabular-nums sm:text-lg">
        {value}
      </div>
      <span className="text-xs text-fg-muted">{note}</span>
    </Card>
  );
}

function Header({
  onAdd,
  showAdd,
}: {
  onAdd?: (() => void) | undefined;
  showAdd: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
      {showAdd && (
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          {...(onAdd && { onPress: onAdd })}
        >
          Add transaction
        </Button>
      )}
    </div>
  );
}

const PAGE =
  "mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10";

export function PortfolioView({
  state,
  baseCurrency,
  assetOf,
  period,
  onPeriodChange,
  hidden,
  onHiddenChange,
  onAdd,
  onImport,
  notices,
  pricesAsOf,
  useImages = true,
}: PortfolioViewProps) {
  if (state.kind === "loading") {
    return (
      <div aria-busy="true" className={PAGE}>
        <Header showAdd={false} />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-60 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-20" />
          ))}
        </div>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className={PAGE}>
        <Header showAdd={false} />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface text-fg-muted">
            <PieChart aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold">Nothing here yet</h2>
          <p className="max-w-sm text-base text-fg-muted">
            Add what you bought, sold or received. Keyworth works out what you
            hold, what it&apos;s worth and how it&apos;s doing.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="primary"
              icon={<Plus aria-hidden="true" />}
              {...(onAdd && { onPress: onAdd })}
            >
              Add transaction
            </Button>
            <Button
              variant="ghost"
              icon={<FileUp aria-hidden="true" />}
              {...(onImport && { onPress: onImport })}
            >
              Import from a file
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { summary } = state;
  const { chart, pending } = summary.period;
  const show = (text: string) => (hidden ? HIDDEN : text);
  const showMoney = (amount: Parameters<typeof money>[0] | null) =>
    amount ? show(money(amount, baseCurrency)) : "—";
  const words = periodWords(period, {
    from: summary.period.from,
    shortened: summary.period.shortened,
    today: summary.period.to,
  });
  const first = chart[0]?.value;
  const last = chart.at(-1)?.value;
  const trend =
    first !== undefined && last !== undefined
      ? `Portfolio value, ${words}: from ${money(decimal(first.toFixed(2)), baseCurrency)} to ${money(decimal(last.toFixed(2)), baseCurrency)}.`
      : "";

  return (
    <div className={PAGE}>
      <Header showAdd onAdd={onAdd} />
      {notices}

      <section
        aria-label="Total value"
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="min-w-0">
          <h2 className="text-sm text-fg-muted">Total value</h2>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
            {summary.holdings.some((holding) => holding.value !== null)
              ? show(money(summary.total, baseCurrency))
              : "—"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm">
            {pending ? (
              <Skeleton className="h-4 w-40" />
            ) : summary.period.gain ? (
              <Change ratio={summary.period.return}>
                {!hidden && (
                  <span>{signedMoney(summary.period.gain, baseCurrency)}</span>
                )}
                {summary.period.return !== null && (
                  <span>
                    {hidden
                      ? signedPercent(summary.period.return)
                      : `(${signedPercent(summary.period.return)})`}
                  </span>
                )}
              </Change>
            ) : (
              <span className="text-fg-muted">—</span>
            )}
            <span className="text-fg-muted">{words}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            label="Period"
            options={PERIODS.map((id) => ({ id, label: id }))}
            value={period}
            onChange={(id) => onPeriodChange?.(id as Period)}
          />
          <IconButton
            label={hidden ? "Show amounts" : "Hide amounts"}
            onPress={() => onHiddenChange?.(!hidden)}
          >
            {hidden ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
          </IconButton>
        </div>
      </section>

      <section aria-label="Value over time" aria-busy={pending}>
        {pending ? (
          <Skeleton className="h-60 w-full" />
        ) : chart.length > 1 ? (
          <ValueChart
            key={`${period}-${summary.period.from}`}
            values={chart.map(({ value }) => value)}
            labels={chart.map(({ date }) => axisDate(date, period))}
            hoverLabels={chart.map(({ date }) => fullDate(date))}
            format={(value) =>
              show(money(decimal(value.toFixed(2)), baseCurrency))
            }
            formatTick={(value) =>
              hidden ? "" : compactMoney(value, baseCurrency)
            }
            label={trend}
            height={240}
          />
        ) : (
          <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-line px-6 text-center text-sm text-fg-muted">
            {summary.holdings.length > 0 &&
            summary.holdings.every(({ value }) => value === null)
              ? "The chart appears when prices load."
              : "The chart starts after your first full day."}
          </div>
        )}
      </section>

      <section
        aria-label="Key figures"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <Tile
          label="All-time profit"
          value={
            summary.allTimeProfit ? (
              hidden ? (
                HIDDEN
              ) : (
                <Change ratio={summary.allTimeProfit.cmp("0")}>
                  {signedMoney(summary.allTimeProfit, baseCurrency)}
                </Change>
              )
            ) : (
              "—"
            )
          }
          note="Sold and still held"
        />
        <Tile
          label="Income"
          value={
            summary.income
              ? show(signedMoney(summary.income, baseCurrency))
              : "—"
          }
          note="Staking and rewards"
        />
        <Tile
          label="Max drawdown"
          value={
            pending ? (
              <Skeleton className="my-1 h-5 w-16" />
            ) : summary.period.maxDrawdown === null ? (
              "—"
            ) : (
              signedPercent(summary.period.maxDrawdown)
            )
          }
          note={`Deepest fall, ${words}`}
        />
        <Tile
          label="Volatility"
          value={
            pending ? (
              <Skeleton className="my-1 h-5 w-16" />
            ) : summary.period.volatility === null ? (
              "—"
            ) : (
              percent(summary.period.volatility)
            )
          }
          note={`Annualized, ${words}`}
        />
      </section>

      {summary.allocation.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Allocation</h2>
          <AllocationBar
            segments={summary.allocation.map((item) => ({
              id: item.id,
              label: item.id === "other" ? "Other" : assetOf(item.id).symbol,
              share: item.share,
              slot: item.slot,
            }))}
          />
        </section>
      )}

      <section>
        <h2 className="mb-1 text-base font-semibold">Holdings</h2>
        <Holdings
          summary={summary}
          baseCurrency={baseCurrency}
          assetOf={assetOf}
          show={show}
          showMoney={showMoney}
          useImages={useImages}
        />
      </section>

      <p className="text-xs text-fg-muted">
        Prices powered by{" "}
        <TextLink href="https://www.coingecko.com">CoinGecko</TextLink> and{" "}
        <TextLink href="https://coinmetrics.io">Coin Metrics</TextLink>
        {pricesAsOf ? `, as of ${pricesAsOf}.` : "."}
      </p>
    </div>
  );
}

function Holdings({
  summary,
  baseCurrency,
  assetOf,
  show,
  showMoney,
  useImages,
}: {
  summary: PortfolioSummary;
  baseCurrency: string;
  assetOf: (assetId: string) => AssetName;
  show: (text: string) => string;
  showMoney: (amount: PortfolioSummary["total"] | null) => string;
  useImages: boolean;
}) {
  const pnl = (holding: PortfolioSummary["holdings"][number], wide: boolean) =>
    holding.unrealizedPnl === null ? (
      <span className="text-fg-muted">—</span>
    ) : (
      <Change ratio={holding.unrealizedReturn}>
        {wide && (
          <span>{show(signedMoney(holding.unrealizedPnl, baseCurrency))}</span>
        )}
        {holding.unrealizedReturn !== null && (
          <span>
            {wide
              ? `(${signedPercent(holding.unrealizedReturn)})`
              : signedPercent(holding.unrealizedReturn)}
          </span>
        )}
      </Change>
    );

  return (
    <>
      {/* Wide screens: a table. */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-line text-left text-fg-muted">
            <th scope="col" className="py-2.5 font-medium">
              Asset
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Quantity
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Avg. cost
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Price
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Value
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Share
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Profit / loss
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.holdings.map((holding) => {
            const asset = assetOf(holding.assetId);
            return (
              <tr
                key={holding.assetId}
                className="border-b border-line last:border-b-0"
              >
                <th scope="row" className="py-3 pr-3 text-left font-normal">
                  <span className="flex items-center gap-3">
                    <AssetLogo
                      assetId={holding.assetId}
                      symbol={asset.symbol}
                      useImage={useImages}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {asset.name}
                      </span>
                      <span className="block text-fg-muted">
                        {asset.symbol}
                      </span>
                    </span>
                  </span>
                </th>
                <td className="py-3 text-right tabular-nums">
                  {show(groupDigits(holding.quantity.toString()))}
                </td>
                <td className="py-3 text-right text-fg-muted tabular-nums">
                  {showMoney(holding.averageCost)}
                </td>
                <td className="py-3 text-right tabular-nums">
                  {holding.price
                    ? money(holding.price.price, holding.price.currency)
                    : "—"}
                </td>
                <td className="py-3 text-right font-medium tabular-nums">
                  {showMoney(holding.value)}
                </td>
                <td className="py-3 text-right text-fg-muted tabular-nums">
                  {holding.share === null ? "—" : percent(holding.share)}
                </td>
                <td className="py-3 text-right">{pnl(holding, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Narrow screens: one row per asset, the two numbers that matter. */}
      <ul className="divide-y divide-line md:hidden">
        {summary.holdings.map((holding) => {
          const asset = assetOf(holding.assetId);
          return (
            <li
              key={holding.assetId}
              className="flex items-center gap-3 py-3 text-sm"
            >
              <AssetLogo
                assetId={holding.assetId}
                symbol={asset.symbol}
                useImage={useImages}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{asset.name}</span>
                <span className="block truncate text-fg-muted tabular-nums">
                  {show(
                    quantityText(holding.quantity.toString(), asset.symbol),
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-medium tabular-nums">
                  {showMoney(holding.value)}
                </span>
                {pnl(holding, false)}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
