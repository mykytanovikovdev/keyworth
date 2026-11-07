# worker/market/

## Purpose

Market data for the browser: current prices, coin search and logos, fetched from
CoinGecko by the Worker and cached in Postgres for every user at once. Not here:
turning prices into values and P&L (that happens in the browser,
[shared/metrics/](../../shared/metrics/README.md)), the routes themselves
(`../routes/market.ts`), exchange rates and price history (later in phase 4).

## How it works

| File           | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `coingecko.ts` | CoinGecko's Demo API: the snapshot, coins by id, search                 |
| `cache.ts`     | The shared cache in `market_cache`: fresh, stale and expired entries    |
| `upstream.ts`  | Every call to a source: time and size limits, errors that name no asset |

What the server learns by serving prices, the cache lifetimes and every decision:
[docs/market-data.md](docs/market-data.md).

## Why this way

- **One snapshot for everyone** keeps users' holdings out of most requests.
- **Postgres, not Cloudflare's per-data-center cache,** so one call serves users
  wherever they are and the monthly allowance holds.
- **Sources' answers are data.** They are checked with zod, reduced to what is
  shown and cleaned before anything keeps them, because coin names will reach the
  assistant's context later.

## Pitfalls & gotchas

- Store JSON objects only: a bare `null` reaches Postgres as SQL `NULL`, which
  the column refuses. An unknown coin is `{ quote: null }`.
- Write several cache entries in one statement (`storeCached` takes a list). A
  `Promise.all` of inserts that fails halfway leaves queries running on a closed
  socket in workerd.
- `MarketError` messages name the source and the kind of failure only; never add
  the URL.

## How to work with it

The key is the `COINGECKO_API_KEY` secret (`npx wrangler secret put`; locally
`.dev.vars`, which is needed only to see real prices). Tests replace CoinGecko at
`fetch` and never reach it.

## Related

- [worker/routes/](../routes/README.md): the routes and their guards
- [worker/db/docs/data-inventory.md](../db/docs/data-inventory.md): `market_cache`
- [src/crypto/docs/threat-model.md](../../src/crypto/docs/threat-model.md): what
  the operator can see
