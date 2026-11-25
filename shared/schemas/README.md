# shared/schemas/

## Purpose

zod schemas for data that crosses the network, shared by the browser and the
Worker so both sides agree on exactly one definition: the encrypted envelope,
the Argon2id settings stored with a passphrase slot, and the kinds of vault
records. It also defines the plaintext of each record kind (transactions, settings, chats),
which only the browser uses, after decryption. Binary values
(IVs, salts, wrapped keys, ciphertexts) travel as unpadded base64url with exact
lengths, so a malformed value is rejected before anything decodes it.

## How it works

| File              | Role                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zod.ts`          | Configures zod (jitless) and re-exports `z`; every schema imports it                                                                                |
| `base64url.ts`    | Unpadded base64url: the codec (one canonical spelling per byte string) and an exact-length schema helper                                            |
| `envelope.ts`     | `envelopeSchema`: `{ v: 1, alg: "A256GCM", iv, ct }` and its exact sizes                                                                            |
| `keys.ts`         | Argon2id settings and their limits; the passphrase, recovery and device slots; the setup body of `/api/keys`                                        |
| `vault.ts`        | Record kinds and ids, per-user limits, the bodies of `PUT /api/vault/:id`, `POST /api/vault/batch`, `/delete` (and what each delete group may take) |
| `me.ts`           | What `GET /api/me` returns: the user and `freshForSeconds` (a type only: the browser trusts its own server)                                         |
| `market.ts`       | Asset ids (`crypto:` and CoinGecko's id), limits, the shapes `/api/market` and `/api/assets` return                                                 |
| `text.ts`         | Free text: `typedText` (a field's filter), `cleanText` (what is kept), `plainTextSchema`, hidden characters                                         |
| `currencies.ts`   | The 161 fiat currencies with a central bank's rate; a price currency is one of them, USDT or USDC                                                   |
| `transaction.ts`  | The plaintext inside a `transaction` record, by type; amounts as strings of plain digits; loose                                                     |
| `chat.ts`         | `POST /api/chat/completions`: limits, the question's rules, the OpenAI-format messages; the refusals' shape                                         |
| `chat-tools.ts`   | The chat's tools as the model sees them: names, descriptions, input schemas; `includeAmounts` for amounts                                           |
| `conversation.ts` | The plaintext inside a `conversation` record: a kept chat in the menu's list; in the first load, so a file of its own                               |
| `chat-history.ts` | The plaintext inside a `message` record: every message of a kept chat, without what the tools returned                                              |
| `settings.ts`     | The plaintext inside a `settings` record (base currency); loose, so newer fields survive an older tab's save                                        |

The envelope schema accepts only what `src/crypto/envelope.ts` can produce: a
12-byte IV and a ciphertext whose length is one padding bucket (256 bytes to
64 KiB, powers of two) plus the 16-byte GCM tag, all in unpadded base64url. The
server can therefore reject garbage or oversized bodies without understanding
the content.

## Why this way

- **One definition, two runtimes.** A schema that differs between the browser
  and the Worker is a bug waiting to happen; importing the same file rules it
  out.
- **zod in jitless mode.** zod compiles fast object parsers with `new Function`
  and, before that, probes whether eval works. Under the strict CSP and Trusted
  Types the probe fails (zod catches it), but the browser still reports a
  policy violation, which the e2e suite treats as a failure. Workers forbid eval
  as well. Jitless parsing is fast enough for our sizes.
- **Strict objects.** Unknown fields are rejected, not stripped: an envelope
  with an extra plaintext field is an error, not something to quietly drop.
  The exception is the plaintext inside `settings` and `transaction` records: it
  is loose, because an older tab that saves one field must keep the fields a
  newer version added. A kept chat's records are strict and carry a version
  instead: the browser writes them whole, so a new shape is a new `v`.

## Pitfalls & gotchas

- **Import `z` from `./zod.ts`, never from `"zod"`.** ESLint enforces it; a
  direct import could run before jitless mode is set.
- **These files are compiled for both the browser and the Worker**, so they use
  only standard JavaScript: no DOM, no Node, no Workers APIs.
- **Changing a schema can strand stored data.** A stored envelope that no
  longer validates cannot be read. Add a new version instead of tightening the
  old one.

## How to work with it

```ts
import { envelopeSchema } from "../../shared/schemas/envelope.ts";

const parsed = envelopeSchema.safeParse(body);
if (!parsed.success) return c.json({ error: "invalid_envelope" }, 400);
```

Tests: `tests/unit/schemas.test.ts` (accepted and rejected inputs for each schema).

## Related

- [docs/input-validation.md](docs/input-validation.md): the rules for every input, the attacks they stop, the
  checklist for a new field
- [src/crypto/docs/envelopes.md](../../src/crypto/docs/envelopes.md): what the envelope schema enforces and why
- [worker/routes/docs/api-guards.md](../../worker/routes/docs/api-guards.md): how the Worker uses these schemas
- [src/crypto/](../../src/crypto/README.md): produces and consumes these shapes
- [worker/routes/](../../worker/routes/README.md): validates request bodies with them
