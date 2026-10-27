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
| Someone holding the unlocked device   | The open browser                                           |

## Protected

- **Stored data is ciphertext.** Trades, chat history, alerts and settings are
  stored only as AES-256-GCM envelopes. The operator, and anyone with a copy of
  the database, sees ciphertext. Reading it requires the passphrase, the
  recovery key or a remembered device (which also needs that browser's files, a
  live session and the browser's session cookie).
- **Records cannot be moved.** Each envelope is bound by its AAD to its owner,
  kind and id: the server cannot swap a record into another user's vault,
  another kind or another row and have it decrypt.
- **Wrapped keys cannot be swapped.** Each wrapped copy of the DEK is bound to
  its owner and slot kind.
- **A stolen session cookie alone reads nothing**: the API returns only wrapped
  keys and envelopes. It cannot replace a wrapped key without a sign-in from
  the last 10 minutes, and cannot reach a remembered device's half without that
  browser's session-only cookie.
- **Metadata is reduced:** record sizes are padded to buckets, so the server
  learns "small", not the length of a note.

## Visible to the operator

- The name and email from Google, and sign-in sessions (when, IP address,
  browser).
- For each record: its kind (trade, chat, alert…), its size bucket, its
  revision, when it was created and changed, and how many records a user has.
- The Argon2 settings and salts, and that a recovery key and remembered devices
  exist.
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
  holds the keys. Open source lets anyone check it, but a changed deployment
  could steal keys. This is true of every web-based end-to-end encrypted app.
- **Script injection (XSS) while unlocked.** A non-extractable key cannot be
  read, but an injected script can still _use_ it to decrypt while the app is
  unlocked. The strict CSP and Trusted Types exist to prevent the injection
  (see [worker/docs/security-headers.md](../../../worker/docs/security-headers.md)).
  With "Remember this device" the window lasts as long as the device is
  remembered, not only while the user is in the app.
- **An unlocked, unattended device.** Someone using the open browser sees what
  the user sees. The operating system's screen lock is the defense; Lock ends
  it.
- **Malware on the device.** It can read keystrokes and memory.
- **Losing both the passphrase and the recovery key.** The data is gone; nobody
  can recover it, by design.
- **Deletion and rollback by the server.** The server cannot read or forge
  records, but it can delete one, or return an older version of the same record
  (the AAD still matches). Detecting this would need per-device version tracking
  that works on one device only; release 1 does not attempt it.
- **A stolen session deleting records.** Deleting needs only a session. Export
  (phase 4) is the defense.
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

Last reviewed: 2026-10-27
