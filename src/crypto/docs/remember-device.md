# "Remember this device"

An opt-in convenience: after unlocking with the passphrase, the app opens
without it in every tab and after reloads, until the browser closes, the user
presses Lock or signs out, the session ends, or 14 days pass. Requested by the owner (entering
a long passphrase every time is exhausting; reference: Passbolt, remembered
until the browser closes).

**Status:** implemented and tested end to end: the cryptography
(`unlockWithPassphrase({ remember: true })`, `unlockWithDevice`), the server
half (`/api/keys/device`, table `device_unlocks`), and the browser part
(the checkbox, IndexedDB storage, Lock; `src/vault`, see
[tabs-and-locking.md](../../vault/docs/tabs-and-locking.md)).

## How it works: a key split in two

```
browser (IndexedDB)                      server (device_unlocks, one row per session)
  device key  ── non-extractable ──┐     ┌── DEK wrapped by the device key (AES-GCM, AAD device|<userId>|1)
                                   └─────┤── SHA-256 of a random 32-byte token
browser cookie (session-only) ── token ──┘   deleted with the session (foreign key, on delete cascade)
```

**Remembering** (at unlock, checkbox ticked):

1. `unlockWithPassphrase({ remember: true })` opens the DEK, creates a random
   non-extractable device key, and wraps the DEK with it.
2. The browser stores the device key in IndexedDB as a `CryptoKey` (structured
   clone keeps it non-extractable) and sends the wrapped DEK to
   `POST /api/keys/device`.
3. The server stores it in `device_unlocks` under the current session id, with
   the SHA-256 of a fresh random token, and sets the cookie
   `__Host-keyworth-device=<token>`: httpOnly, Secure, SameSite=Strict,
   `Path=/`, no expiry. Remembering again replaces the row.

**Opening** (a new tab, a reload): `GET /api/keys/device` returns the wrapped
DEK only for the same session **and** the same token, and only within 14 days
of remembering (`DEVICE_MAX_AGE_DAYS` in `worker/routes/keys.ts`);
`unlockWithDevice` opens it with the device key from IndexedDB.

**Forgetting:**

| Event           | Effect                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lock            | `DELETE /api/keys/device` deletes the row and the cookie; the browser deletes the device key                         |
| Sign out        | The session row is deleted, and the device row with it                                                               |
| Session revoked | The same (`npm run users -- revoke`, "Sign out everywhere")                                                          |
| Session expired | Refused at once (no session, no device half); both rows are deleted when Better Auth next sees that session's cookie |
| Browser closed  | The session-only cookie is gone; the server refuses                                                                  |
| 14 days passed  | The server refuses; the passphrase is asked once, and the user may remember the device again                         |
| Account deleted | Everything goes with the user                                                                                        |

## Why it is safe enough

- **A database dump alone** has wrapped DEKs but no device keys.
- **The browser's files alone** have the device key but not the server half,
  which the server gives only to that session with its device cookie. Both
  together (the database and the files) do open the DEK while the device row
  exists: see the threat model.
- **A stolen session cookie** without the device cookie gets nothing
  (`{ slot: null }`); the device row is bound to one session, so another
  session with the same device cookie gets nothing either.
- **Revocation is central:** signing out ends that session's remembered
  device; "Sign out everywhere" or an owner's `revoke` ends every one at once.

## What it costs (in the threat model)

- **XSS:** while a device is remembered, an injected script can use the DEK at
  any time, and can also copy it: the device key may unwrap the DEK, and the
  caller of `unwrapKey` chooses whether the result is extractable. One
  injection then gives the raw DEK for good; Lock does not undo it.
- **An unlocked computer with the browser open** gives access without the
  passphrase.
- **"Until the browser closes" is not guaranteed:** browsers that restore the
  previous session (Chrome and Firefox with "continue where you left off") keep
  session cookies across restarts, and phones rarely close a browser at all.
  The sign-in session renews itself with use (seven days from the last visit),
  so for someone who visits every week neither would end it; the server's
  14-day limit does (the owner's choice: a passphrase once a fortnight). The
  checkbox's hint says that browsers which reopen tabs may keep it longer than
  the browser session.
- **The browser's files are worth more:** they hold the device key, and in
  Chromium and Firefox IndexedDB is not encrypted on disk.

## Invariants

1. Off by default; only the user turns it on, at unlock.
2. The device key is non-extractable and never leaves IndexedDB.
3. The server half is bound to one session and to the hash of a token that
   exists only in a session-only, httpOnly cookie.
4. Lock removes both halves; signing out or revoking the session removes the
   server half, and an expired session's half is never returned.
5. The server half is never returned more than 14 days after it was stored.

## Decisions and alternatives

- **Rejected: keeping only the DEK in IndexedDB.** Simpler, but the browser's
  files alone would open the data, and signing out elsewhere could not revoke it.
- **Rejected: a long-lived cookie (e.g. 30 days).** The owner chose "until the
  browser closes"; longer options can be added later as an explicit choice.
- **A 14-day ceiling** (owner, 2026-10-31; 7 and 30 days were the other
  options): browsers that restore tabs keep session cookies, and the session
  renews itself, so without a ceiling nothing would ever ask for the
  passphrase again. It is counted from remembering, on the server, so a
  device's clock cannot stretch it.
- **Separate from the session cookie:** the session lasts days; the device
  cookie must vanish with the browser.

## How it is tested

`tests/unit/crypto/key-slots.test.ts` ("remembering a device": opens with the
device key alone, not remembered unless asked, other devices' keys and other
users fail) and `tests/integration/keys.test.ts` (cookie flags, only the same
session with the cookie gets the slot, not after 14 days, Lock and sign-out
remove it, account deletion removes it). The browser part:
`tests/unit/vault/vault.test.ts` (a reload opens without the passphrase, Lock
forgets both halves, one half alone is dropped, a failed remember leaves no
key) and `tests/e2e/encryption.spec.ts` (the checkbox, a reload, Lock and the
server row, in Chromium, Firefox and WebKit).

Last reviewed: 2026-10-31
