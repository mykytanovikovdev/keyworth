# Argon2id: the passphrase key

How the passphrase becomes a key-encryption key, why with this library and
these settings, and how the settings can change. Code: `kdf.ts`, `params.ts`,
`passphrase.ts`; limits: `shared/schemas/keys.ts`.

## How it works

1. The passphrase is normalized (`normalizePassphrase`), so the same phrase
   typed on two keyboards gives the same bytes: NFKC turns full-width letters
   and digits into plain ones, every kind of space (a no-break space from
   Option+Space, a tab, an ideographic space) becomes an ordinary space, and
   spaces at either end are dropped. Case and inner spaces are kept.
2. What remains must be **plain Latin**: printable ASCII only (a–z, A–Z,
   digits, the space and ASCII punctuation). Anything else is refused with
   `not-latin` before Argon2 runs: no slot can hold it, and it usually means
   another keyboard layout is on.
3. `argon2idAsync` from `@noble/hashes` derives 32 bytes with the slot's salt
   (16 random bytes) and settings, reporting progress from 0 to 1.
4. The bytes are imported as a non-extractable AES-GCM key with usages
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
in Safari on an iPhone** (Safari 27 on iOS 27, median of five; the user agent
still says iOS 18.7), 0.7 s in Chromium, 0.9 s in Firefox and 1.1 s in
Playwright's WebKit on a recent Mac; 0.6 s in Node, against 0.09 s for Node's
native OpenSSL Argon2id. The target was at most about 1.5 s on a phone; the
headroom covers slower phones.

**Measure on a phone over HTTPS.** WebKit, which every iOS browser uses, can
run JavaScript many times slower on a page that is not a secure context: over
plain http to the Mac's address the same derivation sometimes took 40 s on the
same iPhone (November 2026), and Playwright's WebKit is always several times
slower there. The production site is always HTTPS; `/design/kdf` shows whether
the page is a secure context and where the time goes.

**Accepted stored settings** (`KDF_LIMITS`): memory 19–256 MiB, passes 2–10,
1–4 lanes, Argon2id version 19 only. Settings come back from the server and are
untrusted: anything weaker than OWASP's minimum is refused (`invalid-input`)
before deriving, and the upper limits keep a malicious server from hanging or
crashing the page for long (the largest accepted settings are about 13 times
the current work: several seconds on a phone).

**Passphrase policy** (`passphrase.ts`): plain Latin, at least 12 and at most
1,024 characters after normalization. `checkPassphrase` reports the problem for
the screen (`not-latin`, `too-short`, `too-long`); every flow that creates a
passphrase slot (`createKeys`, `changePassphrase`, `resetPassphrase`) refuses
the same passphrases itself. No strength-estimation library; the screen
suggests four or more random words.

## Decisions and alternatives

- **Plain Latin only (owner's decision).** Everything a person types by hand
  to reach their keys (the passphrase, the recovery key) is printable ASCII.
  Letters outside it arrive in different forms on different keyboards and
  phones (precomposed or not, dead keys, autocorrect), which would make the
  same passphrase give different keys; and a passphrase typed with a Cyrillic
  layout should fail at once with a reason, not after a second of Argon2 as
  "wrong passphrase". The smaller alphabet is made up for by length: four
  random words are about 50 bits either way.
- **Normalizing what is invisible, refusing what is not.** Spaces of every kind
  and full-width forms look the same as their plain versions, so they are
  folded silently; an accented or foreign letter is visibly different, so it
  is refused with a message instead of being mapped to something else.
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
2. The passphrase is normalized (NFKC, spaces, trimmed ends) and must be plain
   Latin. Both are part of the key: changing either would lock everyone out, so
   they are permanent (a change would need a new slot version).
3. The derived key is non-extractable and only wraps and unwraps.

## Changing the settings

1. Raise `CURRENT_KDF_PARAMS`, keep `KDF_LIMITS` consistent, measure on a phone
   (`npm run dev -- --host --port 5180 --strictPort`, then
   `http://<computer's LAN address>:5180/design/kdf` on the phone).
2. Existing slots keep working: their settings are stored with them.
   `kdfNeedsUpgrade` reports a slot weaker than the current settings (less
   memory or fewer passes; stronger ones are left alone), and the app rewraps
   it with `changePassphrase` using the same passphrase.
3. Replacing a slot needs a sign-in from the last 10 minutes, so the upgrade
   runs only at an unlock within 10 minutes of a Google sign-in; otherwise it
   waits for the next one. There is deliberately no "same passphrase"
   exception: the server cannot tell a same-passphrase rewrap from a new
   passphrase set by a stolen session.

## Edge cases

- **The benchmark page works over plain HTTP on a phone** because it uses noble
  alone; the real screens need WebCrypto, which exists only on HTTPS or
  `localhost`.
- **Lowering the minimum** (`KDF_LIMITS`) would let a malicious server push
  weak settings for new slots; it should only ever go up.

## How it is tested

`tests/unit/crypto/kdf.test.ts` (RFC 9106 vector, noble against Node's native
Argon2id with the production settings, determinism, the typed forms of one
passphrase, refusal of non-Latin input before Argon2, non-extractable keys,
progress, refused settings) and `tests/e2e/encryption.spec.ts` (the production
settings in Chromium, Firefox and WebKit under the real CSP, opening keys made in
Node).

Last reviewed: 2026-11-06
