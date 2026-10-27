# "Remember this device"

An opt-in convenience: after unlocking with the passphrase, the app opens
without it in every tab and after reloads, until the browser closes, the user
presses Lock or signs out, or the session ends. Requested by the owner (entering
a long passphrase every time is exhausting; reference: Passbolt, remembered
until the browser closes).

**Status:** the cryptography (`unlockWithPassphrase({ remember: true })`,
`unlockWithDevice`) and the server half (`/api/keys/device`, table
`device_unlocks`) are implemented and tested; the checkbox, IndexedDB storage
and Lock come with the screens (phase 3, step 3).

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
DEK only for the same session **and** the same token; `unlockWithDevice` opens
it with the device key from IndexedDB.

**Forgetting:**

| Event                      | Effect                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Lock                       | `DELETE /api/keys/device` deletes the row and the cookie; the browser deletes the device key |
| Sign out                   | The session row is deleted, and the device row with it                                       |
| Session revoked or expired | The same (`npm run users -- revoke`, "Sign out everywhere")                                  |
| Browser closed             | The session-only cookie is gone; the server refuses                                          |
| Account deleted            | Everything goes with the user                                                                |

## Why it is safe enough

- **A database dump** has wrapped DEKs but no device keys.
- **The browser's files** have the device key but not a live session, the
  session-only cookie and the server half together.
- **A stolen session cookie** without the device cookie gets 404; the device
  row is bound to one session, so another session with the same device cookie
  gets nothing either.
- **Revocation is central:** signing out anywhere, "Sign out everywhere" or an
  owner's `revoke` ends every remembered device at once.

## What it costs (in the threat model)

- **XSS:** while a device is remembered, an injected script can use the DEK at
  any time, not just while the user is in the app.
- **An unlocked computer with the browser open** gives access without the
  passphrase.
- **"Until the browser closes" is not guaranteed:** browsers that restore the
  previous session (Chrome and Firefox with "continue where you left off") keep
  session cookies across restarts. The remembered state then lasts longer, but
  never longer than the sign-in session. The checkbox's hint says so.

## Invariants

1. Off by default; only the user turns it on, at unlock.
2. The device key is non-extractable and never leaves IndexedDB.
3. The server half is bound to one session and to the hash of a token that
   exists only in a session-only, httpOnly cookie.
4. Lock removes both halves; ending the session removes the server half.

## Decisions and alternatives

- **Rejected: keeping only the DEK in IndexedDB.** Simpler, but the browser's
  files alone would open the data, and signing out elsewhere could not revoke it.
- **Rejected: a long-lived cookie (e.g. 30 days).** The owner chose "until the
  browser closes"; longer options can be added later as an explicit choice.
- **Separate from the session cookie:** the session lasts days; the device
  cookie must vanish with the browser.

## How it is tested

`tests/unit/crypto/key-slots.test.ts` ("remembering a device": opens with the
device key alone, not remembered unless asked, other devices' keys and other
users fail) and `tests/integration/keys.test.ts` (cookie flags, only the same
session with the cookie gets the slot, Lock and sign-out remove it, account
deletion removes it). The browser part gets e2e tests with the screens.

Last reviewed: 2026-10-27
