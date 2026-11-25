# API guards

Everything that stands between a request and the database on the app's own
routes (`/api/keys`, `/api/vault`, and every route added later). Code:
`../index.ts` (`requireSession`), `../limits.ts`, `keys.ts`, `vault.ts`;
schemas in `shared/schemas/`.

## The order of checks

```
request ─► security headers (every response)
        ─► /api/health                      public, no database
        ─► /api/auth/*                      Better Auth (its own origin check and limits)
        ─► requireSession                   no valid session row → 401
        ─► requireSameOrigin                write without the app's Origin → 403
        ─► per route: rateLimit → requireFreshSession → maxBody → schema → SQL with limits
```

## Guards

| Guard               | Where                                                                                                                                    | Rule                                                                                                                                   | Answer                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Session             | every route                                                                                                                              | A session row from the cookie; the user id comes only from it                                                                          | 401 `unauthorized`                                               |
| Same origin         | every POST, PUT, DELETE                                                                                                                  | `Origin` must equal the origin of `BETTER_AUTH_URL`                                                                                    | 403 `forbidden_origin`                                           |
| Rate limit (keys)   | writes to `/api/keys`                                                                                                                    | 20 per user per minute                                                                                                                 | 429 `rate_limited` + `Retry-After`                               |
| Rate limit (vault)  | writes to `/api/vault`; `POST /api/vault/batch` and `/delete` apart                                                                      | 120 per user per minute; 60 batches and 30 bulk deletes per user per minute                                                            | 429 `rate_limited` + `Retry-After`                               |
| Rate limit (market) | `GET /api/market/prices`, `/history` (`POST /histories` counts with it); `/rates`; `GET /api/assets/search`                              | 120 each; 60; 60 per user per minute (they can spend calls to the sources)                                                             |
| Source budget       | market reads that call CoinGecko                                                                                                         | 30 calls a minute and 320 a day for all users together; 60 an hour per user for coins and searches by name                             | What the cache still has, or 502 `market_unavailable`            |
| Rate limit (chat)   | `POST /api/chat/completions`                                                                                                             | 20 per user per minute (each round of tools is a request)                                                                              | 429 `rate_limited` + `Retry-After`                               |
| Model budget        | `POST /api/chat/completions`                                                                                                             | 9,000 neurons a UTC day for all users together, checked before the model is asked ([chat-transit.md](../../chat/docs/chat-transit.md)) | 429 `budget` + `resetsAt`                                        |
| Fresh session       | `PUT /api/keys/passphrase`, `PUT /api/keys/recovery`                                                                                     | Session created in the last 10 minutes (`GET /api/me` says how long is left)                                                           | 403 `session_not_fresh`                                          |
| Body size           | `/api/keys` writes; `PUT /api/vault/:id`; `POST /api/vault/batch`; `/delete`; `POST /api/chat/completions`; `POST /api/market/histories` | 4 KB; 96 KB; 128 KB; 48 KB; 128 KB; 4 KB                                                                                               | 413 `body_too_large`                                             |
| Schema              | every body and id                                                                                                                        | Exact shapes from `shared/schemas` (lengths, buckets, Argon2 limits, no extra fields)                                                  | 400 `invalid_body` / `invalid_id` / `invalid_kind`               |
| Free text           | `GET /api/assets/search?q=`                                                                                                              | At most 50 characters, no hidden characters ([input-validation.md](../../../shared/schemas/docs/input-validation.md))                  | 400 `invalid_query`                                              |
| Revision            | `PUT /api/vault/:id`                                                                                                                     | `0` creates; otherwise must equal the stored revision (at most 2³¹−2); kind cannot change                                              | 409 `conflict` + current `revision`, 409 `kind_mismatch`, or 404 |
| Quotas              | `PUT /api/vault/:id`; `POST /api/vault/batch`                                                                                            | At most 20,000 records and 50 MiB of ciphertext per user, checked under the per-user lock before writing                               | 413 `quota_exceeded`                                             |
| Lock wait           | `PUT /api/vault/:id`; `POST /api/vault/batch`                                                                                            | The user's write lock within 2 s, each statement within 5 s                                                                            | 429 `busy` + `Retry-After: 2`                                    |
| Batch               | `POST /api/vault/batch`                                                                                                                  | 1–100 new `transaction`, `conversation` or `message` records, each id once; all written or none: a taken id rolls the batch back       | 400 `invalid_body`; 409 `conflict`                               |
| Bulk delete         | `POST /api/vault/delete`                                                                                                                 | 1–1,000 ids, each once, of `transactions` (the default) or `chats`; or every chat (`all`); never settings; ids gone are no error       | 400 `invalid_body`; 200 `{ deleted }`                            |
| Pages               | `GET /api/vault`                                                                                                                         | At most 1,000 records or 1 MiB of ciphertext (plus the record crossing it) per answer                                                  | `next` cursor; 400 `invalid_cursor`                              |
| One-time setup      | `POST /api/keys`                                                                                                                         | The check value and both slots once, in one transaction: all three or none                                                             | 409 `already_set_up`                                             |
| Expected slot       | `PUT /api/keys/passphrase`, `PUT /api/keys/recovery`                                                                                     | `expectedIv` must equal the stored slot's IV                                                                                           | 409 `conflict` + stored `iv`, or 404                             |
| Device unlock       | `GET /api/keys/device`                                                                                                                   | Same session **and** the device cookie's token hash, remembered less than 14 days ago                                                  | `{ slot: null }` (200: "not remembered" is no error)             |

