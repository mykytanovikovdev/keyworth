# Data inventory

Every table, what it holds, and whether the server can read it. If a column is
not listed here, it should not exist. Schema: `schema.ts` and the generated
`auth-schema.ts`; migrations in `drizzle/`.

## Tables

| Table             | Holds                                                                                                        | Readable by the server                                           | Deleted with                |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------- |
| `user`            | id, name, email, email verified, dates (avatar URL always null)                                              | Yes                                                              | — (the account)             |
| `session`         | token, expiry, IP address, user agent, dates                                                                 | Yes                                                              | user                        |
| `account`         | the link to the Google account (provider and account ids); Google tokens always null                         | Yes                                                              | user                        |
| `verification`    | short-lived OAuth state                                                                                      | Yes                                                              | expiry (Better Auth)        |
| `rate_limit`      | Better Auth's request counters per IP and path                                                               | Yes                                                              | —                           |
| `allowed_emails`  | the invite list (lowercase emails)                                                                           | Yes                                                              | `npm run users -- uninvite` |
| `blocked_emails`  | blocked emails, a reason in the owner's words, date                                                          | Yes                                                              | `npm run users -- unblock`  |
| `user_key_slots`  | per user: kind (passphrase/recovery), format version, Argon2 settings, salt, IV, **wrapped data key**, dates | Only version, settings, salts and dates; the key is ciphertext   | user                        |
| `user_key_checks` | per user: format version, IV, the data key's **check value** (a 16-byte AES-GCM tag over nothing)            | Only the version and date; the tag reveals nothing about the key | user                        |
| `vault_records`   | per record: id, kind, revision, envelope version, IV, **ciphertext**, dates                                  | Only kind, size, revision and dates                              | user                        |
| `device_unlocks`  | per session: SHA-256 of the device cookie's token, IV, **data key wrapped by a device-only key**, date       | Only the hash and date                                           | session and user            |
| `api_rate_limits` | per user and bucket: window start and count                                                                  | Yes                                                              | user                        |

`allowed_emails` and `blocked_emails` are keyed by email, not by user, so they
survive account deletion on purpose: a deleted account is still invited (it can
sign in again and get an empty account) or still blocked.

## What the server can learn

- Who uses Keyworth (name, email), when and from where they sign in (IP, user
  agent).
- How much each user stores: the number of records per kind, their size buckets
  (256 bytes … 64 KiB), revisions and dates.
- That a user has set up encryption, with which Argon2 settings, and when the
  passphrase or the recovery key was last replaced (`updated_at` of a slot).
- Whether and when a device was remembered, and in which session, so from
  which IP address and browser.
- When a user last wrote (`api_rate_limits.window_start`) and, from the
  requests, when they unlock (the vault is loaded at every unlock).
- Sessions keep their IP address and browser until they are deleted: on sign-out
  or revocation, or, once expired, when Better Auth next sees them.
- Nothing about the content of records or about the keys that open them.

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

## How it is tested

`tests/integration/vault.test.ts` ("keeps no plaintext anywhere in the
database": every column of the user's records and key slots, as text and raw
bytes, searched for the record's content, the passphrase and the recovery key)
and `tests/integration/keys.test.ts` (account deletion leaves no slots,
records, remembered devices or counters). See
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

A new table or column updates this file in the same commit: what it holds,
whether the server can read it, and what deletes it. User data must reference
`user.id` with `on delete cascade`.

Last reviewed: 2026-10-27
