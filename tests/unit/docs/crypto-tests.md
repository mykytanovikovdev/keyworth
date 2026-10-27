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
  salts, 12-byte IVs and 48-byte wrapped keys; the recovery key has nine groups
  of four, the last a check group.
- Setup returns a check value that the data key passes, as does the key
  opened again by unlocking; another data key or another user's id fails it
  with `wrong-secret`.
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
  id, kind, user or revision, one flipped bit in the ciphertext, the IV or the
  tag, authenticated content that is not JSON (checked against a literal AAD
  string, so the AAD format itself is pinned). Refused with `invalid-input`:
  another envelope version or algorithm, extra fields, malformed references
  that would make an ambiguous AAD (including revisions 0, 1.5 and 2³¹), values
  JSON cannot hold (`undefined`, a function, a symbol).
- Padding: short records all land in the 256-byte bucket (272 bytes with the
  tag), buckets grow by powers of two, oversized records are refused, the
  largest allowed record survives intact.

**Recovery keys and serialization** (`crypto/recovery-key.test.ts`,
`crypto/serialize.test.ts`): 160 bits as 32 characters without I, L, O or U,
every bit used (across 64 keys each of the 160 bits takes both values), and a
check group that matches one computed independently with Node's SHA-256; three
fixed byte strings encode to fixed texts and back, so keys people wrote down
keep working; round trips; sloppy typing (case, spaces, look-alikes) and pasting
(every kind of dash, a minus sign, a soft hyphen, full-width forms) are
accepted; one changed character, two swapped ones and a wrong check group are
`mistyped`; a Cyrillic look-alike or an accented letter is `not-latin`;
malformed text (too short, no check group, too long, U, punctuation, empty) is
`invalid-input`. Slots and the check value survive the JSON round trip byte for
byte and carry format version 1; malformed slots (lengths, Argon2 settings out
of range, extra fields, another version) are refused; base64url round-trips
every byte value, rejects malformed text and accepts only the one canonical
spelling of each byte string (unused trailing bits must be zero).

**Data written today stays readable** (`crypto/compatibility.test.ts`)

- Fixed ("golden") vectors made once with `node:crypto` alone, from the formats
  in `src/crypto/docs` and never from this code: a record (with Cyrillic text,
  whose "р" is the padding marker's byte), a passphrase slot with non-minimum
  settings opened by the passphrase as typed (a no-break space, spaces at the
  ends), a recovery slot opened by its written key, a device slot and a check
  value. A change to an AAD, the HKDF label, the Argon2 inputs, the padding,
  the recovery-key text or passphrase normalization fails here, even though
  encryption and decryption would still agree with each other.
- The other direction: what `src/crypto` writes (a record, a passphrase slot, a
  check value) is opened by `node:crypto` with literal AAD strings.
- **Never regenerate these vectors to make a test pass.** A format change needs
  a new version that keeps reading the old one.

**Properties a mutation could break unnoticed** (`crypto/hardening.test.ts`):
the data key is non-extractable AES-256 on every path that returns one; every
key-encryption key is AES-256, non-extractable, wrap and unwrap only; the slot
kind is bound by the AAD even under one key-encryption key; all AADs differ
and refuse ambiguous user ids; every wrapping gets a new IV; only an
authentication failure becomes `wrong-secret`; salts are fresh; padding keeps
the 0x80 byte inside UTF-8 text, fills exact power-of-two boundaries and
refuses a missing marker; the production Argon2 settings and `KDF_LIMITS` equal
their literal values (so tests cannot follow a weakened constant); malformed
recovery and device slots and request bodies are refused.

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
