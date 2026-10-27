# shared/schemas/

## Purpose

zod schemas for data that crosses the network, shared by the browser and the
Worker so both sides agree on exactly one definition: the encrypted envelope,
the Argon2id settings stored with a passphrase slot, and the kinds of vault
records. Later phases add the plaintext schemas of each record kind (trades,
settings…), which only the browser uses, after decryption. Binary values
(IVs, salts, wrapped keys, ciphertexts) travel as unpadded base64url with exact
lengths, so a malformed value is rejected before anything decodes it.

## How it works

| File           | Role                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `zod.ts`       | Configures zod (jitless) and re-exports `z`; every schema imports it                                         |
| `base64url.ts` | Unpadded base64url: the codec and an exact-length schema helper                                              |
| `envelope.ts`  | `envelopeSchema`: `{ v: 1, alg: "A256GCM", iv, ct }` and its exact sizes                                     |
| `keys.ts`      | Argon2id settings and their limits; the passphrase, recovery and device slots; the setup body of `/api/keys` |
| `vault.ts`     | Record kinds and ids, per-user limits, the body of `PUT /api/vault/:id`                                      |

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

- [src/crypto/](../../src/crypto/README.md): produces and consumes these shapes
- [worker/routes/](../../worker/routes/README.md): validates request bodies with them
