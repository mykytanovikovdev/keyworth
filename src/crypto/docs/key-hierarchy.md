# Keys, wrapped keys and key flows

How a user's data key is created, protected and opened. Code: `keys.ts`,
`key-slots.ts`, `kdf.ts`, `recovery-key.ts`, `serialize.ts`.

## The hierarchy

```
passphrase ──normalize──Argon2id──► passphrase KEK ─┐
recovery key ─────HKDF-SHA-256► recovery KEK ─┼─ each wraps (AES-GCM) ─► data key (DEK) ─► encrypts every record
device key (IndexedDB, random) ───────────────┘                          random AES-256-GCM
```

- **Data key (DEK):** a random AES-256-GCM key made by WebCrypto
  (`generateDataKey`) at setup. One DEK per user encrypts all of that user's
  records. The copy the app works with is a **non-extractable** `CryptoKey`,
  only in memory.
- **Key-encryption keys (KEKs)** only wrap and unwrap the DEK (usages
  `wrapKey`, `unwrapKey`), and are never stored:
  - **passphrase KEK:** Argon2id over the normalized, plain-Latin passphrase with a
    random 16-byte salt per slot (see [argon2.md](argon2.md));
  - **recovery KEK:** HKDF-SHA-256 over the 160-bit recovery key, a random
    16-byte salt per slot, `info = "keyworth/recovery-kek/v1"`. A slow
    function would add nothing to a key with 160 bits of entropy;
  - **device KEK:** a random non-extractable AES-256-GCM key kept in the
    browser's IndexedDB ([remember-device.md](remember-device.md)).
- **Slots:** the DEK wrapped by each KEK, the only form in which the server
  sees it. A slot is `{ iv, wrappedKey }` (12-byte IV; 32 key bytes plus the
  16-byte GCM tag), plus the salt and, for the passphrase, the Argon2 settings.

## Wrapping

AES-GCM `wrapKey("raw", …)` with a fresh random 96-bit IV and additional
authenticated data naming the owner and the slot:

| Slot       | AAD                                 |
| ---------- | ----------------------------------- |
| passphrase | `key-slot\|<userId>\|passphrase\|1` |
| recovery   | `key-slot\|<userId>\|recovery\|1`   |
| device     | `device\|<userId>\|1`               |

## The check value

At setup the browser also makes a **check value**: AES-GCM with the DEK, a
fresh IV, an empty plaintext and the AAD `key-check|<userId>|1`, which leaves
only the 16-byte tag. It is stored with the slots (`user_key_checks`).
`verifyKeyCheck` confirms that a DEK belongs to this account before anything is
encrypted with it: after an unlock, and when another tab hands a key over
(where a tab of another account could otherwise answer). A wrong key fails with
`wrong-secret`. The tag reveals nothing about the DEK.

## Failures

A wrong passphrase, a slot copied from another user and a recovery wrapping
passed off as a passphrase wrapping all fail the same way: the GCM tag does not
verify, and the flow throws `CryptoError` with code `wrong-secret`. The user id
is validated (`^[A-Za-z0-9_-]{1,64}$`) before it goes into an AAD.

## The recovery key

160 random bits written as 32 characters of Crockford's Base32, followed by a
four-character check group: nine groups of four (`XXXX-XXXX-…-CCCC`). The
alphabet leaves out I, L, O and U. The check group is the first 20 bits of
SHA-256 over the label `keyworth/recovery-check/v1` and the key; it is not a
secret and only catches typing mistakes.

Parsing (`parseRecoveryKey`) accepts what people type or paste: any case, spaces
or no dashes, any kind of dash, a minus sign or a soft hyphen, full-width forms,
and maps O to 0 and I/L to 1. Before any cryptography it refuses:

- characters other than plain Latin with `not-latin` (a Cyrillic "С" typed for a
  "C" with another keyboard layout on; the same plain-Latin rule as passphrases);
- text that is not 36 characters of the alphabet with `invalid-input`;
- a check group that does not match with `mistyped`: a typo, which the screen
  can name as such instead of "wrong key".

A well-formed key that belongs to another account fails with `wrong-secret`. The
key is shown once and never stored or sent anywhere; the user can issue a new
one in Settings.

## Flows (`key-slots.ts`)

