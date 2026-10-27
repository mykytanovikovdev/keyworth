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

1. `JSON.stringify(value)`, then UTF-8. A value with no JSON form (`undefined`,
   a function, a symbol) is refused with `invalid-input` instead of storing an
   empty record that would never decrypt.
2. **Padding** (`padding.ts`): append a `0x80` byte and zeros up to the next
   power of two, at least 256 and at most 65,536 bytes. Longer plaintext
   (≥ 65,536 bytes) is refused with `invalid-input`.
3. AES-256-GCM with the DEK, a fresh random 96-bit IV, and the AAD
   `record|<userId>|<kind>|<recordId>|<revision>|1`.

Decryption (`decryptRecord`) validates the envelope against the schema, decrypts
(a failed tag throws `tampered`), removes the padding (malformed padding throws
`tampered`), decodes strict UTF-8 and parses JSON (content that is not UTF-8 or
not JSON also throws `tampered`, never a raw `TypeError` or `SyntaxError`). The
caller then validates the value against the schema of its kind.

## The AAD

- `userId`: the session's user (checked against `^[A-Za-z0-9_-]{1,64}$`;
  Better Auth's ids are 32 letters and digits);
- `kind`: one of `settings`, `transaction`, `conversation`, `message`, `alert`
  (`shared/schemas/vault.ts`);
- `recordId`: a lower-case UUID version 4, made by the browser
  (`crypto.randomUUID()`) **before** encryption, because it is part of the AAD;
- `revision`: the revision the record has once this ciphertext is stored. The
  server stores every write with the revision after the one sent (1 for a new
  record), so the browser encrypts for `sent + 1` and decrypts with the
  revision the server returns;
- `1`: the AAD format version.

No field can contain `|`, so the joined string is unambiguous. A record moved
to another user, kind, id or revision does not decrypt. The revision matters
against replay: an old version saved earlier (through a stolen session, say)
and written back over a newer one is stored with the next revision, which its
ciphertext was not made for, so it fails as `tampered` instead of silently
bringing old data back. On the server the primary key is
`(user_id, id)`, so two users' ids never clash.

## What the server validates

`envelopeSchema` accepts only what `encryptRecord` can produce: `v` 1, `alg`
`A256GCM`, a 16-character IV (12 bytes) and a ciphertext whose base64url length
equals one padding bucket plus the 16-byte tag (272 bytes up to 65,552 bytes),
and no extra fields. Garbage, oversized or plaintext-carrying bodies are refused
before anything is stored.

## Invariants

1. A fresh random IV for every encryption; no code path accepts an IV as input.
2. The AAD always names the owner, kind, id and revision of the record.
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
- **The revision in the AAD**, added before the first record was stored: it
  costs nothing (every write is a new encryption anyway) and turns replay by
  anyone who can write but not read into a detectable error.
- **The AAD as a `|`-joined string with strict validation** rather than a
  length-prefixed encoding: every field has a fixed character set, so it is
  unambiguous and easy to read.

## Edge cases

- **Version upgrades:** a future envelope version must be added alongside
  version 1, never in place of it, or stored records become unreadable.
- **Rollback by the server** is still possible: the server can return an older
  envelope together with its older revision, and the AAD matches. Only the
  server's own answers can do that, not a client writing through the API; see
  the [threat model](threat-model.md).
- **A deleted record written back** is stored again with revision 1, so its
  first version (and only that one) decrypts again. Record ids are never
  reused, so the interface treats an id it deleted as gone.
- **Large chat histories** will need splitting into several records before they
  reach the 64 KiB bucket limit.

## How it is tested

`tests/unit/crypto/envelope.test.ts` (round trip, no plaintext in the envelope,
200 distinct IVs, records moved to another user, kind, id or revision, flipped
bits in the ciphertext, IV and tag, other users' keys, values JSON cannot hold,
authenticated content that is not JSON, size buckets, limits),
`tests/unit/schemas.test.ts` and `tests/integration/vault.test.ts` (no plaintext
anywhere in the database, copied envelopes do not decrypt for another user, an
old version written back over a newer one does not decrypt).

## How to change it safely

Changing the padding, the AAD or the envelope fields changes what existing
records need to decrypt: add a version, keep reading the old one, and extend the
schema and the tests for both.

Last reviewed: 2026-10-27
