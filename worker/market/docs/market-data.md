# Market data

Prices, price history, exchange rates, coin search and logos: where they come
from, what Keyworth keeps, and what the server learns about a user's portfolio
by serving them. The browser turns prices into values and P&L on its own
([shared/metrics/](../../../shared/metrics/README.md)); the server only fetches
and caches.

## How it works

```
browser ── /api/market/prices ──────────┐
        ── /api/market/prices?ids= ─────┤                                ┌─ CoinGecko
        ── /api/market/history ─────────┼─ Worker ── market_cache ───────┤
        ── /api/market/rates ───────────┤    │        (Postgres)         └─ Frankfurter
        ── /api/assets/search?q= ───────┤    │                              (central banks,
        ── /api/assets/:id/logo ────────┘    └─ Cloudflare cache (logos)     Coin Metrics)
```

| File                    | Role                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `routes/market.ts`      | The six routes, their limits, the 502 for a failed source                     |
| `market/coingecko.ts`   | CoinGecko's API: what is asked, how its answers are checked and reduced       |
| `market/frankfurter.ts` | Frankfurter's API: exchange rates, Coin Metrics' prices, the coin-to-code map |
| `market/series.ts`      | Daily series kept whole: merge, slice, refresh only the last days             |
| `market/cache.ts`       | `cached`, `readCached`, `storeCached` over the `market_cache` table           |
| `market/upstream.ts`    | Time and size limits, `MarketError`, plain digits, `cleanText`, raster only   |

| Route                                  | Source call                                                         | Fresh for                                   | Kept for                   |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- | -------------------------- |
| `GET /api/market/prices`               | CoinGecko: 250 largest coins, one call                              | 10 minutes                                  | a day                      |
| `GET /api/market/prices?ids=`          | CoinGecko: the coins not in the snapshot, one call                  | 10 minutes                                  | a day                      |
| `GET /api/market/history?asset=&from=` | Frankfurter (Coin Metrics) for 35 coins, else CoinGecko's past year | 6 hours; CoinGecko's 12 hours               | 90 days; CoinGecko's a day |
| `GET /api/market/rates?quotes=&from=`  | Frankfurter: one call per currency                                  | 6 hours                                     | 90 days                    |
| `GET /api/assets/search?q=`            | CoinGecko: one call per distinct search                             | a day                                       | a day                      |
| `GET /api/assets/:id/logo`             | CoinGecko's image host                                              | a day (Cloudflare's cache, per data center) | a day                      |

Asset ids are `crypto:` plus CoinGecko's id (`crypto:bitcoin`), so other kinds of
asset can join later without a clash. Prices are in US dollars, as plain-digit
strings: JSON numbers such as `3.55e-7` become `0.000000355` on the server, and
CoinGecko's `precision=full` asks for every digit it has.

### History and rates

A series is one value per UTC day, sent as `{ from, values }`: `values[i]` is
for `from` plus i days, `null` where the source has nothing. Half the size of
dated points, and nothing to parse per point. The request's `from` (a day, the
user's first trade) cuts the series; the server keeps it whole.

- **A coin's price** is its closing price: the value at 00:00 UTC that ends the
  day. Coin Metrics dates a close by the day it ends; CoinGecko stamps it at
  the next midnight, so its point for 00:00 on the 5th is the 4th's close, and
  its last point, the current price, is no close at all and is left out. The
  latest day is yesterday; today's value comes from `/prices`.
- **One source per coin.** The 35 coins Coin Metrics covers (Bitcoin since
  2010-07-18, Ethereum since 2015, USDT, USDC, and others) take its whole
  history; every other coin takes CoinGecko's past year, which is all the Demo
  plan gives. A chart never joins two sources that disagree at the seam.
  Which CoinGecko id is which Coin Metrics code is a written table
  (`COIN_METRICS_CODES`): a symbol can name different coins.
- **A rate is units of the currency per US dollar.** The 161 currencies in use
  that central banks publish (`shared/schemas/currencies.ts`), blended by
  Frankfurter across the banks that publish each, five significant digits.
  USDT and USDC, which a trade's price can be in, take Coin Metrics' rate, so a
  stablecoin that slips off the dollar is valued as it was.
- **Kept whole, extended at the end.** A series starts at its source's first
  day (never before 2010-07-18) and is stored as one cache entry. A stale one
  asks the source only from a week before its last day: late publications and
  revised blends replace what was there, and the rest stays.

## What the server learns

- **The snapshot is the same for everyone.** Loading it says nothing about what a
  user owns, which is why it is a fixed list of the largest coins rather than the
  user's own.
- **A coin outside the snapshot, a coin's history and a currency's rates are
  asked for by name.** At that moment the server sees which coins and
  currencies this user asks about. It does not keep that: the cache key is the
  coin or the currency, not the user, and nothing about the request is logged.
- **A search is kept for a day under its text**, so the next person typing the
  same thing costs no call. Nothing links it to who typed it.
- **The sources see only Keyworth's server,** never a user's address: every call,
  logos included, goes through the Worker. Logos also have to, because the page's
  CSP allows images from its own origin only.

## Invariants

1. `market_cache` holds no user id, email or address, and no request is logged
   with what it asked for: a failure logs only the source and the kind of failure.