**CoinGecko's budget** (`worker/market/budget.ts`) is spent before every call
to its API: one row per source in `upstream_calls` counts this minute's and
this day's calls for all users together, and a call for one user (a coin or a
search by name) also counts against that user's hour in `api_rate_limits`.
The per-route limits alone are per user: one account asking for new coins
could spend the month's 10,000 calls in an hour and leave everyone without
prices. Past the budget, a route answers like a failing source.

**Rate limiting** keeps one row per user and bucket in `api_rate_limits`
(window start and count), updated by a single upsert that resets the count when
the window has passed and returns the seconds left in it (`Retry-After`). It
runs on every write, including Lock (`DELETE /api/keys/device`), and on the
market reads that can reach a source (prices, history and histories, rates,
search); logos are left out on purpose
([market-data.md](../../market/docs/market-data.md)). A row untouched
for an hour goes with the daily cleanup
([data-inventory.md](../../db/docs/data-inventory.md)).

**Quotas and revisions** live in the same SQL statement as the write (the
`WHERE` clause of the insert or update). Revisions hold under concurrency by
themselves (the row lock); quotas need more, because at Postgres's default
isolation two inserts running at once do not see each other's rows and could
both pass the count. So each vault write runs in a transaction that first takes
a per-user advisory lock (`pg_advisory_xact_lock`): one write per user at a time
counts and writes; other users are never blocked. When nothing was written, one
more query tells which rule refused it. The lock is waited for at most 2
seconds and each statement of the transaction runs at most 5 (set in the
lock's own statement, so no extra round trip): a burst of one session's writes
would otherwise queue while holding connections that every user shares; past
the wait, the write is refused as `busy` and the client tries again.

**Batches** (`POST /api/vault/batch`, for a CSV import or a new chat, whose title
and messages are two records) take the same lock, then
count the user's records and bytes and insert them all in one statement; an id
already taken makes the transaction roll back, so a batch is never half
written. Validation costs CPU by the byte, so a batch is held to 128 KB (and
100 records): about 3.5 ms of checking at worst, well inside a Worker's 10 ms.

**Pages** (`GET /api/vault`) are sized for the same 10 ms. Postgres encodes the
bytes as base64url in its own (C) code, so the Worker only passes strings on;
encoding them in JavaScript a byte at a time, plus the JSON, took about 10 ms
for 2,000 small records and 24 ms for 5,000 (measured in Node). A page holds at
most 1,000 records or 1 MiB of ciphertext; the browser reads them one after
another.
Their own rate limit (60 a minute) leaves single writes untouched during an
import.

**One record** (`GET /api/vault/:id`) reads the messages of one chat without the
others: it is the same query shape as a page, scoped by owner and id, and any
record that is not the user's is `not_found`, like one that does not exist.

## Invariants

1. No route after `requireSession` can be reached without a session row.
2. No route trusts a user id, a revision owner or a record owner from the
   request: every query is scoped by the session's user id.
3. Every write is from the app's own origin, within size, rate and quota limits.
4. The server accepts only shapes that `src/crypto` can produce.

## Decisions and alternatives

- **Origin check in addition to SameSite=Lax:** the session cookie already
  stays off other sites' requests; checking `Origin` does not depend on that
  setting, and Better Auth does the same for its routes.
- **Rate limits in Postgres, on writes and on reads that can reach a market
  source:** Workers keep no memory between requests; Cloudflare's rate-limiting
  binding counts per location and only approximately, and its availability on
  the free plan is unconfirmed. Other reads (keys, vault pages) stay at one
  database round trip, which matters for users far from Frankfurt.
- **A per-user advisory lock rather than `SERIALIZABLE`:** serializable
  transactions would also stop the race, but fail with retryable errors the
  route would have to repeat; the lock simply queues one user's writes, which
  arrive one at a time from a real client anyway.
- **413 for quotas** rather than 409 (taken by revision conflicts) or 403
  (taken by origin and freshness).
- **Revisions instead of last-write-wins:** two devices must not silently
  overwrite each other's record.
- **Slots named by their IV when replaced** (a compare-and-swap): two tabs that
  each create a new recovery key would otherwise leave the user holding a key
  that no longer opens anything, without knowing it. Every wrapping has a fresh
  random IV, so the IV identifies the slot without a separate version counter,
  and a retry after a lost answer recognises its own write in the 409.

## Edge cases

- **A stolen session cannot read records, but can delete or overwrite them,**
  download the passphrase slot for offline guessing and use up the user's
  limits; signed in within 10 minutes, it can replace the wrapped keys. These
  are stated in the
  [threat model](../../../src/crypto/docs/threat-model.md); a CSV export of the
  transactions is the defense against losing them.
- **In the Workers test runner every request keeps its database connection
  until the test file ends,** so tests seed rate-limit counters instead of
  sending a hundred requests.

## How it is tested

`tests/integration/keys.test.ts`, `tests/integration/vault.test.ts` and, for
the market reads' limits, `tests/integration/market.test.ts`: every answer in
the table above, including another origin, no origin, oversized
bodies, seeded rate limits and their reset, freshness, conflicts, kind changes,
both quotas (for single writes and batches, also arriving at once), a batch
with a taken id writing nothing, and other users' attempts. See
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

A new route gets `rateLimit()` and `maxBody()` on writes, a schema from
`shared/schemas`, queries scoped by `c.get("user").id`, and tests for each
refusal and for another user's attempt — in the same commit.

Last reviewed: 2026-11-25
