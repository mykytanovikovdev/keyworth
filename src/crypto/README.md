# src/crypto/

## Purpose

End-to-end encryption for Keyworth: everything that turns a user's secrets into
keys, and records into ciphertext the server cannot read. It runs only in the
browser. The server stores what this module produces (wrapped keys and
envelopes) and never sees a passphrase, a recovery key or the data key.

This module does cryptography only. Storing envelopes, talking to `/api/keys`
and `/api/vault`, locking and unlocking the app, and the screens around them
live elsewhere (`src/vault/` and the onboarding feature, phase 3).

**Status:** the primitives and the key flows are implemented and tested
(phase 3, step 1). Server storage (step 2) and the screens (step 3) follow; the
threat model below describes the complete design and says which parts are
still to come.

## How it works

### Keys

```
passphrase ──Argon2id──► passphrase KEK ─┐
recovery key ──HKDF────► recovery KEK ───┼─ each wraps ─► data key (DEK) ──► encrypts every record
device key (IndexedDB) ──────────────────┘  (AES-GCM)     random AES-256-GCM
```

- **The data key (DEK)** is a random AES-256-GCM key made by WebCrypto when the
  user sets up encryption. One DEK encrypts all of a user's records. The copy
  the app works with is a **non-extractable** `CryptoKey`: page scripts can use
  it but cannot read its bytes, and it exists only in memory.
- **Key-encryption keys (KEKs)** wrap the DEK. Only the wrapped copies
  ("slots") are stored on the server:
  - **Passphrase slot.** The KEK comes from the passphrase through Argon2id
    (64 MiB, 3 passes, 1 lane, a random 16-byte salt per slot). The passphrase
    is Unicode-normalized (NFC) first, so the same phrase typed on another
    keyboard gives the same key.
  - **Recovery slot.** The KEK comes from the recovery key through HKDF-SHA-256.
    The recovery key is 160 random bits, so a deliberately slow function would
    add nothing; HKDF is built into WebCrypto and instant.
  - **Device slot** ("Remember this device", opt-in). The KEK is a random
    non-extractable key kept in IndexedDB; the wrapped DEK is stored on the
    server, tied to the current sign-in session (step 2).
- **Wrapping** is AES-GCM `wrapKey` with a random 96-bit IV and additional
  authenticated data (AAD) that names the owner and the slot kind:
  `key-slot|<userId>|passphrase|1`, `key-slot|<userId>|recovery|1`,
  `device|<userId>|1`. A wrong passphrase, a slot copied from another user, or
  a recovery wrapping passed off as a passphrase wrapping all fail the same
  way: the GCM tag does not verify (`wrong-secret`).

### Flows (`key-slots.ts`)

| Function                | Input                                       | Result                                                         |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `createKeys`            | passphrase                                  | DEK, passphrase slot, recovery slot, recovery key (shown once) |
| `unlockWithPassphrase`  | passphrase slot, passphrase                 | DEK; with `remember`, also a device key and device slot        |
| `unlockWithDevice`      | device key, device slot                     | DEK, no passphrase                                             |
| `unlockWithRecoveryKey` | recovery slot, recovery key                 | DEK                                                            |
| `changePassphrase`      | slot, current and new passphrase            | new passphrase slot (also upgrades Argon2 settings)            |
| `replaceRecoveryKey`    | passphrase slot, passphrase                 | new recovery slot and recovery key                             |
| `resetPassphrase`       | recovery slot, recovery key, new passphrase | DEK and a new passphrase slot                                  |

WebCrypto can wrap only an extractable key. So whenever a flow needs a new
wrapping, it unwraps the DEK once more as extractable, wraps it, and drops that
copy; the working copy stays non-extractable. That is also why changing the
passphrase or the recovery key asks for the current passphrase.

Argon2 settings are stored with each passphrase slot. If the current settings
become stronger, `isCurrentKdf()` reports an old slot and the app rewraps it
with `changePassphrase` (same passphrase) at the next unlock.

### Records (`envelope.ts`)

A record is a JSON value encrypted into an envelope:

```json
{
  "v": 1,
  "alg": "A256GCM",
  "iv": "<12 bytes, base64url>",
  "ct": "<ciphertext + 16-byte tag>"
}
```

- A fresh random 96-bit IV for every encryption.
- AAD: `record|<userId>|<kind>|<recordId>|1`. A record moved to another user,
  another kind or another id does not decrypt (`tampered`). The record id is a
  UUID the browser creates before encrypting, because it is part of the AAD.
- Every AAD field is validated against a pattern that cannot contain `|`
  (user ids are letters and digits, kinds come from a fixed list, record ids are
  UUIDs), so the joined string is unambiguous.
