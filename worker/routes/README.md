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
| `GET /api/keys`            | Both wrapped keys and the check value, or `{ keys: null }` before setup                      |                                             |
| `POST /api/keys`           | First setup: the check value and both slots in one transaction; 409 if done                  | 20 writes/min, 4 KB body                    |
| `PUT /api/keys/passphrase` | Replace the passphrase slot named by its IV (new passphrase or newer Argon2 settings)        | + sign-in in the last 10 minutes            |
| `PUT /api/keys/recovery`   | Replace the recovery slot named by its IV (a new recovery key)                               | + sign-in in the last 10 minutes            |
| `POST /api/keys/device`    | "Remember this device": store the device-wrapped key for this session, set the device cookie | 20 writes/min, 4 KB body                    |
| `GET /api/keys/device`     | The device-wrapped key, only for this session with the device cookie                         |                                             |
| `DELETE /api/keys/device`  | Lock / forget this device                                                                    | 20 writes/min                               |
| `GET /api/vault[?kind=]`   | The user's records, oldest first                                                             |                                             |
| `PUT /api/vault/:id`       | Create (`revision: 0`) or replace (the current revision) a record                            | 120 writes/min, 96 KB body, per-user quotas |
| `DELETE /api/vault/:id`    | Delete a record                                                                              | 120 writes/min                              |

Responses use plain error codes: `invalid_body`, `invalid_id`, `already_set_up`
(409), `not_set_up` (404), `session_not_fresh` (403), `conflict` (409: for a record with the
current `revision`, for a key slot with the stored `iv`), `kind_mismatch` (409), `quota_exceeded` (413), `body_too_large` (413),
`rate_limited` (429, with `Retry-After`: the seconds left in the window), `forbidden_origin` (403).

**Remembered devices:** `POST /api/keys/device` stores the data key wrapped by a
browser-only key under the current session and sets the session-only
`__Host-keyworth-device` cookie; `GET` returns it only to the same session with
that cookie; signing out or revoking the session deletes it. Design and threat
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

- **A stolen session can still delete records** (it cannot read them); export
  (phase 4) is the defense.
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