| Function                | Needs                                       | Returns                                                       |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `createKeys`            | passphrase                                  | DEK, both slots, check value, recovery key (shown once)       |
| `unlockWithPassphrase`  | passphrase slot, passphrase                 | DEK; with `remember`, also a device key and device slot       |
| `unlockWithDevice`      | device key, device slot                     | DEK                                                           |
| `unlockWithRecoveryKey` | recovery slot, recovery key                 | DEK                                                           |
| `changePassphrase`      | slot, current and new passphrase            | a new passphrase slot (also how Argon2 settings are upgraded) |
| `replaceRecoveryKey`    | passphrase slot, passphrase                 | a new recovery slot and recovery key                          |
| `resetPassphrase`       | recovery slot, recovery key, new passphrase | DEK and a new passphrase slot                                 |

**The extractable step.** WebCrypto can wrap only an extractable key, and the
working DEK is not extractable. So every flow that creates a new wrapping first
unwraps the DEK once more as extractable, wraps it, and drops that copy. This
is why changing the passphrase or the recovery key asks for the current
passphrase, and why "Remember this device" is offered only at unlock.

**Server storage.** Slots and the check value travel as JSON with base64url
fields (`serialize.ts`) to `/api/keys`, and are validated against
`shared/schemas/keys.ts` on both sides (exact byte lengths, Argon2 settings
within limits, format version `v: 1`).

- **Setup** stores the check value and both slots in one transaction: all three
  or none.
- **Replacing a slot** names the slot it replaces by its IV (`expectedIv`). If
  the stored slot has another IV (another tab or device replaced it first) the
  server answers 409 with the stored IV, so nobody is left holding a recovery
  key that no longer opens anything. A retry after a lost answer is safe too:
  a 409 naming the IV the browser just sent means its write went through.
- **The browser shows a new recovery key only after the server has stored its
  slot** (a 2xx, or a 409 naming the new slot's IV); a key whose slot was not
  stored would be worthless.
- Replacing needs a sign-in from the last 10 minutes
  ([worker/routes/docs/api-guards.md](../../../worker/routes/docs/api-guards.md)).

## Invariants

1. The working DEK is non-extractable; an extractable copy exists only inside a
   flow, between an unwrap and the wrap that needs it.
2. Every wrap uses a fresh random IV and the AAD of its slot kind and owner.
3. A DEK is used only after its check value verified, except right after
   `createKeys` made both.
4. KEKs are non-extractable and never leave the function that derives them.
5. The passphrase and the recovery key are never stored or sent; derived bytes
   are zeroed after use (best effort: JavaScript cannot guarantee it).

## Decisions and alternatives

- **One DEK, several wrappings:** a new passphrase rewraps one key in a moment;
  no record is re-encrypted.
- **AES-GCM wrapping, not AES-KW:** AES-KW (RFC 3394) has no AAD, so a wrapped
  key could not be bound to its owner and slot kind.
- **A recovery key, not recovery questions or operator escrow:** if the operator
  could recover data, so could anyone who breaks into the operator.
- **No confirmation by retyping the recovery key:** the owner's decision; the
  screen warns once and offers Download, Copy and Print.
- **Passkeys (WebAuthn PRF)** as a third wrapping: backlog; the slot table
  allows another kind.
- **Rotating the DEK itself** (re-encrypting everything) is not implemented.
  Changing the passphrase or the recovery key keeps the DEK, so it does not
  lock out someone who already has the old secret and a copy of its wrapped
  key ([threat-model.md](threat-model.md)).

## Edge cases

- **Upgrading Argon2 settings** rewraps the passphrase slot with the same
  passphrase, which the server accepts only with a recent sign-in, so it runs
  at an unlock within 10 minutes of a Google sign-in
  ([argon2.md](argon2.md)).
- **A forgotten passphrase** is reset with the recovery key: the recovery slot
  opens the DEK, a new passphrase wraps it, and the recovery key keeps working.
- **Both secrets lost:** nothing can open the DEK; the data is gone.

## How it is tested

`tests/unit/crypto/key-slots.test.ts`, `serialize.test.ts`,
`recovery-key.test.ts` and `tests/integration/keys.test.ts`; see
[tests/unit/docs/crypto-tests.md](../../../tests/unit/docs/crypto-tests.md)
and
[tests/integration/docs/storage-and-isolation.md](../../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

- Never change an AAD string in place: existing slots would stop opening. Add
  a new version and keep accepting the old one.
- Never change passphrase normalization or the plain-Latin rule: everyone
  would be locked out.
- A new slot kind needs a new AAD, a schema in `shared/schemas/keys.ts`, a
  migration (the `key_slot_kind` check) and tests for swapping it with the
  existing kinds.

Last reviewed: 2026-10-31
