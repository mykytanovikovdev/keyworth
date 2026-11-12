import { Settings } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import type { PriceSeries } from "../../shared/metrics/history.ts";
import type { TransactionEntry } from "../../shared/metrics/ledger.ts";
import { decimal } from "../../shared/money/decimal.ts";
import type { Transaction } from "../../shared/schemas/transaction.ts";
import { PortfolioNotices } from "../features/portfolio/PortfolioNotices.tsx";
import {
  type AssetName,
  PortfolioView,
} from "../features/portfolio/PortfolioView.tsx";
import { type Period, summarize } from "../features/portfolio/summary.ts";
import {
  ButtonLink,
  KeyworthMark,
  showToast,
  ThemeToggle,
} from "../ui/index.ts";
import { AppNav } from "./AppNav.tsx";

/*
 * Mockups of the 4.4 portfolio page, for review before it is wired up (dev and
 * design builds only). Transactions and prices are made up, deterministically;
 * every figure comes from the real calculations (summary.ts, shared/metrics).
 * `?screen=<id>` opens one; `&bare` hides the switcher, for screenshots.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);
const HISTORY_DAYS = 440;

interface Coin extends AssetName {
  id: string;
  now: number;
  /** Daily: how much the made-up price moves. */
  swing: number;
  drift: number;
}

const COINS: Coin[] = [
  {
    id: "crypto:bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    now: 92540,
    swing: 0.026,
    drift: 0.0012,
  },
  {
    id: "crypto:ethereum",
    symbol: "ETH",
    name: "Ethereum",
    now: 3175.6,
    swing: 0.034,
    drift: 0.0005,
  },
  {
    id: "crypto:solana",
    symbol: "SOL",
    name: "Solana",
    now: 180.9,
    swing: 0.042,
    drift: 0.0009,
  },
  {
    id: "crypto:litecoin",
    symbol: "LTC",
    name: "Litecoin",
    now: 85.7,
    swing: 0.033,
    drift: 0.0004,
  },
  {
    id: "crypto:usd-coin",
    symbol: "USDC",
    name: "USDC",
    now: 1,
    swing: 0.0004,
    drift: 0,
  },
  {
    id: "crypto:dogecoin",
    symbol: "DOGE",
    name: "Dogecoin",
    now: 0.21,
    swing: 0.05,
    drift: 0,
  },
  {
    id: "crypto:chainlink",
    symbol: "LINK",
    name: "Chainlink",
    now: 17.4,
    swing: 0.04,
    drift: 0.0003,
  },
  {
    id: "crypto:pudgy-penguins",
    symbol: "PENGU",
    name: "Pudgy Penguins",
    now: 0.031,
    swing: 0.07,
    drift: 0.001,
  },
];

const assetOf = (assetId: string): AssetName =>
  COINS.find((coin) => coin.id === assetId) ?? { symbol: "?", name: assetId };

/** A seeded generator: the same mockup every time. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plain digits, as the transaction schema wants them. */
const plain = (value: number) =>
  value >= 1 ? value.toFixed(2) : value.toFixed(6);

/** A random walk that ends at today's price. */
const SERIES = new Map<string, PriceSeries>(
  COINS.map((coin, index) => {
    const random = seeded(index + 7);
    const prices = [coin.now];
    for (let day = 1; day < HISTORY_DAYS; day++) {
      // Two uniforms make a bell-ish move; enough for a mockup.
      const move = (random() + random() - 1) * coin.swing * 1.7 + coin.drift;
      const before = (prices[0] ?? coin.now) / (1 + move);
      prices.unshift(coin.symbol === "USDC" ? 1 + (before - 1) * 0.2 : before);
    }
    return [
      coin.id,
      {
        currency: "USD",
        points: prices.map((price, day) => ({
          date: daysAgo(HISTORY_DAYS - 1 - day),
          price: decimal(plain(price)),
        })),
      },
    ];
  }),
);

const priceOn = (assetId: string, date: string) =>
  SERIES.get(assetId)?.points.find((point) => point.date === date)?.price ??
  decimal("1");

let nextId = 1;
function entry(
  type: "buy" | "sell" | "income",
  symbol: string,
  quantity: string,
  days: number,
): TransactionEntry {
  const coin = COINS.find((c) => c.symbol === symbol);
  if (!coin) throw new Error(symbol);
  const date = daysAgo(days);
  const value: Transaction = {
    type,
    assetId: coin.id,
    executedAt: `${date}T10:00:00.000Z`,
    quantity,
    price: priceOn(coin.id, date).toString(),
    priceCurrency: "USD",
    source: "manual",
  };
  nextId++;
  return { id: `t${String(nextId)}`, value };
}

const BASE: TransactionEntry[] = [
  entry("buy", "BTC", "0.15", 420),
  entry("buy", "ETH", "3", 400),
  entry("buy", "LTC", "45", 360),
  entry("buy", "DOGE", "5000", 330),
  entry("buy", "ETH", "1.5", 300),
  entry("buy", "SOL", "32", 280),
  entry("buy", "BTC", "0.1", 250),
  entry("buy", "USDC", "2400", 180),
  entry("sell", "ETH", "0.5", 150),
  entry("sell", "DOGE", "5000", 110),
  entry("income", "ETH", "0.1", 90),
];

const MORE: TransactionEntry[] = [
  ...BASE,
  entry("buy", "LINK", "60", 200),
  entry("buy", "PENGU", "40000", 60),
];