- **Padding:** before encryption the plaintext gets a `0x80` byte and zeros up to
  the next power of two, at least 256 bytes and at most 64 KiB (`padding.ts`).
  The server learns a size bucket, not a length: every short trade looks the
  same. The padding is checked only after AES-GCM has authenticated the block,
  so it cannot act as a padding oracle.
- The envelope's shape, including which ciphertext lengths are possible, is a
  zod schema in `shared/schemas/envelope.ts`, used by the browser before
  decrypting and by the server before storing.

### Files

| File              | Role                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `index.ts`        | The public surface; import from here                                  |
| `key-slots.ts`    | The key flows above                                                   |
| `keys.ts`         | DEK and device key generation, wrap/unwrap, every AAD                 |
| `kdf.ts`          | Argon2id (passphrase) and HKDF (recovery key) to non-extractable KEKs |
| `params.ts`       | The approved Argon2 settings; validation of stored ones               |
| `envelope.ts`     | Encrypt and decrypt records                                           |
| `padding.ts`      | Size buckets                                                          |
| `recovery-key.ts` | Generating, formatting and parsing recovery keys                      |
| `passphrase.ts`   | Normalization and the minimum length                                  |
| `encoding.ts`     | base64url, UTF-8, random bytes                                        |
| `errors.ts`       | `CryptoError` with `wrong-secret`, `tampered` or `invalid-input`      |

## Why this way

