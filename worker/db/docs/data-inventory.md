# Data inventory

Every table, what it holds, and whether the server can read it. If a column is
not listed here, it should not exist. Schema: `schema.ts` and the generated
`auth-schema.ts`; migrations in `drizzle/`.

## Tables

| Table             | Holds                                                                                                                            | Readable by the server                                           | Deleted with                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `user`            | id, name, email, email verified, dates, which terms it accepted and when (avatar URL always null)                                | Yes                                                              | — (the account)                                            |
| `session`         | token, expiry, IP address, user agent, dates                                                                                     | Yes                                                              | user; cleanup once expired                                 |
| `account`         | the link to the Google account (provider and account ids); Google tokens always null                                             | Yes                                                              | user                                                       |
| `verification`    | short-lived OAuth state                                                                                                          | Yes                                                              | expiry (Better Auth)                                       |
| `rate_limit`      | Better Auth's request counters per IP and path                                                                                   | Yes                                                              | cleanup after an hour                                      |
| `allowed_emails`  | the invite list (lowercase emails)                                                                                               | Yes                                                              | `npm run users -- uninvite`                                |
| `blocked_emails`  | blocked emails, a reason in the owner's words, date                                                                              | Yes                                                              | `npm run users -- unblock`                                 |
| `user_key_slots`  | per user: kind (passphrase/recovery), format version, Argon2 settings, salt, IV, **wrapped data key**, dates                     | Only version, settings, salts and dates; the key is ciphertext   | user                                                       |
| `user_key_checks` | per user: format version, IV, the data key's **check value** (a 16-byte AES-GCM tag over nothing)                                | Only the version and date; the tag reveals nothing about the key | user                                                       |
| `vault_records`   | per record: id, kind, revision, envelope version, IV, **ciphertext**, dates                                                      | Only kind, size, revision and dates                              | user                                                       |
| `device_unlocks`  | per session: SHA-256 of the device cookie's token, IV, **data key wrapped by a device-only key**, date (unused after 14 days)    | Only the hash and date                                           | session and user; cleanup after 14 days                    |
| `api_rate_limits` | per user and bucket: window start and count                                                                                      | Yes                                                              | user; cleanup after an hour                                |
| `upstream_calls`  | per market source: calls this minute and this day (UTC), for all users together                                                  | Yes; nothing in it belongs to a user                             | kept: one row per source, reset by each new minute and day |
| `model_usage`     | per chat model: what it used today (UTC), in its own unit (Workers AI: neurons), for all users together                          | Yes; nothing in it belongs to a user                             | kept: one row per model, reset by each new day             |
| `market_cache`    | answers of market data sources by request: the snapshot, a coin, a search (with its text), a coin's or a currency's daily series | Yes; nothing in it belongs to a user                             | cleanup once expired (a day; Frankfurter's series 90 days) |

`allowed_emails` and `blocked_emails` are keyed by email, not by user, so they
survive account deletion on purpose: a deleted account is still invited (it can
sign in again and get an empty account) or still blocked.

## What the server can learn

- Who uses Keyworth (name, email), when and from where they sign in (IP, user
  agent).
- How much each user stores: the number of records per kind, their size buckets
  (256 bytes … 64 KiB), revisions and dates. For the chat that is the number of
  chats (a `conversation` and a `message` record each, never one per message),
  how long each one is to the nearest power of two, and roughly how often and
  when each was saved; and, while a chat is opened, which record is read.
- That a user has set up encryption, with which Argon2 settings, and when the
  passphrase or the recovery key was last replaced (`updated_at` of a slot).
- Whether and when a device was remembered, and in which session, so from
  which IP address and browser.
- When a user last wrote or asked for market data by name, for up to about a
  day (`api_rate_limits.window_start`), and, from the requests, when they unlock
  (the vault is loaded at every unlock).
- Which coins outside the snapshot, and which searches, are whose, in a small
  group of users: `market_cache` keeps when each was first asked for
  (`fetched_at`), and matching that with users' times above often leaves one
  user. Accepted: making the times coarser does not help when few people use
  the app at once ([threat model](../../../src/crypto/docs/threat-model.md)).
- Sessions keep their IP address and browser until they are deleted: on sign-out
  or revocation, or, once expired, by the daily cleanup at the latest.
- Nothing about the content of records or about the keys that open them.

## How long it stays

The account and everything that references it stay until the account is deleted.
Some rows lose their use long before that, and nothing else would remove them
while their owner stays away, so `worker/cleanup.ts` deletes them once a day at
03:00 UTC (a Cron Trigger in `wrangler.jsonc`):

| Rows                              | Deleted once                                          |
| --------------------------------- | ----------------------------------------------------- |
| `session` (with `device_unlocks`) | expired, which removes the IP address and user agent  |
| `device_unlocks`                  | older than 14 days, when the server already refuses   |
| `rate_limit`, `api_rate_limits`   | untouched for an hour, longer than any limit's window |

A run that fails is logged like any other error (`describe-error.ts`), shows as
failed in Cloudflare's trigger history, and is covered by the next day's run; the
privacy policy therefore promises two days, not one.

**Rejected:** `pg_cron` (the database sleeps when idle, so the schedule would not
run); deleting during requests (it adds work to every request and stops when
nobody signs in, which is when old rows matter most); running more often (each
run wakes the database, and a day is short enough for the promise).

## Invariants

1. Financial data exists in the database only inside `vault_records.ciphertext`.
2. No Google token and no avatar URL is ever stored.
3. Every table with user data cascades from `user` (and `device_unlocks` from
   `session`): deleting an account deletes all of it.
4. Binary columns have exact lengths enforced by `CHECK` constraints (salt 16,
   IV 12, wrapped key 48, check tag 16, token hash 32 bytes).
5. A user has both slots and a check value, or none of them: setup writes them
   in one transaction, and migration `0005` refuses to run over slots made
   before check values existed.
6. Expired sessions, remembered devices past 14 days, counters older than an
   hour and expired market data never survive a cleanup run; nothing else is
   touched by it.
7. `market_cache` holds no user id, email or address
   ([worker/market/docs/market-data.md](../../market/docs/market-data.md)).

## How it is tested

`tests/integration/vault.test.ts` ("keeps no plaintext anywhere in the
database": every column of the user's records and key slots, as text and raw
bytes, searched for the record's content, the passphrase and the recovery key),
`tests/integration/keys.test.ts` (account deletion leaves no slots, records,
remembered devices or counters) and `tests/integration/cleanup.test.ts` (what the
daily cleanup deletes and what it keeps). See
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

A new table or column updates this file in the same commit: what it holds,
whether the server can read it, and what deletes it. User data must reference
`user.id` with `on delete cascade`.

Last reviewed: 2026-11-15
