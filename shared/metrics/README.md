# shared/metrics/

## Purpose

Every number derived from a user's transactions: positions, average cost, P&L,
shares, value over time, drawdown, volatility, correlation. Pure functions, run in
the browser on decrypted data, so the server never sees these figures and the
model only explains them.

Not here: fetching prices and rates (`worker/market`), reading records
(`src/vault`), formatting, screens. The portfolio page's own totals (all-time
profit, income, the share of each coin) are added up from these figures by
`summarize()` in `src/features/portfolio/summary.ts`: pure and tested
(`tests/unit/portfolio/summary.test.ts`), it decides what the page shows, such
as leaving out a coin with no price, which is a screen's choice rather than a
calculation of this folder.

## How it works

| File           | Role                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| `ledger.ts`    | Order of transactions, their effect on a holding, conversion to the base currency |
| `positions.ts` | Positions by the average cost method, and data issues                             |
| `valuation.ts` | Value, unrealized P&L and shares today                                            |
| `history.ts`   | Value per day, the money moved that day, and the money made over a period         |
| `risk.ts`      | Time-weighted returns, change, drawdown, volatility, correlation                  |

```
transactions ─ computePositions ─ valuePositions ─ screens, assistant
     │              ▲                   ▲
     │         rates (parameter)   prices (parameter)
     └── portfolioHistory ─ timeWeightedReturns ─ drawdown, volatility
                       └── periodGain (money made)
```

The rules, a worked example and every decision:
[docs/calculations.md](docs/calculations.md).

## Why this way

- **Transactions are the source of truth.** Positions are computed, never stored,
  so they cannot drift, and changing the base currency needs no migration.
- **Prices and rates are parameters.** The functions can be tested against numbers
  worked out by hand, with no network.
- **`null` instead of zero.** A missing rate or price makes the figure unknown,
  and the types force the screens to handle that.

## Pitfalls & gotchas

- A portfolio's value is not its performance. Use `timeWeightedReturns` for risk
  figures, never the change in value: a purchase is not a gain.
- Dates are UTC (`YYYY-MM-DD`), taken from `executedAt`.
- `risk.ts` returns `number`s on purpose: they are ratios. Everything in money or
  units is a `Decimal`.
- Price series must be ascending by date.

## How to work with it

```ts
const { positions, issues } = computePositions(transactions, {
  baseCurrency: "USD",
  rate: (from, to, date) => rateFromYourSource(from, to, date),
});
const { rows, total, complete } = valuePositions(positions, {
  money,
  quote: (assetId) => latestPrice(assetId),
  date: "2026-11-06",
});
```

Tests: [tests/unit/docs/metrics-tests.md](../../tests/unit/docs/metrics-tests.md).

## Related

- [shared/money/](../money/README.md): the decimal type
- [shared/schemas/](../schemas/README.md): the transaction record
