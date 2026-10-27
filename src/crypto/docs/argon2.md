# Argon2id: the passphrase key

How the passphrase becomes a key-encryption key, why with this library and
these settings, and how the settings can change. Code: `kdf.ts`, `params.ts`,
`passphrase.ts`; limits: `shared/schemas/keys.ts`.

## How it works

1. The passphrase is normalized to Unicode NFC (`normalizePassphrase`), so the
   same phrase typed on two keyboards gives the same bytes. Case and spaces are
   kept: they are part of the passphrase.
2. `argon2idAsync` from `@noble/hashes` derives 32 bytes with the slot's salt
   (16 random bytes) and settings, reporting progress from 0 to 1.
3. The bytes are imported as a non-extractable AES-GCM key with usages
   `wrapKey` and `unwrapKey`, and zeroed (best effort).

## Settings

| Setting   | Value                      | Note                                                      |
| --------- | -------------------------- | --------------------------------------------------------- |
| algorithm | Argon2id, version 1.3 (19) | RFC 9106                                                  |
| memory    | 64 MiB                     | RFC 9106's second recommended option                      |
| passes    | 3                          | about three times OWASP's minimum work (19 MiB, 2 passes) |
| lanes     | 1                          | JavaScript runs lanes one after another anyway            |
| salt      | 16 random bytes per slot   |                                                           |
| output    | 32 bytes                   |                                                           |

Measured with these settings on the `/design/kdf` page (October 2026): **0.62 s
in Safari on an iPhone** (iOS 18.7, median of five), 0.7 s in Chromium, 0.9 s
in Firefox and 1.1 s in Playwright's WebKit on a recent Mac; 0.6 s in Node,
against 0.09 s for Node's native OpenSSL Argon2id. The target was at most about
1.5 s on a phone; the headroom covers slower phones.

**Accepted stored settings** (`KDF_LIMITS`): memory 19–256 MiB, passes 2–10,
1–4 lanes, Argon2id version 19 only. Settings come back from the server and are
untrusted: anything weaker than OWASP's minimum is refused (`invalid-input`)
before deriving, and anything larger could hang or crash the page.

**Passphrase policy** (`passphrase.ts`): at least 12 and at most 1,024
characters, counted as graphemes (characters as people see them) after NFC. No
strength-estimation library; the screen suggests four or more random words.

## Decisions and alternatives

- **`@noble/hashes` (plain JavaScript), approved by the owner.** The strict CSP
  keeps a script injection from stealing keys, so it should have no exceptions.
  Every WebAssembly Argon2 needs `'wasm-unsafe-eval'`, and moving it into a Web
  Worker would also need a Trusted Types policy (the CSP says
  `trusted-types 'none'`). `argon2idAsync` computes in slices and yields to the
  event loop between them, so the page stays responsive on the main thread and
  the unlock screen can show real progress.
- **Rejected:** hash-wasm (WebAssembly, faster, not audited, last release in
  2024, two CSP exceptions); libsodium.js (audited, about half a megabyte, the
  same CSP exceptions).
- **The trade-off, stated plainly:** noble's Argon2 is 5–7× slower than native
  code, so for the same waiting time the settings are lower than they could be
  with WebAssembly. An attacker gains a factor of a few — roughly two bits of
  passphrase entropy. The rest of `@noble/hashes` was audited by Cure53, but its
  Argon2 module was not, which is why the tests check it against RFC 9106's test
  vector and against Node's native implementation with the production settings.

## Invariants

1. New and upgraded slots use `CURRENT_KDF_PARAMS`; stored settings are
   validated before use.
2. The passphrase is NFC-normalized and otherwise unchanged; this is permanent.
3. The derived key is non-extractable and only wraps and unwraps.

## Changing the settings

1. Raise `CURRENT_KDF_PARAMS`, keep `KDF_LIMITS` consistent, measure on a phone
   (`npm run dev -- --host --port 5180 --strictPort`, then
   `http://<computer's LAN address>:5180/design/kdf` on the phone).
2. Existing slots keep working: their settings are stored with them.
   `isCurrentKdf` reports an old slot, and the app rewraps it with
   `changePassphrase` using the same passphrase.
3. Replacing a slot needs a sign-in from the last 10 minutes, so the upgrade
   must run right after a Google sign-in, or the server must allow
   same-passphrase upgrades explicitly. Decide this before the first change.

## Edge cases

- **The benchmark page works over plain HTTP on a phone** because it uses noble
  alone; the real screens need WebCrypto, which exists only on HTTPS or
  `localhost`.
- **Lowering the minimum** (`KDF_LIMITS`) would let a malicious server push
  weak settings for new slots; it should only ever go up.

## How it is tested

`tests/unit/crypto/kdf.test.ts` (RFC 9106 vector, noble against Node's native
Argon2id with the production settings, determinism, NFC, non-extractable keys,
progress, refused settings) and `tests/e2e/kdf-benchmark.spec.ts` (the vector
and the production settings in Chromium, Firefox and WebKit under the real CSP).

Last reviewed: 2026-10-27