const FIRST_DAY: TransactionEntry[] = [entry("buy", "BTC", "0.05", 0)];

const money = { baseCurrency: "USD", rate: () => null };

function Demo({
  entries,
  missing = [],
  pricesFailed = false,
  damaged = 0,
  oversold = false,
  hidden: startHidden = false,
  historyPending = false,
}: {
  entries: TransactionEntry[];
  /** Coins with no price today and no history. */
  missing?: string[];
  pricesFailed?: boolean;
  damaged?: number;
  oversold?: boolean;
  hidden?: boolean;
  /** Prices are here, histories still loading. */
  historyPending?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("1M");
  const [hidden, setHidden] = useState(startHidden);
  const known = (assetId: string) =>
    !pricesFailed && !missing.includes(assetOf(assetId).symbol);
  const summary = useMemo(
    () =>
      summarize(entries, {
        money,
        quote: (assetId) => {
          const last = SERIES.get(assetId)?.points.at(-1);
          return known(assetId) && last
            ? { price: last.price, currency: "USD" }
            : null;
        },
        history: historyPending
          ? null
          : (assetId) =>
              known(assetId) ? (SERIES.get(assetId) ?? null) : null,
        period,
        today: TODAY,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed per screen
    [entries, period],
  );
  return (
    <MockShell>
      <PortfolioView
        state={{ kind: "ready", summary }}
        baseCurrency="USD"
        assetOf={assetOf}
        period={period}
        onPeriodChange={setPeriod}
        hidden={hidden}
        onHiddenChange={setHidden}
        onAdd={() => {
          showToast("The form from /design/transactions opens here");
        }}
        notices={
          <PortfolioNotices
            damaged={damaged}
            unpriced={missing}
            pricesFailed={pricesFailed}
            oversold={oversold}
            onRetry={() => {
              showToast("Trying again…");
            }}
          />
        }
        {...(!pricesFailed && { pricesAsOf: "2:20 PM" })}
        useImages={false}
      />
    </MockShell>
  );
}

function MockShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 px-4 sm:flex-nowrap sm:px-6">
          <div className="flex h-14 items-center gap-6">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <KeyworthMark />
              <span className="max-[359px]:sr-only">Keyworth</span>
            </span>
          </div>
          <AppNav
            items={[
              { href: "/design/portfolio", label: "Portfolio", current: true },
              {
                href: "/design/transactions",
                label: "Transactions",
                current: false,
              },
            ]}
          />
          <div className="flex h-14 items-center gap-2 sm:ml-auto">
            <ThemeToggle />
            <ButtonLink
              href="/design/transactions?screen=settings-currency"
              variant="ghost"
              size="sm"
              icon={<Settings aria-hidden="true" />}
            >
              Settings
            </ButtonLink>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

function Static({ state }: { state: "loading" | "empty" }) {
  return (
    <MockShell>
      <PortfolioView
        state={{ kind: state }}
        baseCurrency="USD"
        assetOf={assetOf}
        period="1M"
        hidden={false}
        onAdd={() => {
          showToast("The form from /design/transactions opens here");
        }}
        onImport={() => {
          showToast(
            "Import transactions opens here, as on /design/transactions",
          );
        }}
      />
    </MockShell>
  );
}

const SCREENS: { id: string; label: string; render: () => ReactNode }[] = [
  {
    id: "portfolio",
    label: "1. Portfolio",
    render: () => <Demo entries={BASE} />,
  },
  {
    id: "hidden",
    label: "2. Amounts hidden",
    render: () => <Demo entries={BASE} hidden />,
  },
  {
    id: "other",
    label: "3. Seven coins (Other)",
    render: () => <Demo entries={MORE} />,
  },
  {
    id: "missing-price",
    label: "4. A coin without a price",
    render: () => <Demo entries={MORE} missing={["PENGU"]} />,
  },
  {
    id: "prices-failed",
    label: "5. Prices couldn't load",
    render: () => <Demo entries={BASE} pricesFailed />,
  },
  {
    id: "issues",
    label: "6. Unreadable and oversold",
    render: () => <Demo entries={BASE} damaged={1} oversold />,
  },
  {
    id: "first-day",
    label: "7. First day",
    render: () => <Demo entries={FIRST_DAY} />,
  },
  {
    id: "history-loading",
    label: "8. History still loading",
    render: () => <Demo entries={BASE} historyPending />,
  },
  {
    id: "loading",
    label: "9. Loading",
    render: () => <Static state="loading" />,
  },
  {
    id: "empty",
    label: "10. Nothing yet",
    render: () => <Static state="empty" />,
  },
];

export default function PortfolioMockupsPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [screenId, setScreenId] = useState(params.get("screen") ?? "portfolio");
  const screen = SCREENS.find((entry) => entry.id === screenId) ?? SCREENS[0];
  return (
    <>
      <Fragment key={screenId}>{screen?.render()}</Fragment>
      {!params.has("bare") && (
        <div className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-lg border border-line bg-raised p-2 shadow-raised">
          <label className="sr-only" htmlFor="mockup-screen">
            Screen
          </label>
          <select
            id="mockup-screen"
            value={screen?.id}
            onChange={(event) => {
              setScreenId(event.target.value);
              const url = new URL(window.location.href);
              url.searchParams.set("screen", event.target.value);
              window.history.replaceState(null, "", url);
            }}
            className="h-8 max-w-48 rounded-md border border-line-strong bg-raised px-2 text-sm text-fg"
          >
            {SCREENS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
