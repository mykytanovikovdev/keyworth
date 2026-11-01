# Key states and flows

How the browser decides what the user sees (create a passphrase, unlock, the
app) and how each flow changes the keys on the server. Code: `vault.ts`,
`records.ts`, `api.ts`.

## States

| State      | Means                                               | The app shows                        |
| ---------- | --------------------------------------------------- | ------------------------------------ |
| `starting` | Loading the keys, asking the other tabs             | Nothing yet                          |
| `insecure` | Not a secure context: no `crypto.subtle`            | "Open Keyworth over HTTPS"           |
| `failed`   | The keys could not be loaded (offline, server down) | An error with "Try again"            |
| `no-keys`  | Signed in, no keys yet                              | Create a passphrase                  |
| `locked`   | Keys exist, the data key is not in memory           | Unlock (with "Locked after 15 min…") |
| `unlocked` | The data key is in memory                           | The app; first the recovery key once |

## Starting

`start(userId)` runs once per signed-in user and page:

1. Not a secure context: `insecure`. Nothing else runs.
2. A Lock whose server half could not be deleted (offline) is finished:
   `DELETE /api/keys/device`.
3. **At the same time**: `GET /api/keys` and a request to the other tabs for
   the data key ([tabs-and-locking.md](tabs-and-locking.md)).
4. No keys: `no-keys`. Slots that fail validation, or a failed request:
   `failed`.
5. A tab answered with a key that passes the **check value**: `unlocked`,
   remembered if that tab's browser is.
6. "Remember this device": the device key from IndexedDB and the server half
   from `GET /api/keys/device` open the data key, which must pass the check
   value: `unlocked (remembered)`. When only one half exists (the browser's
   data was cleared; the server half expired after 14 days, or its session
   ended), both are dropped: the key from IndexedDB and, with
   `DELETE /api/keys/device`, the row and cookie.
7. Otherwise `locked`, with `idle: true` once after an idle lock (a note in
   sessionStorage, read and removed here).

## Setup (`createKeys`)

1. `createKeys` in `src/crypto` makes the data key, both slots, the check
   value and the recovery key. A passphrase that is not plain Latin, or shorter
   than 12 characters, is refused before Argon2 runs.
2. `POST /api/keys`. If it fails, the vault reads `GET /api/keys`: a stored
   passphrase slot with **this** setup's IV means the write went through and
   only the answer was lost; another IV means another tab or device set up keys
   first (`already-set-up`, the state becomes `locked`); none means it failed.
3. Only then `unlocked`, with `recoveryKey` set: the screen shows it until the
   user presses "I've saved it" (`recoveryKeySaved()`). A key whose slot the
   server does not hold is never shown.

## Unlock (`unlock`)

1. A passphrase that is not plain Latin fails with `not-latin` at once; one
   too short or too long fails as `wrong-secret` without Argon2 (no stored
   passphrase can be like that).
2. Argon2id and unwrap; then the **check value** (a damaged slot can unwrap to
   a wrong key only by chance, but the check costs nothing).
3. Weaker Argon2 settings than the current ones are rewrapped with the same
   passphrase, only when `GET /api/me` says the sign-in is at least a minute
   from being too old to replace a slot; otherwise at a later unlock.
4. With "Remember this device": the device key goes to IndexedDB, the wrapped
   data key to `POST /api/keys/device`. If either fails, the unlock still
   succeeds, unremembered (`{ remembered: false }`), and the device key is
   removed.

## Recovery, a new passphrase, a new recovery key

| Flow                | Needs                                | Replaces        |
| ------------------- | ------------------------------------ | --------------- |
| `resetPassphrase`   | locked; recovery key, new passphrase | passphrase slot |
| `changePassphrase`  | unlocked; current and new passphrase | passphrase slot |
| `createRecoveryKey` | unlocked; passphrase                 | recovery slot   |

Every replace sends `{ expectedIv, slot }` and needs a sign-in from the last 10
minutes (`403 session_not_fresh` otherwise; the screens ask `GET /api/me` for
`freshForSeconds` first, so nobody types a secret that would be refused). The
outcome:

- 2xx: done.
- 409 naming **this** slot's IV, or (after a network error) a stored slot with
  it: the write went through, the answer was lost: done.
- 409 naming another IV: another tab or device replaced the slot first.
  Nothing changed here; the vault reloads the keys and fails with
  `changed-elsewhere`.
- Anything else: the error as is.

`resetPassphrase` checks the recovered data key against the check value before
replacing anything. The recovery key keeps working after a reset; a new
recovery key makes the old one stop opening the stored slot.

## Records

`vault.encrypt(kind, id, revision, value)` and `vault.decrypt(...)` work only
while unlocked (`wrong-state` otherwise). `records.ts` builds on them:

- `readRecords` decrypts each record with the kind it asked for and checks it
  against the kind's schema; a record that fails either is returned with
  `value: null` (damaged), never dropped and never thrown.
- `writeRecord` encrypts for `revision + 1` (the revision is in the AAD) and
  sends the revision it read. A 409 `conflict` means another tab or device
  wrote first: read again, re-apply the change, write again.

## Invariants

1. A data key from another tab or from the device half is used only after it
   passed this account's check value.
2. A recovery key is shown only after the server holds the slot it opens.
3. The data key exists only inside `Vault` and never in storage.
4. A replace either applies or leaves the server's slot as another writer left
   it; the browser never believes a replace that did not happen.

## How it is tested

`tests/unit/vault/vault.test.ts` and `records.test.ts`, against a fake server
with the real API's rules; the same flows in real browsers are in
`tests/e2e/encryption.spec.ts`. See
[tests/unit/docs/vault-tests.md](../../../tests/unit/docs/vault-tests.md).

## How to change it safely

- A new way to obtain a data key must end in `verified()` before
  `becomeUnlocked`.
- A new slot replace must go through `replaceSlot`, which knows how to tell a
  lost answer from a conflict.
- Keep `readRecords` returning damaged records instead of throwing: one bad
  record must not hide a user's other data.

Last reviewed: 2026-10-31
