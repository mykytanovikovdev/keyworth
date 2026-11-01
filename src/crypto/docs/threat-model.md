# Threat model

Version 1 (phase 3). What Keyworth's end-to-end encryption promises, against
whom, and what it does not protect. The mechanisms are described in
[key-hierarchy.md](key-hierarchy.md), [envelopes.md](envelopes.md),
[argon2.md](argon2.md) and [remember-device.md](remember-device.md).

## Assets

- **Financial data:** trades, positions derived from them, amounts, notes, chat
  history, alerts, settings, and later a user's own Anthropic API key.
- **Keys:** the passphrase, the recovery key, the data key (DEK), and the device
  key of a remembered browser.

## Adversaries considered

| Adversary                             | Has                                                        |
| ------------------------------------- | ---------------------------------------------------------- |
| A curious or compromised operator     | The database, server logs, the ability to deploy code      |
| Someone with a database dump          | Every table, including wrapped keys and envelopes          |
| A network observer                    | Traffic between the browser and Cloudflare (TLS-protected) |
| Someone with a stolen session cookie  | Whatever a signed-in browser can ask the API for           |
| A script injected into the page (XSS) | Code running on keyworth.app inside the user's browser     |
| A malicious browser extension         | The same, for every site the extension can access          |
| Someone holding the unlocked device   | The open browser                                           |

## Protected

- **Stored data is ciphertext.** Trades, chat history, alerts and settings are
  stored only as AES-256-GCM envelopes. The operator, and anyone with a copy of
  the database, sees ciphertext. Reading it requires the passphrase, the
  recovery key or a remembered device: the device key in that browser's files
  together with the server half, which the server gives only to that browser's
  session with its device cookie.
- **Records cannot be moved or replayed through the API.** Each envelope is
  bound by its AAD to its owner, kind, id and revision: it does not decrypt in
  another user's vault, under another kind or id, or written back over a newer
  version of itself.
- **Wrapped keys cannot be swapped.** Each wrapped copy of the DEK is bound to
  its owner and slot kind.
- **A stolen session cookie alone reads no plaintext**: the API returns only
  wrapped keys and envelopes, and a remembered device's half only to that
  browser's session with its session-only cookie. What it can still do is
  listed under "Not protected against".
- **Metadata is reduced:** record sizes are padded to buckets, so the server
  learns "small", not the length of a note.

## Visible to the operator

- The name and email from Google, and sign-in sessions (when, IP address,
  browser).
- For each record: its kind (trade, chat, alert…), its size bucket, its
  revision, when it was created and changed, and how many records a user has.
- The Argon2 settings and salts, that a recovery key exists, and when the
  passphrase or the recovery key was last replaced.
- When a device was remembered, and in which sign-in session (so from which IP
  address and browser).
- When a user writes (the rate-limit window) and, from the requests themselves,
  when they unlock: the vault is loaded at every unlock.
- Which prices are requested (not linked to users in logs) and token usage.

## In transit through the server

To answer a question, the needed data is decrypted in the browser and sent
through `/api/chat` to Anthropic's model (phase 5). The server does not store or
log it — a promise, not a cryptographic guarantee. By default the model gets
shares and percentages, not amounts. Cloudflare terminates TLS and technically
sees that traffic. With a user's own API key (phase 13) the browser talks to
Anthropic directly and the server sees none of it.

## Not protected against

- **A malicious version of the site.** The operator delivers the code that
  holds the keys. The code is open source, but a browser cannot verify that
  what it received is that code, and a changed deployment could steal keys.
  This is true of every web-based end-to-end encrypted app.
- **Script injection (XSS) or a malicious browser extension.** The strict CSP
  and Trusted Types exist to prevent the injection
  (see [worker/docs/security-headers.md](../../../worker/docs/security-headers.md));
  if one happens anyway:
  - while the app is unlocked, the script can _use_ the non-extractable DEK to
    decrypt everything;
  - while a device is remembered, it can do more: the device key may unwrap the
    DEK, and WebCrypto lets whoever unwraps choose to make the result
    extractable, so one injection can copy the raw DEK and read all data, past
    and future, offline; Lock does not undo that;
  - while the app is locked, the script can capture the passphrase or the
    recovery key as the user types it.

  The DEK is never rotated (below), so a stolen DEK or secret stays useful.

