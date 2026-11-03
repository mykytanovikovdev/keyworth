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
- `src/crypto/` (`crypto/`) — the encryption core: Argon2id against RFC 9106
  and against Node's native implementation with the production settings, every
  key flow and every way it must fail, bound and padded envelopes, recovery
  keys and slot serialization. What each file proves:
  [docs/crypto-tests.md](docs/crypto-tests.md).
- `src/ui/motion.ts` (`ui/`) — duration tokens read in milliseconds whether
  written as `240ms` or, as the production CSS minifier writes them, `.24s`.
- `shared/schemas/` (`schemas.test.ts`) — accepted and rejected envelopes,
  Argon2 settings and record kinds.
- `src/vault/` (`vault/`) — the key's states and flows against a fake server
  with the real API's rules, several tabs on real BroadcastChannels (handing
  the key over, Lock everywhere, refusing stale or foreign keys), "Remember
  this device", the idle lock, replacing keys after a lost answer or a
  conflict, records with revisions. What each file proves:
  [docs/vault-tests.md](docs/vault-tests.md).

Planned: `shared/metrics` (positions, average cost, P&L, splits, transfers, time
zones, tiny quantities without precision loss) and `shared/money`. These are the
numbers users see, so they get the most cases.

Not here: anything that needs workerd (see [`integration/`](../integration/README.md))
or a real browser engine. Node 24 implements WebCrypto with the browsers' API,
so the crypto core runs here; that it also works in Chromium, Firefox and WebKit,
under the production CSP, is checked by `tests/e2e/kdf-benchmark.spec.ts`.

## How to run

```sh
npx vitest run --project unit    # once, about 15 seconds (Argon2 dominates)
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
