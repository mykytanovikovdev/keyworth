# worker/routes/

## Purpose

The app's own API routes, mounted under `/api` after the session check (Better
Auth's routes are separate, in `../auth.ts`). Today: storage for end-to-end
encryption. The server keeps wrapped keys and encrypted records here and can
read neither; the cryptography is in [src/crypto/](../../src/crypto/README.md).

## How it works

Every route here runs after `requireSession` (no session: 401) and
`requireSameOrigin` (a write without the app's `Origin`: 403), and reads the
user only from the session.

| Route                      | Does                                                                                         | Guards                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /api/keys`            | Both wrapped keys, or `{ keys: null }` before setup                                          |                                             |
| `POST /api/keys`           | First setup: passphrase and recovery slots together; 409 if done                             | 20 writes/min, 4 KB body                    |
| `PUT /api/keys/passphrase` | Replace the passphrase slot (new passphrase or newer Argon2 settings)                        | + sign-in in the last 10 minutes            |
| `PUT /api/keys/recovery`   | Replace the recovery slot (a new recovery key)                                               | + sign-in in the last 10 minutes            |
| `POST /api/keys/device`    | "Remember this device": store the device-wrapped key for this session, set the device cookie | 20 writes/min, 4 KB body                    |
| `GET /api/keys/device`     | The device-wrapped key, only for this session with the device cookie                         |                                             |
| `DELETE /api/keys/device`  | Lock / forget this device                                                                    |                                             |
| `GET /api/vault[?kind=]`   | The user's records, oldest first                                                             |                                             |
| `PUT /api/vault/:id`       | Create (`revision: 0`) or replace (the current revision) a record                            | 120 writes/min, 96 KB body, per-user quotas |
| `DELETE /api/vault/:id`    | Delete a record                                                                              | 120 writes/min                              |

Responses use plain error codes: `invalid_body`, `invalid_id`, `already_set_up`
(409), `not_set_up` (404), `session_not_fresh` (403), `conflict` (409, with the
current `revision`), `quota_exceeded` (413), `body_too_large` (413),
`rate_limited` (429, with `Retry-After`), `forbidden_origin` (403).

**Remembered devices.** `POST /api/keys/device` stores the data key wrapped by
a key that exists only in that browser's IndexedDB, in `device_unlocks` keyed by
the session id, together with the SHA-256 of a random 32-byte token. The token
goes to the browser as `__Host-keyworth-device`: httpOnly, Secure,
SameSite=Strict, Path=/, and no expiry, so the browser drops it when it closes.
`GET` returns the wrapped key only for the same session and the same token.
Signing out, revoking the session (`npm run users -- revoke`, "Sign out
everywhere") or its expiry deletes the row through the foreign key.

## Why this way

- **Validation from `shared/schemas`.** The browser and the Worker use the same
  zod schemas; the server accepts only envelopes and slots that `src/crypto`
  could have produced (exact byte lengths, padding buckets, Argon2 settings
  within limits).
- **Revisions instead of last-write-wins.** Two devices editing the same record
  must not silently overwrite each other; the loser gets 409 with the current
  revision and reloads.
- **Limits inside the write.** The record count and the bytes a user stores are
  checked in the same SQL statement that writes, so concurrent requests cannot
  slip past them. Only when nothing was written does a second query explain why.
- **Rate limits in Postgres** (`../limits.ts`), for writes only. Workers keep no
  memory between requests, and Cloudflare's rate-limiting binding counts per
  location and only approximately (its availability on the free plan is also
  unconfirmed). Reads stay at one round trip, which matters for users far from
  Frankfurt.
- **A recent sign-in to replace a wrapped key.** A stolen session cookie could
  otherwise replace a slot with garbage and lock the owner out. It cannot read
  anything either way.
- **The device cookie is separate from the session cookie.** The session lasts
  days; "until the browser closes" needs a cookie without an expiry, and
  binding it to one session makes sign-out and revocation end it.
- **Same-origin check on writes.** The session cookie is SameSite=Lax, which
  already keeps other sites from sending it with their requests; checking
  `Origin` as well does not depend on that setting (Better Auth does the same).

## Pitfalls & gotchas

- **A stolen session can still delete records.** It cannot read them, but
  `DELETE /api/vault/:id` needs only a session. Export (phase 4) is the
  defense; there is no undo.
- **The device cookie is `__Host-` only over HTTPS.** On `http://localhost` it
  is plain `keyworth-device` without Secure, so local development and the e2e
  builds work in every browser.
- **Raising the Argon2 settings later**: rewrapping a passphrase slot needs a
  fresh session, so the automatic upgrade must happen right after a sign-in,
  or the rule needs an exception for same-passphrase upgrades.
- **The GET routes are not rate-limited.** They need a session and cost one
  query; revisit in the phase 8 audit.
- **`/api/vault` returns everything** of a kind in one response. Fine for
  thousands of records; add paging before chat history grows large.

## How to work with it

- New route: add it here as a Hono sub-app, mount it in `../index.ts` after the
  session check, validate the body with a schema from `shared/schemas`, add
  `rateLimit()` and `maxBody()` to writes, and write tests in
  `tests/integration/` (including another user's attempt).
- Tests: `tests/integration/keys.test.ts`, `tests/integration/vault.test.ts`.

## Related

- [worker/](../README.md): the app, the session check, security headers
- [worker/db/](../db/README.md): the tables behind these routes
- [src/crypto/](../../src/crypto/README.md): what produces the slots and envelopes
- [shared/schemas/](../../shared/schemas/README.md): the request and response shapes