- **An unlocked, unattended device.** Someone using the open browser sees what
  the user sees. The operating system's screen lock is the defense; Lock ends
  it in every tab, and so does 15 minutes without activity in any tab, unless
  the device is remembered (then it lasts until Lock, sign-out, the browser
  closing, or 14 days).
- **Malware on the device.** It can read keystrokes and memory.
- **A passphrase kept in the browser's password manager.** If it syncs to the
  same Google account the user signs in with, whoever takes over that account
  has both the sign-in and the passphrase. Passphrase fields ask browsers not
  to suggest, save or fill (`autocomplete="off"`), but browsers may ignore
  that for password fields (Chrome does), so a user can still save it there;
  a separate password manager, or paper, is the advice.
- **Losing both the passphrase and the recovery key.** The data is gone; nobody
  can recover it, by design.
- **Deletion and rollback by the server.** The server cannot read or forge
  records, but it can delete one, or return an older version of the same record
  together with its older revision (the AAD still matches). Detecting this would
  need per-device version tracking that works on one device only; release 1
  does not attempt it. A client writing through the API cannot do the same: an
  old version written back is stored with a newer revision and fails as
  `tampered` ([envelopes.md](envelopes.md)).
- **A stolen session cookie.** It reads no plaintext, but it can:
  - download the passphrase slot and try passphrases offline, as with a
    database dump (below);
  - delete records, or overwrite them with data that no longer decrypts (Export,
    phase 4, is the defense), and write a deleted record's first version back;
  - fill the user's quotas and keep the user's write limit used up.

  Signed in within the last 10 minutes (the condition that also allows
  deleting the account), it can replace the wrapped keys, after which the
  user's passphrase and recovery key open nothing.

- **Holders of an old passphrase or recovery key.** Changing either keeps the
  same DEK (that is what makes the change instant), so whoever already has the
  old secret and a copy of its wrapped key (downloaded earlier, or in a
  database backup) can still open the data. Rotating the DEK, which means
  re-encrypting everything, is not implemented.
- **A database copy together with a remembered browser's files.** The profile
  holds the device key (Chromium and Firefox keep IndexedDB unencrypted on
  disk; Safari wraps keys with one from the system keychain); with the device
  row from the database it opens the DEK, for as long as that row exists (the
  server stops handing it out after 14 days, but the row stays until Lock,
  sign-out or the session's end; see
  [remember-device.md](remember-device.md)).
- **Backups after account deletion.** Deleting an account removes its rows at
  once; the database provider's backups and point-in-time history keep them
  for their retention period.
- **Offline guessing after a database breach.** An attacker with the database
  can try passphrases against a passphrase slot at the cost of one Argon2id
  computation per guess (64 MiB, 3 passes). A long passphrase is the defense;
  the minimum is 12 plain-Latin characters, enforced by every flow that sets
  a passphrase.

## Assumptions

- The browser's WebCrypto implementation is correct and its random number
  generator is sound.
- `@noble/hashes` computes Argon2id correctly (checked against RFC 9106 and
  against Node's native implementation; see
  [tests/unit/docs/crypto-tests.md](../../../tests/unit/docs/crypto-tests.md)).
- TLS between the browser and Cloudflare is not broken.

We do not claim that "no one can ever see" anything, and the code has not been
independently audited.

## Invariants

1. No plaintext of a record, no passphrase and no recovery key ever reaches the
   server (tested: "no plaintext anywhere in the database").
2. The working DEK is never extractable and never written to disk.
3. A device key is non-extractable and lives only in that browser's IndexedDB.
4. Every encryption and every wrap uses a fresh random 96-bit IV.

## How to change it safely

Any change to what the server stores, to the key flows or to the CSP must update
this file in the same commit, and every new "not protected" item must be stated
here plainly rather than left implicit.

Last reviewed: 2026-10-31
