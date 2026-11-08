# Calculations

How Keyworth turns transactions into positions, profit and risk figures. These
are the numbers users see and the ones the assistant explains, so the model never
computes them: it receives them from these functions.

Everything here is a pure function of its inputs: no network, no storage, no
clock. Transactions are the source of truth and nothing derived is stored. Prices
and exchange rates come in as parameters.

## How it works

| File           | Role                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| `ledger.ts`    | What every calculation shares: the order of transactions, their effect on a holding |
| `positions.ts` | `computePositions`: quantity, cost, average cost, realized P&L, income, and issues  |
| `valuation.ts` | `valuePositions`: value, unrealized P&L and share of the portfolio today            |
| `history.ts`   | `portfolioHistory`: value per day, and the money moved that day                     |
| `risk.ts`      | Returns, period change, maximum drawdown, volatility, correlation (`number`s)       |

Transactions are applied in time order. At the same moment, what adds units
(buy, transfer in, income) comes before a split, and a split before what takes
units away, so a same-day purchase and sale cannot look oversold.

## Rules for a position

Average cost method. `average = cost / quantity`.

| Transaction    | Quantity   | Cost                      | Realized P&L                    | Income  |
| -------------- | ---------- | ------------------------- | ------------------------------- | ------- |
| `buy`          | + quantity | + quantity × price + fee  |                                 |         |
| `sell`         | − quantity | − its share of the cost   | + quantity × price − fee − cost |         |
| `transfer_in`  | + quantity | + quantity × stated price |                                 |         |
| `transfer_out` | − quantity | − its share of the cost   |                                 |         |
| `income`       | + quantity | + quantity × price        |                                 | + worth |
| `split`        | × ratio    | unchanged                 |                                 |         |

Selling or transferring out leaves the average unchanged. Selling everything
leaves a cost of exactly zero, and buying again starts a new average while what
was realized stays.

### A worked example

Prices and fees in the base currency.

| Transaction              | Quantity | Cost     | Average     | Realized | Income |
| ------------------------ | -------- | -------- | ----------- | -------- | ------ |
| Buy 2 at 30,000, fee 20  | 2        | 60,020   | 30,010      | 0        | 0      |
| Sell 1 at 40,000, fee 10 | 1        | 30,010   | 30,010      | 9,980    | 0      |
| Buy 1 at 50,000          | 2        | 80,010   | 40,005      | 9,980    | 0      |
| Transfer out 0.5         | 1.5      | 60,007.5 | 40,005      | 9,980    | 0      |
| Income 0.1 at 60,000     | 1.6      | 66,007.5 | 41,254.6875 | 9,980    | 6,000  |
| Sell 1.6 at 70,000       | 0        | 0        | none        | 55,972.5 | 6,000  |
| Buy 1 at 10,000          | 1        | 10,000   | 10,000      | 55,972.5 | 6,000  |

`tests/unit/metrics/positions.test.ts` checks this table row by row.

Unrealized P&L is today's value less the cost. Total gain is realized plus
unrealized plus income; income counts as cost when received, so it is not counted
twice.

## Currencies

Everything is in the user's base currency. A transaction converts at the rate of
its own UTC date, today's value at today's rate, so P&L includes the move in the
exchange rate: 100 EUR bought at 1.1 and sold at 1.2 realizes 10 USD on no change
in euros. A fee has its own currency, the price currency when it names none.
Changing the base currency needs no migration, since nothing derived is stored.

## Portfolio history and risk

`portfolioHistory` values the holdings on every UTC date in a range. A gap in an
asset's prices (a weekend, a holiday) keeps the last price before it. A day before
the asset's first known price has no value.

A portfolio's value is not its performance: buying doubles it and selling halves
it without anyone gaining or losing anything. So each day also carries the money
moved, and risk figures use **time-weighted returns**:

```
return = (value + outflow − movedIn) / (yesterday's value + inflow) − 1
```

| Field     | What                                                    | Why there                                        |
| --------- | ------------------------------------------------------- | ------------------------------------------------ |
| `inflow`  | Paid for purchases, with fees                           | Earns from the start of its day; a fee is a loss |
| `outflow` | Proceeds of sales less fees; transfers out at the close | It earned until it left                          |
| `movedIn` | Transfers in at the close, whatever cost they state     | It has earned nothing yet                        |

