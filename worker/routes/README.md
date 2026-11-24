# worker/routes/

## Purpose

The app's own API routes, mounted under `/api` after the session check (Better
Auth's routes are separate, in `../auth.ts`). Today: storage for end-to-end
encryption. The server keeps wrapped keys and encrypted records here and can
read neither; the cryptography is in [src/crypto/](../../src/crypto/README.md).

## How it works

Every route here runs after `requireSession` (no session: 401) and
`requireSameOrigin` (a write without the app's `Origin`: 403), and reads the
user only from the session. `GET /api/me` (in `../index.ts`) returns the user
and `freshForSeconds`: how long the session still counts as a recent sign-in,
so the browser asks for a fresh one before the user types a secret that a
replace would then refuse.

| Route                                  | Does                                                                                         | Guards                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /api/keys`                        | Both wrapped keys and the check value, or `{ keys: null }` before setup                      |                                             |
| `POST /api/keys`                       | First setup: the check value and both slots in one transaction; 409 if done                  | 20 writes/min, 4 KB body                    |
| `PUT /api/keys/passphrase`             | Replace the passphrase slot named by its IV (new passphrase or newer Argon2 settings)        | + sign-in in the last 10 minutes            |
| `PUT /api/keys/recovery`               | Replace the recovery slot named by its IV (a new recovery key)                               | + sign-in in the last 10 minutes            |
| `POST /api/keys/device`                | "Remember this device": store the device-wrapped key for this session, set the device cookie | 20 writes/min, 4 KB body                    |
| `GET /api/keys/device`                 | The device-wrapped key, only for this session with the device cookie, for 14 days            |                                             |
| `DELETE /api/keys/device`              | Lock / forget this device                                                                    | 20 writes/min                               |
| `GET /api/vault[?kind=][&after=]`      | The user's records, oldest first, in pages of 1,000 or 1 MiB of ciphertext; `next` continues |                                             |
| `GET /api/vault/:id`                   | One record of the user's, whatever its kind (a chat's messages)                              |                                             |
| `PUT /api/vault/:id`                   | Create (`revision: 0`) or replace (the current revision) a record                            | 120 writes/min, 96 KB body, per-user quotas |
| `POST /api/vault/batch`                | Create up to 100 new records at once, all or none: a CSV import, a new chat's two records    | 60 batches/min, 128 KB body, quotas         |
| `POST /api/vault/delete`               | Delete transactions or chats, up to 1,000 by id, or every chat; never settings               | 30 requests/min, 48 KB body                 |
| `DELETE /api/vault/:id`                | Delete a record                                                                              | 120 writes/min                              |
| `GET /api/market/prices[?ids=]`        | Prices in US dollars: the snapshot of the 250 largest coins, or the coins asked for          | 120 reads/min                               |
| `GET /api/market/history?asset=&from=` | A coin's daily closing prices in US dollars from a day: Coin Metrics or CoinGecko            | 120 reads/min                               |
| `GET /api/market/rates?quotes=&from=`  | Units of each currency (at most 10) per US dollar, day by day from a day                     | 60 reads/min                                |
| `GET /api/assets/search?q=`            | Coins matching a search, at most 20                                                          | 60 reads/min, 50 characters                 |
| `GET /api/assets/:id/logo`             | A coin's logo, through the Worker and cached a day                                           | none, on purpose (one per coin shown)       |

Responses use plain error codes: `invalid_body`, `invalid_id`, `already_set_up`
(409), `not_set_up` (404), `session_not_fresh` (403), `conflict` (409: for a record with the
current `revision`, for a key slot with the stored `iv`), `kind_mismatch` (409), `quota_exceeded` (413), `body_too_large` (413),
`rate_limited` (429, with `Retry-After`: the seconds left in the window), `forbidden_origin` (403),
`invalid_ids`, `invalid_asset`, `invalid_from`, `invalid_quotes`, `invalid_query` (400), `unknown_asset` (404),
`market_unavailable` (502: a market data source failed and nothing usable is cached; see
[market/docs/market-data.md](../market/docs/market-data.md)).

**Remembered devices:** `POST /api/keys/device` stores the data key wrapped by a
browser-only key under the current session and sets the session-only
`__Host-keyworth-device` cookie; `GET` returns it only to the same session with
that cookie, and not after 14 days (`DEVICE_MAX_AGE_DAYS`: then the passphrase
again); signing out or revoking the session deletes it. Design and threat
model: [src/crypto/docs/remember-device.md](../../src/crypto/docs/remember-device.md).

## Why this way

- **Validation from `shared/schemas`:** the server accepts only envelopes and
  slots that `src/crypto` could have produced.
- **Revisions, quotas inside the write, rate limits in Postgres, a recent
  sign-in to replace a wrapped key, and an `Origin` check on writes:** each is
  explained, with the alternatives, in
  [docs/api-guards.md](docs/api-guards.md).
- **A separate, session-bound device cookie** for "Remember this device":
  [src/crypto/docs/remember-device.md](../../src/crypto/docs/remember-device.md).

## Pitfalls & gotchas

- **A stolen session can still delete records** (it cannot read them); a CSV
  export of the transactions is the defense.
- **The device cookie is `__Host-` only over HTTPS;** on `http://localhost` it is
  plain `keyworth-device` without Secure, so local development and the e2e
  builds work in every browser.
- **Raising the Argon2 settings later** needs a fresh session to rewrap the
  passphrase slot: run the upgrade right after a sign-in, or allow
  same-passphrase upgrades explicitly.

## How to work with it

- New route: add it here as a Hono sub-app, mount it in `../index.ts` after the
  session check, validate the body with a schema from `shared/schemas`, add
  `rateLimit()` and `maxBody()` to writes, and write tests in
  `tests/integration/` (including another user's attempt).
- Tests: `tests/integration/keys.test.ts`, `tests/integration/vault.test.ts`.

## Related

- [docs/api-guards.md](docs/api-guards.md): every guard, its rule and its answer

- [worker/](../README.md): the app, the session check, security headers
- [worker/db/](../db/README.md): the tables behind these routes
- [src/crypto/](../../src/crypto/README.md): what produces the slots and envelopes
- [shared/schemas/](../../shared/schemas/README.md): the request and response shapes
