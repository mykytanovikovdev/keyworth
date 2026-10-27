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

| Guard              | Where                                                | Rule                                                                                       | Answer                                                           |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Session            | every route                                          | A session row from the cookie; the user id comes only from it                              | 401 `unauthorized`                                               |
| Same origin        | every POST, PUT, DELETE                              | `Origin` must equal the origin of `BETTER_AUTH_URL`                                        | 403 `forbidden_origin`                                           |
| Rate limit (keys)  | writes to `/api/keys`                                | 20 per user per minute                                                                     | 429 `rate_limited` + `Retry-After`                               |
| Rate limit (vault) | writes to `/api/vault`                               | 120 per user per minute                                                                    | 429 `rate_limited` + `Retry-After`                               |
| Fresh session      | `PUT /api/keys/passphrase`, `PUT /api/keys/recovery` | Session created in the last 10 minutes                                                     | 403 `session_not_fresh`                                          |
| Body size          | `/api/keys` writes; `PUT /api/vault/:id`             | 4 KB; 96 KB                                                                                | 413 `body_too_large`                                             |
| Schema             | every body and id                                    | Exact shapes from `shared/schemas` (lengths, buckets, Argon2 limits, no extra fields)      | 400 `invalid_body` / `invalid_id` / `invalid_kind`               |
| Revision           | `PUT /api/vault/:id`                                 | `0` creates; otherwise must equal the stored revision (at most 2³¹−2); kind cannot change  | 409 `conflict` + current `revision`, 409 `kind_mismatch`, or 404 |
| Quotas             | `PUT /api/vault/:id`                                 | At most 20,000 records and 50 MiB of ciphertext per user, checked in the writing statement | 413 `quota_exceeded`                                             |
| One-time setup     | `POST /api/keys`                                     | Both slots once                                                                            | 409 `already_set_up`                                             |
| Device unlock      | `GET /api/keys/device`                               | Same session **and** the device cookie's token hash                                        | 404 `not_remembered`                                             |

**Rate limiting** keeps one row per user and bucket in `api_rate_limits`
(window start and count), updated by a single upsert that resets the count when
the window has passed. It runs only on writes.

**Quotas and revisions** live in the same SQL statement as the write (the
`WHERE` clause of the insert or update). Revisions hold under concurrency by
themselves (the row lock); quotas need more, because at Postgres's default
isolation two inserts running at once do not see each other's rows and could
both pass the count. So each vault write runs in a transaction that first takes
a per-user advisory lock (`pg_advisory_xact_lock`): one write per user at a time
counts and writes; other users are never blocked. When nothing was written, one
more query tells which rule refused it.

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
- **Rate limits in Postgres, on writes only:** Workers keep no memory between
  requests; Cloudflare's rate-limiting binding counts per location and only
  approximately, and its availability on the free plan is unconfirmed. Reads
  stay at one database round trip, which matters for users far from Frankfurt.
- **A per-user advisory lock rather than `SERIALIZABLE`:** serializable
  transactions would also stop the race, but fail with retryable errors the
  route would have to repeat; the lock simply queues one user's writes, which
  arrive one at a time from a real client anyway.
- **413 for quotas** rather than 409 (taken by revision conflicts) or 403
  (taken by origin and freshness).
- **Revisions instead of last-write-wins:** two devices must not silently
  overwrite each other's record.

## Edge cases

- **A stolen session can delete records** (it cannot read them). Export (phase 4) is the defense.
- **In the Workers test runner every request keeps its database connection
  until the test file ends,** so tests seed rate-limit counters instead of
  sending a hundred requests.

## How it is tested

`tests/integration/keys.test.ts` and `tests/integration/vault.test.ts`: every
answer in the table above, including another origin, no origin, oversized
bodies, seeded rate limits and their reset, freshness, conflicts, kind changes,
both quotas, and other users' attempts. See
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

A new route gets `rateLimit()` and `maxBody()` on writes, a schema from
`shared/schemas`, queries scoped by `c.get("user").id`, and tests for each
refusal and for another user's attempt — in the same commit.

Last reviewed: 2026-10-27