Income is not money moved: it is what the portfolio earned. Without this, a
purchase would show as a gain, and selling half as a 50% drawdown.

| Figure      | Function                     | Definition                                              |
| ----------- | ---------------------------- | ------------------------------------------------------- |
| Change      | `periodReturn`               | The returns compounded                                  |
| Drawdown    | `maxDrawdown(growthIndex())` | Deepest fall from a peak, as a negative ratio           |
| Volatility  | `volatility`                 | Sample standard deviation × √365 (stocks will pass 252) |
| Correlation | `correlation`                | Pearson, on returns over the dates both assets have     |

Correlation needs at least three common returns and movement in both assets.

## Invariants

1. Money and quantities are never a `number`. Statistics on returns are, because
   they are ratios, and `toNumber` is the only way across.
2. A missing rate or price never counts as zero. A position with a missing rate
   has `amounts: null`, so a partial cost cannot be shown as a real one; a value
   that cannot be priced is `null`, and the total says it is partial.
3. A closed position has a cost of exactly zero.
4. Quantity never goes below zero: a reduction moves only what was held.
5. The same transactions in any order give the same result.
6. Which day a transaction belongs to depends on its UTC time alone, not on where
   the code runs.

## Decisions and alternatives

- **Average cost, not FIFO.** It needs one running figure and gives the same
  answer whichever order lots are matched in. FIFO is in the backlog.
- **A transfer in must state a price.** Keyworth has no wallets, so moves between
  a user's own wallets are not recorded at all. A transfer in is units whose
  purchase is not recorded; a cost of zero would make their whole value look like
  profit. A price of 0 is allowed on purpose, for airdrops.
- **Income at its worth when received.** The worth becomes cost and is shown apart
  from P&L. With a cost of zero, the same money would count as income and again as
  gain.
- **No fee on transfers.** The quantity includes it. The fee's units leave at their
  average cost without touching P&L: a small inaccuracy, for a simpler form.
- **Issues, not exceptions.** Selling more than is held can happen after a CSV
  import or deleting an old purchase. One bad record must not hide the whole
  portfolio, so it comes back in `issues`, naming the transaction, and only the
  part that was held counts, with its share of the fee.
- **Time-weighted, not money-weighted, returns.** They measure the investments
  rather than the timing of deposits, and need no solver.
- **Rejected:** storing positions (they would drift from the transactions); doing
  any of this on the server (it has only ciphertext); letting the model compute
  (rule: the model explains numbers, it does not produce them).

## Edge cases

| Case                                    | Result                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A rate is missing                       | `amounts: null`, quantity still right, a `missing-rate` issue                                                                                                                                                 |
| Sold more than held                     | The held part counts; an `oversold` issue with what is missing; a new change that causes it is refused by the transaction service ([src/features/transactions](../../../src/features/transactions/README.md)) |
| Sold with nothing held                  | No effect, no rate asked for; an `oversold` issue                                                                                                                                                             |
| A price is missing today                | `value: null`, `total` leaves it out, `complete: false`                                                                                                                                                       |
| A closed position                       | Value 0, needs no price                                                                                                                                                                                       |
| A day cannot be priced                  | No return for it or the day after                                                                                                                                                                             |
| No holdings and nothing bought that day | No return                                                                                                                                                                                                     |
| A cost that does not divide evenly      | Multiply first, divide last; closing takes the exact rest                                                                                                                                                     |

Cash dividends, which pay money without changing the quantity, arrive with stocks
(phase 11).

## How it is tested

`tests/unit/metrics/` and `tests/unit/money/`, with every expected number worked
out by hand. What each file proves:
[tests/unit/docs/metrics-tests.md](../../../tests/unit/docs/metrics-tests.md).

## How to change it safely

Change a rule here and in its test first, with the new number worked out by hand.
A new transaction type needs a row in the rules table and a decision about whether
it moves money for `portfolioHistory`. Never compute money through `number`, and
never let a missing input become zero.

Last reviewed: 2026-11-08