2. Nothing from CoinGecko is served or kept for more than a day (its API terms);
   the daily cleanup deletes expired rows. Frankfurter's data, free of such
   terms, is kept for 90 days from its last refresh.
3. Text from a source is cleaned before anything keeps it: no control or
   invisible characters, length limits. Coins it cannot read are left out.
4. A logo comes only from CoinGecko's image host, only as PNG, JPEG, WebP or GIF,
   at most 100 KB. An SVG is a document that can carry script, so it is refused.
5. A source gets at most 8 seconds per answer, and 2 MB (CoinGecko) or 1 MB
   (Frankfurter, whose longest series is about 400 KB).
6. A series holds only real days from 2010-07-18 to tomorrow: a source's date in
   the year 9999 is dropped, not turned into millions of empty days.
7. The routes need a session, like every other route after `requireSession`.

## Decisions and alternatives

- **CoinGecko's Demo plan.** Free, with a key, 10,000 calls a month, 100 a
  minute, a year of daily history; attribution required ("Powered by CoinGecko"
  next to its data, when prices reach the screens). Its license fits a
  non-commercial beta; it is reviewed again before the public release.
- **Frankfurter, no key, for rates and long history.** Central banks' rates for
  161 currencies, and Coin Metrics' daily reference rates for 35 coins under
  CC BY-NC 4.0 (non-commercial, with credit: "Coin Metrics" next to the chart).
  Asked for a coin as `base=BTC&quotes=USD&providers=CM`: the other way round
  has five significant digits, and without `providers` the coin's rate is a
  blend with exchanges' that differed from Coin Metrics' by 2%.
- **Binance, rejected.** It blocks some cloud providers' addresses (HTTP 451),
  and its terms for showing its data are unclear.
- **A cache in Postgres, not per data center.** Cloudflare's cache does not
  replicate between data centers, so each one would spend its own calls; one
  table serves every user everywhere. Every request reaches the database for
  the session anyway. KV was not needed for this.
- **Refresh only while someone uses the app.** No schedule spends calls while
  nobody looks: a stale entry is replaced by the next request.
- **A stale price beats none.** When a source fails, an entry that has not
  expired is served (prices with their real `fetchedAt`, so the screen can say
  how old they are). With nothing usable: 502 `market_unavailable`.
- **Series checked by hand, not with zod.** A series since 2010 is about 6,000
  rows; zod's jitless parsing costs too much CPU per row for a Worker on the
  free plan (10 ms a request). Parsing and merging a whole series takes about
  3 ms the first time, once for everyone; a refresh takes under 1 ms. Days are
  counted as numbers, because `Date.parse` is slow per point and takes
  `2026-02-30` for March 2.
- **The whole series from its start, not from the first request's day.** One
  entry per coin or currency, extended only at its end, is simpler than filling
  gaps at both ends; the cost is one larger first load.
- **No rate limit on logos.** Each limited request writes a counter; a page of
  holdings would write one per logo. Logos come from Cloudflare's cache, the
  image host spends no API calls, and only coins already known have a logo URL.

## Edge cases

| Case                                                                           | Result                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| A coin with no price, a negative one, or a malformed id                        | Left out of the answer                                         |
| A coin CoinGecko does not know                                                 | No price, no history; cached as unknown, so no new call        |
| A row of a series that does not fit (wrong pair, not a number, not a real day) | Left out; the day stays `null`                                 |
| A gap in a series (a holiday, a missed publication)                            | `null` for that day; the browser uses the last value before it |
| `from` before a series starts                                                  | The whole series, with its own `from`                          |
| A source down, unexpired entry                                                 | Served as it is                                                |
| A source down, nothing usable                                                  | 502 `market_unavailable`, one log line                         |
| Answer too large, not JSON, unexpected shape, timeout                          | Same as down                                                   |
| More than 50 ids, an id without `crypto:`                                      | 400 `invalid_ids`                                              |
| A history asset that is not a `crypto:` id                                     | 400 `invalid_asset`                                            |
| `from` missing, not a real day, or with a time                                 | 400 `invalid_from`                                             |
| A rate for USD, a code not in the list, more than 10                           | 400 `invalid_quotes`                                           |
| An empty search, or over 50 characters                                         | 400 `invalid_query`                                            |
| A logo nobody has seen, or on another host                                     | 404 `unknown_asset`                                            |

## How it is tested

`tests/integration/market.test.ts` replaces the sources' answers at `fetch`, and
the Worker tests have no real network at all (`outboundService` in
`vitest.config.ts`), so a request that slips past the mock fails loudly instead
of reaching a source. It covers which source each coin uses and how it is asked,
the day a close belongs to, the rows a series drops, a refresh that asks for the
last week only, stale entries while a source fails, each 400, and how long each
source's data is kept. What it proves about storage:
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

A new route goes after the session check and gets a cache entry with a lifetime
of at most a day for CoinGecko's data. A new source gets its own module next to
`coingecko.ts`, using `upstream.ts` for every call. Never put a request's URL,
ids, currencies or search text into an error message or a log line. A new
entry in `COIN_METRICS_CODES` is checked first by comparing the two sources'
prices for the coin.

Last reviewed: 2026-11-07
