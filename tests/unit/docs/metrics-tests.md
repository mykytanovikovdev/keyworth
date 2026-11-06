# Calculation tests

What the unit tests of `shared/metrics`, `shared/money` and the transaction schema
prove, and how to extend them. The rules themselves:
[shared/metrics/docs/calculations.md](../../../shared/metrics/docs/calculations.md).

## Approach

- **Every expected number is worked out by hand** and written in the test, often
  with the arithmetic in a comment. Nothing is derived from the code under test.
- **Fixtures go through the real schema** (`metrics/fixtures.ts`), so no test can
  rely on a transaction the app could not store.
- **Rates and prices are plain test data.** `USD` is a context with no rates at
  all, so a test that needs one by accident fails instead of passing on a default.

## What is proven

**`money/decimal.test.ts`:** 0.1 + 0.2 is 0.3; large amounts with 18 decimal places
keep every digit; no exponent in text or JSON; division rounds half-even at 40
places; strict mode refuses a `number` and `valueOf`.

**`schemas.test.ts`:** each transaction type; refused spellings of an amount
(exponent, comma, sign, leading zero, 19 places, a number), of a time (no zone,
another zone, a date alone), a zero quantity, a purchase at price zero; a price is
needed for what comes in; fields from a newer version survive.

**`metrics/positions.test.ts`:**

- a whole life, row by row, the table in `calculations.md`: fees, a sale, a new
  average, a transfer out, income, closing, buying again;
- precision: tiny quantities with long prices; no dust when a cost does not divide
  evenly;
- transfers in at a stated price and at 0; splits in both directions;
- currencies: each amount at its day's rate, the fee at its own, the move in the
  rate realized, the UTC date whatever the hour; a missing rate hides the amounts
  and names the transaction and currency;
- selling more than is held: the held part and its share of the fee, for sales and
  transfers; nothing held asks for no rate;
- order: by time whatever the input order, a purchase before a sale at the same
  moment, times compared as times.

**`metrics/valuation.test.ts`:** value, unrealized P&L and shares that add up to
one; conversion at the date's rate; a missing price or rate is `null`, not zero, and
the total says it is partial; a closed position needs no price; a known value with
an unknown cost.

**`metrics/history.test.ts`:** days across months and a daylight-saving change;
holdings bought before the range are not money in; transfers at the day's price,
whatever cost they state; income and splits move no money; an oversold sale counts
its held part; a gap keeps the last price; no value before the first price or
without a rate.

**`metrics/risk.test.ts`:** a purchase is not a gain and a sale is not a loss, even
selling everything; a fee lowers the return; a transfer is neutral; selling half on
a rising market is no drawdown; returns compound; the deepest fall, not the last;
volatility against a computed value, with another number of periods; correlation
of 1 and -1, only over common dates, unknown with too few dates or no movement.

## Do these tests catch mistakes?

Checked when they were written: 26 deliberate mistakes in the code (a fee left out,
dividing before multiplying, a purchase counted as a gain, the wrong rounding mode,
and so on), run one at a time, each failed at least one test. Worth repeating by hand
after a large change to the rules.

## Not here

- Real prices and rates: tested where they arrive, later in phase 4.
- Screens and formatting: they come with the portfolio page.
- Whether a form refuses an oversold sale: that is the transaction service, later
  in phase 4. Here, only what the calculations do when one is already stored.

## Adding a case

Work the number out by hand first, then write it in, with the arithmetic in a comment:

```ts
it("realizes the move in the rate too", () => {
  const { realized } = summary(
    entries(
      buy("2025-01-01", "1", "100", { priceCurrency: "EUR" }),
      sell("2025-02-01", "1", "100", { priceCurrency: "EUR" }),
    ),
    usdWithRates({ "EUR 2025-01-01": "1.1", "EUR 2025-02-01": "1.2" }),
  );
  // The same 100 EUR in and out, but 110 USD paid and 120 USD received.
  expect(realized).toBe("10");
});
```

Last reviewed: 2026-11-06
