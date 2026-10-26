# tests/unit/

Fast tests for pure logic and for the encryption core, run by Vitest in Node.

## What is covered (and what is not)

Covered now:

- `scripts/license-policy.ts` — SPDX parsing (precedence, parentheses, `WITH`,
  malformed input), allowlist evaluation, runtime vs dev-only rules, exceptions.
- `src/ui/tokens.css` — both themes define every semantic color and data
  series, and every text/background pair meets WCAG AA (4.5:1 for text, 3:1 for
  field borders and focus). The test parses the CSS, so a token change that
  breaks contrast fails before anyone sees it.
- `src/crypto/` (`crypto/`) — the encryption core, which is the part of
  Keyworth that must not have bugs:
  - `kdf.test.ts`: noble's Argon2id against RFC 9106's test vector, and against
    Node's native (OpenSSL) Argon2id with the production settings; the same
    passphrase and salt give the same key, composed and decomposed accents give
    the same key, derived keys are non-extractable, progress reaches 1, and
    settings below OWASP's minimum or above the page limit are refused.
  - `key-slots.test.ts`: every flow — set up, unlock with the passphrase, the
    recovery key (however it is typed) and a remembered device; a wrong
    passphrase, another user's slot and a swapped slot kind all fail; changing
    the passphrase keeps the same data key; a replaced recovery key stops the
    old one; a forgotten passphrase can be reset; one test runs the production
    Argon2 settings end to end.
  - `envelope.test.ts`: records decrypt back to the same value; no plaintext in
    the envelope; 200 encryptions draw 200 different IVs; a record moved to
    another id, kind or user, a flipped bit in the ciphertext, IV or tag, or
    another user's key all fail; size buckets hide lengths; oversized records
    are refused.
  - `recovery-key.test.ts`: format, alphabet, round trips, sloppy typing,
    malformed input.
- `shared/schemas/` (`schemas.test.ts`) — accepted and rejected envelopes,
  Argon2 settings and record kinds.

Planned: `shared/metrics` (positions, average cost, P&L, splits, transfers, time
zones, tiny quantities without precision loss) and `shared/money`. These are the
numbers users see, so they get the most cases.

Not here: anything that needs workerd (see [`integration/`](../integration/README.md))
or a real browser engine. Node 24 implements WebCrypto with the browsers' API,
so the crypto core runs here; that it also works in Chromium, Firefox and WebKit,
under the production CSP, is checked by `tests/e2e/kdf-benchmark.spec.ts`.

## How to run

```sh
npx vitest run --project unit    # once, about 10 seconds (Argon2 dominates)
npx vitest --project unit        # watch mode
```

No network or services needed.

## Approach

- Table-driven tests (`it.each`) for rules with many inputs, so a new edge case is
  one line.
- Inputs are small inline fixtures, not real lockfiles or recorded data, so each
  test shows exactly what it checks.
- Functions under test take their dependencies as parameters (for example, the
  exceptions map, or the Argon2 settings) instead of reading globals, which
  keeps them pure.
- **Crypto flow tests use OWASP's minimum Argon2 settings** (`FAST_KDF` in
  `crypto/fixtures.ts`): the cheapest the code accepts, so each derivation takes
  about 0.1 s instead of 0.6 s. The production settings are exercised by two
  dedicated tests with a longer timeout.
- Keys, IVs and recovery keys are random in every run; tests assert properties
  (it decrypts, it fails, it differs), never specific random values.

## Adding a test

```ts
import { describe, expect, it } from "vitest";
import { isSatisfiedBy } from "../../scripts/license-policy.ts";

describe("isSatisfiedBy", () => {
  it("accepts a dual license when one side is allowed", () => {
    expect(isSatisfiedBy("(MIT OR GPL-3.0-only)", ["MIT"])).toBe(true);
  });
});
```

Name files `*.test.ts`; imports use explicit `.ts` extensions.

## Pitfalls

- Keep these tests free of time and the network; pass such values in as
  parameters.
- This project's TypeScript config includes the DOM library because
  `src/crypto` is browser code (`CryptoKey`, `KeyUsage`) tested under Node. Do
  not use other DOM APIs here (`document`, `IndexedDB`): Node does not have them.
- Argon2 with production settings takes about 0.6 s per derivation in Node and
  more on a CI runner. Use `FAST_KDF` unless the test is about the production
  settings themselves, and give such tests an explicit timeout.
