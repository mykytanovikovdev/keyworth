# Record envelopes

How a record (a JSON value) becomes ciphertext the server can store but not
read. Code: `envelope.ts`, `padding.ts`, `keys.ts` (`recordAad`); schema:
`shared/schemas/envelope.ts`.

## Format

```json
{
  "v": 1,
  "alg": "A256GCM",
  "iv": "<12 bytes, unpadded base64url>",
  "ct": "<padded plaintext encrypted with AES-256-GCM, plus the 16-byte tag>"
}
```

On the server the envelope is stored as columns of `vault_records`
(`envelope_version`, `iv bytea`, `ciphertext bytea`), next to the plaintext
`kind`, `revision` and dates.

## Encryption (`encryptRecord`)

1. `JSON.stringify(value)`, then UTF-8.
2. **Padding** (`padding.ts`): append a `0x80` byte and zeros up to the next
   power of two, at least 256 and at most 65,536 bytes. Longer plaintext
   (≥ 65,536 bytes) is refused with `invalid-input`.
3. AES-256-GCM with the DEK, a fresh random 96-bit IV, and the AAD
   `record|<userId>|<kind>|<recordId>|1`.

Decryption (`decryptRecord`) validates the envelope against the schema, decrypts
(a failed tag throws `tampered`), removes the padding (malformed padding throws
`tampered`), decodes strict UTF-8 and parses JSON. The caller then validates the
value against the schema of its kind.

## The AAD

- `userId`: the session's user (letters and digits; checked against
  `^[A-Za-z0-9_-]{1,64}$`);
- `kind`: one of `settings`, `transaction`, `conversation`, `message`, `alert`
  (`shared/schemas/vault.ts`);
- `recordId`: a lower-case UUID version 4, made by the browser
  (`crypto.randomUUID()`) **before** encryption, because it is part of the AAD;
- `1`: the AAD format version.

No field can contain `|`, so the joined string is unambiguous. A record moved
to another user, kind or id does not decrypt. On the server the primary key is
`(user_id, id)`, so two users' ids never clash.

## What the server validates

`envelopeSchema` accepts only what `encryptRecord` can produce: `v` 1, `alg`
`A256GCM`, a 16-character IV (12 bytes) and a ciphertext whose base64url length
equals one padding bucket plus the 16-byte tag (272 bytes up to 65,552 bytes),
and no extra fields. Garbage, oversized or plaintext-carrying bodies are refused
before anything is stored.

## Invariants

1. A fresh random IV for every encryption; no code path accepts an IV as input.
2. The AAD always names the owner, kind and id of the record.
3. Padding is checked only after AES-GCM has authenticated the whole block, so
   it cannot act as a padding oracle.
4. The server never receives plaintext; every stored ciphertext is a padding
   bucket plus the tag.

## Decisions and alternatives

- **Random IVs, no counter:** with random 96-bit IVs one key stays safe for up
  to 2^32 encryptions (NIST SP 800-38D), far beyond a portfolio, and there is no
  counter state to lose or repeat across devices.
- **Size buckets (powers of two):** cheap, and they hide the most telling
  metadata of a small record — the length of a note. Wasting up to half of a
  large record's space is acceptable at this scale.
- **Columns instead of a JSON blob:** exact byte sizes for limits and checks;
  base64url only on the wire.
- **The AAD as a `|`-joined string with strict validation** rather than a
  length-prefixed encoding: every field has a fixed character set, so it is
  unambiguous and easy to read.

## Edge cases

- **Version upgrades:** a future envelope version must be added alongside
  version 1, never in place of it, or stored records become unreadable.
- **Rollback:** the server can return an older envelope of the same record (the
  AAD still matches); see the [threat model](threat-model.md).
- **Large chat histories** will need splitting into several records before they
  reach the 64 KiB bucket limit.

## How it is tested

`tests/unit/crypto/envelope.test.ts` (round trip, no plaintext in the envelope,
200 distinct IVs, moved records, flipped bits in the ciphertext, IV and tag,
other users' keys, size buckets, limits), `tests/unit/schemas.test.ts` and
`tests/integration/vault.test.ts` (no plaintext anywhere in the database,
copied envelopes do not decrypt for another user).

## How to change it safely

Changing the padding, the AAD or the envelope fields changes what existing
records need to decrypt: add a version, keep reading the old one, and extend the
schema and the tests for both.

Last reviewed: 2026-10-27
