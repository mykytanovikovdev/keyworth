# Market data

Prices, coin search and logos: where they come from, what Keyworth keeps, and
what the server learns about a user's portfolio by serving them. The browser
turns prices into values and P&L on its own
([shared/metrics/](../../../shared/metrics/README.md)); the server only fetches
and caches.

## How it works

```
browser ── /api/market/prices ──────────┐
        ── /api/market/prices?ids= ─────┤        market_cache (Postgres)
        ── /api/assets/search?q= ───────┼─ Worker ──────────────────────── CoinGecko
        ── /api/assets/:id/logo ────────┘    └─ Cloudflare cache (logos) ─ coin-images
```

| File                  | Role                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `routes/market.ts`    | The four routes, their limits, the 502 for a failed source              |
| `market/coingecko.ts` | CoinGecko's API: what is asked, how its answers are checked and reduced |
| `market/cache.ts`     | `cached`, `readCached`, `storeCached` over the `market_cache` table     |
| `market/upstream.ts`  | Time and size limits, `MarketError`, `cleanText`, raster images only    |

| Route                         | Source call                             | Fresh for                                   | Kept for |
| ----------------------------- | --------------------------------------- | ------------------------------------------- | -------- |
| `GET /api/market/prices`      | 250 largest coins, one call             | 10 minutes                                  | a day    |
| `GET /api/market/prices?ids=` | the coins not in the snapshot, one call | 10 minutes                                  | a day    |
| `GET /api/assets/search?q=`   | one call per distinct search            | a day                                       | a day    |
| `GET /api/assets/:id/logo`    | the image, from CoinGecko's host        | a day (Cloudflare's cache, per data center) | a day    |

Asset ids are `crypto:` plus CoinGecko's id (`crypto:bitcoin`), so other kinds of
asset can join later without a clash. Prices are in US dollars, as plain-digit
strings: CoinGecko's JSON numbers such as `3.55e-7` become `0.000000355` on the
server, and `precision=full` asks for every digit it has.

## What the server learns

- **The snapshot is the same for everyone.** Loading it says nothing about what a
  user owns, which is why it is a fixed list of the largest coins rather than the
  user's own.
- **A coin outside the snapshot is asked for by id.** At that moment the server
  sees which coins this user asks about. It does not keep that: the cache key is
  the coin, not the user, and nothing about the request is logged.
- **A search is kept for a day under its text**, so the next person typing the
  same thing costs no call. Nothing links it to who typed it.
- **CoinGecko sees only Keyworth's server,** never a user's address: every call,
  logos included, goes through the Worker. Logos also have to, because the page's
  CSP allows images from its own origin only.

## Invariants

1. `market_cache` holds no user id, email or address, and no request is logged
   with what it asked for: a failure logs only the source and the kind of failure.
2. Nothing from CoinGecko is served or kept for more than a day (its API terms);
   the daily cleanup deletes expired rows.
3. Text from a source is cleaned before anything keeps it: no control or
   invisible characters, length limits. Coins it cannot read are left out.
4. A logo comes only from CoinGecko's image host, only as PNG, JPEG, WebP or GIF,
   at most 100 KB. An SVG is a document that can carry script, so it is refused.
5. A source gets at most 8 seconds and 2 MB per answer.
6. The routes need a session, like every other route after `requireSession`.

## Decisions and alternatives

- **CoinGecko's Demo plan.** Free, with a key, 10,000 calls a month, 100 a
  minute, a year of daily history; attribution required ("Powered by CoinGecko"
  next to its data, when prices reach the screens). Its license fits a
  non-commercial beta; it is reviewed again before the public release.
- **Binance, rejected.** It blocks some cloud providers' addresses (HTTP 451),
  and its terms for showing its data are unclear.
- **A cache in Postgres, not per data center.** Cloudflare's cache does not
  replicate between data centers, so each one would spend its own calls; one
  table serves every user everywhere. Every request reaches the database for
  the session anyway. KV was not needed for this.
- **Refresh only while someone uses the app.** No schedule spends calls while
  nobody looks: a stale entry is replaced by the next request.
- **A stale price beats none.** When CoinGecko fails, an entry that has not
  expired is served with its real `fetchedAt`, so the screen can say how old it
  is. After a day there is nothing: 502 `market_unavailable`.
- **No rate limit on logos.** Each limited request writes a counter; a page of
  holdings would write one per logo. Logos come from Cloudflare's cache, the
  image host spends no API calls, and only coins already known have a logo URL.

## Edge cases

| Case                                                    | Result                                                    |
| ------------------------------------------------------- | --------------------------------------------------------- |
| A coin with no price, a negative one, or a malformed id | Left out of the answer                                    |
| A coin CoinGecko does not know                          | Absent from the answer; cached as unknown, so no new call |
| CoinGecko down, unexpired entry                         | Served, with its `fetchedAt`                              |
| CoinGecko down, nothing usable                          | 502 `market_unavailable`, one log line                    |
| Answer over 2 MB, not JSON, unexpected shape, timeout   | Same as down                                              |
| More than 50 ids, an id without `crypto:`               | 400 `invalid_ids`                                         |
| An empty search, or over 50 characters                  | 400 `invalid_query`                                       |
| A logo nobody has seen, or on another host              | 404 `unknown_asset`                                       |

## How it is tested

`tests/integration/market.test.ts` replaces CoinGecko's answers at `fetch`, and
the Worker tests have no real network at all (`outboundService` in
`vitest.config.ts`), so a request that slips past the mock fails loudly instead
of reaching CoinGecko. What it proves:
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

A new route goes after the session check and gets a cache entry with a lifetime
of at most a day for CoinGecko's data. A new source gets its own module next to
`coingecko.ts`, using `upstream.ts` for every call. Never put a request's URL,
ids or search text into an error message or a log line.

Last reviewed: 2026-11-07
