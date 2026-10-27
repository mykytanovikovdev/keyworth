# src/crypto/

## Purpose

End-to-end encryption for Keyworth: everything that turns a user's secrets into
keys, and records into ciphertext the server cannot read. It runs only in the
browser. The server stores what this module produces (wrapped keys and
envelopes) and never sees a passphrase, a recovery key or the data key.

This module does cryptography only. Storing envelopes, talking to `/api/keys`
and `/api/vault`, locking and unlocking the app, and the screens around them
live elsewhere (`src/vault/` and the onboarding feature, phase 3).

**Status:** the primitives, the key flows and server storage
(`/api/keys`, `/api/vault`, see [worker/routes/](../../worker/routes/README.md))
are implemented and tested (phase 3, steps 1 and 2). The screens (step 3)
follow; the threat model below describes the complete design.

## How it works

```
passphrase ──Argon2id──► passphrase KEK ─┐
recovery key ──HKDF────► recovery KEK ───┼─ each wraps ─► data key (DEK) ──► encrypts every record
device key (IndexedDB) ──────────────────┘  (AES-GCM)     random AES-256-GCM
```

- One random **data key** per user encrypts every record; the copy the app uses
  is a non-extractable `CryptoKey`, only in memory.
- The server stores the data key only **wrapped**: by a key from the passphrase
  (Argon2id), by a key from the 160-bit recovery key (HKDF), and, if the user
  asks, by a key that lives only in that browser.
- Each **record** is a JSON value padded to a size bucket and encrypted into an
  envelope `{ v, alg, iv, ct }`, bound to its owner, kind and id.

The details live in [`docs/`](docs/):

| Document                                      | Covers                                                           |
| --------------------------------------------- | ---------------------------------------------------------------- |
| [threat-model.md](docs/threat-model.md)       | What is protected, what the operator sees, what is not protected |
| [key-hierarchy.md](docs/key-hierarchy.md)     | Keys, wrapped keys, AADs, the recovery key, every key flow       |
| [envelopes.md](docs/envelopes.md)             | Record format, IVs, AAD, padding, what the server validates      |
| [argon2.md](docs/argon2.md)                   | The library, settings, measurements, limits, upgrading           |
| [remember-device.md](docs/remember-device.md) | The split device key, its cookie and how it is forgotten         |

| File              | Role                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `index.ts`        | The public surface; import from here                                  |
| `key-slots.ts`    | The key flows: set up, unlock, change, replace, reset, remember       |
| `keys.ts`         | DEK and device key generation, wrap/unwrap, every AAD                 |
| `kdf.ts`          | Argon2id (passphrase) and HKDF (recovery key) to non-extractable KEKs |
| `params.ts`       | The approved Argon2 settings; validation of stored ones               |
| `envelope.ts`     | Encrypt and decrypt records                                           |
| `padding.ts`      | Size buckets                                                          |
| `recovery-key.ts` | Generating, formatting and parsing recovery keys                      |
| `passphrase.ts`   | Normalization, the plain-Latin rule and the length limits             |
| `serialize.ts`    | Key slots to and from the JSON of `/api/keys`, checked on the way in  |
| `encoding.ts`     | base64url, UTF-8, random bytes                                        |
| `errors.ts`       | `CryptoError` with `wrong-secret`, `tampered` or `invalid-input`      |

## Why this way

- **Standard primitives only:** AES-256-GCM, HKDF and key wrapping from
  WebCrypto; Argon2id from `@noble/hashes`, checked against RFC 9106 and
  against Node's native implementation. Nothing here is a new scheme.
- **Plain-JavaScript Argon2id** keeps the CSP free of exceptions (no WebAssembly,
  no Web Worker), at the cost of somewhat lower settings for the same wait
  ([argon2.md](docs/argon2.md)).
- **One data key, several wrappings:** a new passphrase rewraps one key; no
  record is re-encrypted ([key-hierarchy.md](docs/key-hierarchy.md)).
- **Bound ciphertext and size buckets:** records cannot be moved between users,
  kinds or rows, and their length is hidden ([envelopes.md](docs/envelopes.md)).
- **Honest limits:** a malicious deployment, XSS while unlocked, server rollback
  and lost secrets are stated as not protected
  ([threat-model.md](docs/threat-model.md)).

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
  (NFKC, spaces, trimmed ends) or the plain-Latin rule locks everyone out.
- **Plain Latin only** for everything typed by hand to reach the keys (the
  passphrase and the recovery key): printable ASCII. Anything else is refused
  with `not-latin` before any cryptography runs, so the screen can say "check
  the keyboard layout" ([docs/argon2.md](docs/argon2.md)).
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
- Timing on a device: `npm run dev -- --host --port 5180 --strictPort`, then
  open `http://<this computer's LAN address>:5180/design/kdf` on the phone (same
  Wi-Fi). The page checks the RFC 9106 vector and times the production
  settings. The e2e suite runs the same page under the production CSP in every
  engine.
- Changing the Argon2 settings: update `CURRENT_KDF_PARAMS`, measure on a phone,
  keep `KDF_LIMITS` in `shared/schemas/keys.ts` consistent; existing slots are
  upgraded at the next unlock.

## Related

- [docs/](docs/): the threat model and the detailed design of every part

- [shared/schemas/](../../shared/schemas/README.md): envelope, Argon2 settings and record kinds
- [src/ui/](../ui/README.md): the design system the encryption screens will use
- [worker/](../../worker/README.md): the CSP that protects these keys
- [tests/unit/](../../tests/unit/README.md): the tests for this module
