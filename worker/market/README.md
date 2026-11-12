# worker/market/

## Purpose

Market data for the browser: current prices, daily price history, exchange
rates, coin search and logos, fetched from CoinGecko and Frankfurter by the
Worker and cached in Postgres for every user at once. Not here: turning prices
into values and P&L (that happens in the browser,
[shared/metrics/](../../shared/metrics/README.md)) and the routes themselves
(`../routes/market.ts`).

## How it works

| File             | Role                                                                           |
| ---------------- | ------------------------------------------------------------------------------ |
| `coingecko.ts`   | CoinGecko's Demo API: the snapshot, coins by id, search, a year of history     |
| `frankfurter.ts` | Frankfurter: central banks' rates, Coin Metrics' long history for 35 coins     |
| `series.ts`      | Daily series kept whole in the cache: merge, slice, refresh only the last days |
| `cache.ts`       | The shared cache in `market_cache`: fresh, stale and expired entries           |
| `upstream.ts`    | Every call to a source: time and size limits, errors that name no asset        |
| `budget.ts`      | CoinGecko's calls budgeted for all users together, and per user by the hour    |

What the server learns by serving prices, the cache lifetimes and every decision:
[docs/market-data.md](docs/market-data.md).

## Why this way

- **One snapshot for everyone** keeps users' holdings out of most requests.
- **Postgres, not Cloudflare's per-data-center cache,** so one call serves users
  wherever they are and the monthly allowance holds.
- **Sources' answers are data.** They are checked (with zod, or by hand for
  series of thousands of rows), reduced to what is shown and cleaned before
  anything keeps them, because coin names will reach the assistant's context
  later.
- **One source per coin's history**, so a chart has no seam: Coin Metrics for
  the 35 coins it covers, CoinGecko's past year for the rest.

## Pitfalls & gotchas

- Store JSON objects only: a bare `null` reaches Postgres as SQL `NULL`, which
  the column refuses. An unknown coin is `{ quote: null }`.
- Write several cache entries in one statement (`storeCached` takes a list). A
  `Promise.all` of inserts that fails halfway leaves queries running on a closed
  socket in workerd.
- `MarketError` messages name the source and the kind of failure only; never add
  the URL.
- CoinGecko stamps a day's close at the next midnight UTC: its point for 00:00
  on the 5th is the 4th's close (Coin Metrics already dates it the 4th).
- Count days as numbers (`series.ts`), not with `Date.parse` per point: it is
  slow on thousands of points and takes `2026-02-30` for March 2.
- Ask Frankfurter for a coin as `base=<coin>&quotes=USD&providers=CM`: the other
  way round has five significant digits, and without `providers` the rate is a
  blend with exchanges' rates.

## How to work with it

The key is the `COINGECKO_API_KEY` secret (`npx wrangler secret put`; locally
`.dev.vars`, which is needed only to see real prices). Frankfurter needs no key.
Tests replace both sources at `fetch` and never reach them.

## Related

- [worker/routes/](../routes/README.md): the routes and their guards
- [worker/db/docs/data-inventory.md](../db/docs/data-inventory.md): `market_cache`
- [src/crypto/docs/threat-model.md](../../src/crypto/docs/threat-model.md): what
  the operator can see