- **Standard primitives only.** AES-256-GCM, HKDF and key wrapping come from
  WebCrypto (the browser's native implementation); Argon2id from
  `@noble/hashes`, a widely used library audited by Cure53 — though its Argon2
  module was outside that audit, so the tests check it against RFC 9106's
  vector and against Node's native (OpenSSL) Argon2id with the production
  settings. Nothing here is a new scheme.
- **Argon2id from `@noble/hashes`, in plain JavaScript.** The strict CSP is
  what keeps a script injection from stealing keys, so it should have no holes.
  Every WebAssembly Argon2 needs `'wasm-unsafe-eval'`, and moving it to a Web
  Worker would also need a Trusted Types policy (the CSP says
  `trusted-types 'none'`). noble needs neither: `argon2idAsync` computes in
  slices and yields between them, so the page stays responsive on the main
  thread and the unlock screen can show real progress. Rejected: hash-wasm
  (WASM, faster, unaudited, last release 2024); libsodium.js (audited, but
  about half a megabyte and the same CSP exceptions). The trade-off: noble's
  Argon2 runs about 5–7× slower than native code (measured: 0.6 s in Node vs
  0.09 s for OpenSSL), so for the same waiting time the settings are lower than
  they could be with WASM. That costs an attacker a factor of a few, roughly
  two bits of passphrase entropy.
- **64 MiB, 3 passes, 1 lane.** RFC 9106's second recommended option, about
  three times OWASP's minimum (19 MiB, 2 passes). The target was at most about
  1.5 s on a phone. Measured with these settings (`/design/kdf`, October 2026):
  0.62 s in Safari on an iPhone (iOS 18.7, median of five), 0.7 s in Chromium,
  0.9 s in Firefox and 1.1 s in Playwright's WebKit on a recent Mac. Older or
  cheaper phones will be slower, which the headroom allows for. One lane because
  JavaScript computes lanes one after another anyway; more lanes would not slow
  an attacker down.
- **AES-GCM wrapping instead of AES-KW.** AES-KW (RFC 3394) has no AAD, so a
  wrapped key could not be bound to its owner and slot kind.
- **One DEK, several wrappings.** Changing the passphrase rewraps one key in a
  second; no record is re-encrypted.
- **A recovery key, not recovery questions or an operator escrow.** If the
  operator could recover data, so could anyone who breaks into the operator.
- **Size padding.** Cheap, and it removes the most telling metadata of a small
  record (the length of a note).

## Threat model (version 1)

What we promise, and what we do not.

**Protected.** Trades, positions, amounts, chat history, alerts, settings and a
user's own API key are stored only as envelopes. The operator, and anyone with a
copy of the database, sees ciphertext. Reading it requires the user's
passphrase, recovery key or a remembered device (which also needs that
device's files and a live session).

**Visible to the operator.**

- The name and email from Google, and sign-in sessions (when, IP address, browser).
- For each record: its kind (trade, chat, alert…), its size bucket, when it was
  created and changed, and how many records there are.
- The Argon2 settings and salts, and that a recovery key and remembered devices exist.
- Which prices are requested (not linked to users in logs) and token usage.

**In transit through the server.** To answer a question, the needed data is
decrypted in the browser and sent through `/api/chat` to Anthropic's model
(phase 5). The server does not store or log it — that is a promise, not a
cryptographic guarantee. By default the model gets shares and percentages, not
amounts. Cloudflare terminates TLS and technically sees that traffic.

**Not protected against.**

- **A malicious version of the site.** The operator delivers the code that
  holds the keys. Open source lets anyone check it, but a changed deployment
  could steal keys. This is true of every web-based end-to-end encrypted app.
- **Script injection (XSS) while unlocked.** A non-extractable key cannot be
  read, but an injected script can still _use_ it to decrypt while the app is
  unlocked. The strict CSP and Trusted Types exist to prevent that injection.
  With "Remember this device" the window lasts as long as the device is
  remembered, not just while the user is in the app.
- **An unlocked, unattended device.** Someone using your open browser sees what
  you see. The operating system's screen lock is the defense; Lock ends it.
- **Malware on the device.** It can read keystrokes and memory.
- **Losing both the passphrase and the recovery key.** The data is gone; nobody
  can recover it, by design.
- **Deletion and rollback by the server.** The server cannot read or forge
  records, but it can delete one, or return an older version of the same record
  (the AAD still matches). Detecting this would need per-device version
  tracking that works only on one device; release 1 does not attempt it.
- **Offline guessing after a database breach.** An attacker with the database
  can try passphrases against a passphrase slot, at the cost of one Argon2id
  computation per guess. A long passphrase is the defense; the minimum is 12
  characters.

We do not claim that "no one can ever see" anything, and the code has not been
independently audited.

## Pitfalls & gotchas

- **Never make the working DEK extractable.** Only the flows in `key-slots.ts`
  unwrap an extractable copy, and only to wrap it at once.
- **Never reuse an IV.** Every encryption and wrap draws a new random one;
  there is no counter to get wrong. Do not add a code path that takes an IV as
  input.
- **Never build an AAD by hand.** Use `keySlotAad`, `deviceAad` and
  `recordAad`; they validate every field. Changing the AAD format makes every
  existing record unreadable: bump the version and keep reading the old one.
- **Stored Argon2 settings are untrusted.** They come from the server;
  `assertKdfParams` refuses anything below OWASP's minimum or large enough to
  hang the page.
- **WebCrypto needs a secure context.** `crypto.subtle` is undefined on
  `http://<LAN IP>`; `localhost` and HTTPS are fine. The benchmark page uses
  noble alone, so it also works on a phone over the local network.
- **Normalization is part of the key.** Changing how passphrases are normalized
  locks everyone out. NFC is permanent.
- **zod must stay jitless** (`shared/schemas/zod.ts`): otherwise its eval probe
  shows up as a Trusted Types violation.
- **Wiping memory is best effort.** Derived bytes are zeroed after use, but
  JavaScript gives no guarantee that no copy remains.

## How to work with it

```ts
import {
  createKeys,
  encryptRecord,
  decryptRecord,
  unlockWithPassphrase,
} from "../crypto/index.ts";

const { dataKey, passphraseSlot, recoverySlot, recoveryKey } = await createKeys(
  {
    userId,
    passphrase,
    onProgress: (fraction) => setProgress(fraction),
  },
);
// Show recoveryKey once; store both slots through /api/keys.

const ref = {
  userId,
  kind: "settings",
  recordId: crypto.randomUUID(),
} as const;
const envelope = await encryptRecord(dataKey, ref, { baseCurrency: "EUR" });
const value = await decryptRecord(dataKey, ref, envelope); // validate with the kind's schema next
```

- Tests: `npx vitest run --project unit` (`tests/unit/crypto/`). They cover RFC
  9106's vector, noble against Node's native Argon2id with the production
  settings, every flow, wrong secrets, swapped slots, tampering, moved records,
  IV uniqueness and padding.
- Timing on a device: `npm run dev -- --host`, then open
  `http://<this computer's IP>:5173/design/kdf` on the phone (same Wi-Fi). The
  page checks the RFC 9106 vector and times the production settings. The e2e
  suite runs the same page under the production CSP in every engine.
- Changing the Argon2 settings: update `CURRENT_KDF_PARAMS`, measure on a phone,
  keep `KDF_LIMITS` in `shared/schemas/keys.ts` consistent; existing slots are
  upgraded at the next unlock.

## Related

- [shared/schemas/](../../shared/schemas/README.md): envelope, Argon2 settings and record kinds
- [src/ui/](../ui/README.md): the design system the encryption screens will use
- [worker/](../../worker/README.md): the CSP that protects these keys
- [tests/unit/](../../tests/unit/README.md): the tests for this module
