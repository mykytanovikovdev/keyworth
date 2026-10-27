# Encryption core tests

What the unit tests of `src/crypto` and `shared/schemas` prove, and how to
extend them. They run in Node 24, whose WebCrypto has the same API as browsers;
that the same code works in Chromium, Firefox and WebKit is shown by
`tests/e2e/kdf-benchmark.spec.ts`.

## What is proven

**Argon2id is computed correctly** (`crypto/kdf.test.ts`)

- `@noble/hashes` reproduces RFC 9106's Argon2id test vector (with secret and
  associated data).
- noble and Node's native Argon2id (OpenSSL, `crypto.argon2Sync`) produce the
  same bytes with the **production settings** (64 MiB, 3 passes, 1 lane). This
  matters because noble's Argon2 module was outside its library's audit.
- The same passphrase and salt give the same key; another passphrase or salt
  gives a different one; the forms one passphrase can be typed in (no-break and
  ideographic spaces, tabs, full-width letters, spaces at the ends) give the
  same key, while case and inner spaces count; accented, Spanish and Cyrillic
  letters, look-alikes, emoji and invisible characters are refused with
  `not-latin` before Argon2 runs; derived keys are non-extractable and only
  wrap and unwrap; progress reaches 1; settings below OWASP's minimum, above
  the page's limits or fractional are refused; a salt that is not 16 bytes is
  refused.

**The passphrase policy holds exactly** (`crypto/passphrase.test.ts`)

- 11 characters are too short, 12 and 1,024 pass, 1,025 is too long; every
  printable ASCII character is accepted; accents, Spanish, German and Cyrillic
  letters, a Cyrillic look-alike, an emoji and an invisible character are
  `not-latin` (reported before `too-short`); spaces at the ends do not count.
- Normalization folds every kind of space and full-width forms, trims the
  ends, and keeps case, inner runs of spaces and punctuation.

**Key flows keep the data key safe** (`crypto/key-slots.test.ts`)

- Setup returns a non-extractable data key; slots carry the settings, fresh
  salts, 12-byte IVs and 48-byte wrapped keys; the recovery key has eight groups
  of four.
- Setup, changing the passphrase and resetting it all refuse a new passphrase
  that is too short, only spaces (`invalid-input`) or not plain Latin
  (`not-latin`).
- One test runs the production Argon2 settings end to end (setup and unlock).
- Unlock with the passphrase, the recovery key (however typed) and a remembered
  device opens the **same** data key (it decrypts what the original encrypted).
- Refused with `wrong-secret`: a wrong passphrase, another user's slot with the
  right passphrase, a recovery wrapping passed off as a passphrase wrapping,
  another valid-looking recovery key, another device's key, another user's
  device slot. Refused with `invalid-input`: stored settings below OWASP's
  minimum, text that cannot be a recovery key.
- Changing the passphrase keeps the data key (no record re-encrypted) and the
  old passphrase stops working; it needs the current passphrase; it can upgrade
  Argon2 settings with the same passphrase; progress is one run across both
  derivations.
- A replaced recovery key works and the old one does not open the new slot; a
  forgotten passphrase is reset with the recovery key.

**Records are bound and opaque** (`crypto/envelope.test.ts`)

- Round trip; a valid envelope with none of the plaintext in it; 200
  encryptions give 200 different IVs and ciphertexts.
- Refused with `tampered`: another user's data key, a record moved to another
  id, kind or user, one flipped bit in the ciphertext, the IV or the tag.
  Refused with `invalid-input`: another envelope version or algorithm, extra
  fields, malformed references that would make an ambiguous AAD.
- Padding: short records all land in the 256-byte bucket (272 bytes with the
  tag), buckets grow by powers of two, oversized records are refused, the
  largest allowed record survives intact.

**Recovery keys and serialization** (`crypto/recovery-key.test.ts`,
`crypto/serialize.test.ts`): 160 bits as 32 characters without I, L, O or U;
known bytes encode the same way; round trips; sloppy typing is accepted;
malformed text is refused. Slots survive the JSON round trip byte for byte;
malformed slots (lengths, Argon2 settings out of range, extra fields) are
refused; base64url round-trips every byte value and rejects malformed text.

**Schemas** (`schemas.test.ts`): accepted and rejected envelopes (versions,
algorithms, IV length, every padding bucket up to 64 KiB and nothing larger,
base64url alphabet, extra fields), Argon2 settings and record kinds.

## Deliberately not here

Storage, sessions and isolation (integration tests), the browser engines and the
CSP (e2e), timing on real devices (the `/design/kdf` page).

## Approach

- Flow tests use `FAST_KDF` (OWASP's minimum, the cheapest settings the code
  accepts) from `crypto/fixtures.ts`: about 0.1 s per derivation instead of 0.6
  s. The production settings get dedicated tests with a 30-second timeout.
- Keys, IVs and recovery keys are random in every run; tests assert properties
  (it decrypts, it fails with this code, it differs), never random values.
- "Opens the same data key" is proven by decrypting with one key what the other
  encrypted, since a non-extractable key cannot be compared directly.

## Adding a case

```ts
it("refuses a slot whose IV was changed", async () => {
  const { passphraseSlot } = await setUp();
  const iv = passphraseSlot.iv.slice();
  iv[0] = (iv[0] ?? 0) ^ 1;

  await expect(
    unlockWithPassphrase({
      userId: ALICE,
      slot: { ...passphraseSlot, iv },
      passphrase: PASSPHRASE,
    }),
  ).rejects.toMatchObject({ code: "wrong-secret" });
});
```

Last reviewed: 2026-10-27
