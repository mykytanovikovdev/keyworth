# src/features/portfolio/

## Purpose

The portfolio page, the app's start page (`/`): what the user holds, what it is
worth today in their base currency, how it did over a period, how it is split
between coins, and the profit on each. It reads the decrypted transactions and
market data and shows figures; it computes no money itself (that is
`shared/metrics`) and changes no transaction (that is the shared editor in
`../transactions/editor.tsx`).

## How it works

| File                   | Role                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `PortfolioPage.tsx`    | The route: transactions, today's quotes, histories and rates in, the view out           |
| `market-data.ts`       | Queries for histories and rates; the server's answers as `PriceSeries` and `RateLookup` |
| `summary.ts`           | `summarize()`: every figure on the page from `shared/metrics`, for one period           |
| `PortfolioView.tsx`    | The page itself, from a summary: value, period, chart, four figures, allocation, table  |
| `PortfolioNotices.tsx` | What the figures leave out, said once above them                                        |
| `format.ts`            | Money with cents and a sign, percentages, axis dates, the period in words               |
| `preferences.ts`       | The period and "hide amounts", kept on this device                                      |

```
transactions (vault) ─┐
snapshot + quotes ────┼─ summarize() ─ PortfolioView
histories ────────────┤   (shared/metrics: positions, valuation,
rates ────────────────┘    history, periodGain, returns, risk)
```

**Market data.** Today's prices come from the shared snapshot of the 250
largest coins, and from `/api/market/prices?ids=` for the others. Each coin's
history is asked from the day it was first held; the server's latest close is
yesterday's, so today's price is added as the last point. Rates are asked for
the base currency and every price or fee currency used, from a week before the
first transaction (a weekend's purchase needs Friday's rate). The server gives
each currency per US dollar; `rateLookup` converts between any two through the
dollar, and keeps the last rate over a weekend. Everything asked by name is
cached under `["vault", …]`, cleared when the vault locks.

**The figures** (owner's decisions, 2026-11-09):

| On screen       | From                                                                         |
| --------------- | ---------------------------------------------------------------------------- |
| Total value     | `valuePositions` today                                                       |
| Period's change | `periodGain` in money, `periodReturn` (time-weighted) in percent             |
| Chart           | `portfolioHistory`, one point per day of the period                          |
| All-time profit | Realized plus unrealized, every position; income is apart                    |
| Income          | Staking and rewards, worth when received                                     |
| Max drawdown    | `maxDrawdown(growthIndex(returns))` over the period                          |
| Volatility      | `volatility(returns)`, annualized, over the period                           |
| Allocation      | Shares of the known total: five data colors and a grey "Other"               |
| Holdings        | Quantity, average cost, price, value, share, unrealized profit; wide screens |

Periods are 1W, 1M, 3M, 1Y and All; there is no 1D, because histories are
daily. A purchase raises the chart but is not a gain: the period's change
leaves money put in and taken out aside, as `shared/metrics/docs/calculations.md`
explains. Every screen and state is on `/design/portfolio` (dev and design
builds), from made-up transactions through the real `summarize()`.

## Why this way

- **A coin without a price is listed, and its unknown value is left out** of
  the total, the chart and the figures, with a notice; what it already realized
  still counts. `shared/metrics` makes a value unknown when a price is missing,
  so a partial sum is never shown as a real one; applied to the whole page, one
  rare coin without a quote would blank the total, the chart and every figure.
  The page instead says plainly what it leaves out.
- **No price at all shows a dash, not zero.** A portfolio worth "$0.00" is a
  wrong answer; "—" with "Prices couldn't load" is an honest one.
- **The period starts on the first day every held coin has a price.** CoinGecko
  keeps a year of history for coins outside Coin Metrics' 35; rather than
  blank "All" for an older purchase, the period starts later and says since
  when.
- **Histories may arrive after today's prices.** The total, the table and the
  allocation show as soon as prices are in; the chart and the period's figures
  wait for every history (`history: null` in `summarize`), so none of them is
  computed from part of the coins.
- **Colors follow the coin, in the order it was first bought**, not its size:
  a change in value never repaints the bar. Beyond five coins, the rest share
  the neutral "Other", never a generated sixth color.
- **Hidden amounts hide money and quantities** (quantity times price is the
  value), not percentages or market prices. The choice is kept on the device
  and survives a reload: hiding is for screens others can see.
- **One editor for transactions.** "Add transaction" opens the form of the
  transactions page through `useTransactionEditor`, so both pages refuse,
  save and undo in the same way; with nothing yet, "Import from a file" opens
  the same import (`useImportExport`). The notices link to the transactions
  page where they ask the user to look.

## Pitfalls & gotchas

- **A query with nothing to ask stays pending** in TanStack Query 5 (the
  quotes for coins outside the snapshot, the rates for a dollar-only
  portfolio). Loading checks use `isLoading`, not `isPending`.
- **`useQueries` returns a new array every render.** Its `combine` makes one
  stable value; without it, `summarize` would run on every render.
- **Today is a UTC date** here, as in `shared/metrics`; the transaction form
  uses the device's date. Near midnight they can differ by a day.
- **History before a coin's series** (an old purchase of a coin with a year of
  CoinGecko data) moves the period's start; its words say "since <date>".
- **The mobile header** puts the sections on a second row; a compact layout is
  planned with the chat's side menu.

## How to work with it

- Look at it: `npm run dev` → `/design/portfolio`, ten screens (`?screen=`).
- A new figure: compute it in `shared/metrics` with a hand-worked test, add it
  to `PortfolioSummary` in `summary.ts` with a test in
  `tests/unit/portfolio/summary.test.ts`, then show it in `PortfolioView`.
- Tests: `tests/unit/portfolio/` (summary, adapters, formats) and
  `tests/e2e/portfolio.spec.ts` ([docs](../../../tests/e2e/docs/portfolio-flows.md)).

## Related

- [shared/metrics](../../../shared/metrics/README.md): every calculation
- [features/transactions](../transactions/README.md): the editor and the list
- [worker/market](../../../worker/market/README.md): where prices, histories and rates come from
- [src/ui](../../ui/README.md): `ValueChart`, `AllocationBar`
