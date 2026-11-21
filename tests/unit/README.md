# tests/unit/

Fast tests for pure logic and for the encryption core, run by Vitest in Node.

## What is covered (and what is not)

Covered now:

- `scripts/license-policy.ts` — SPDX parsing (precedence, parentheses, `WITH`,
  malformed input), allowlist evaluation, runtime vs dev-only rules, exceptions.
- `scripts/docs-policy.ts`, `mutation-plan.ts`, `bundle-map.ts`,
  `perf-report.ts` — the project tooling's rules: broken links, review dates
  and forbidden content in docs; a mutation plan's validation and its
  exact-once replacement; source map decoding and per-package sizes; splitting
  `wrangler tail`'s output, grouping requests by route (ids as `:id`) and
  keeping nothing but timings, location and placement.
- `tests/unit/chat/` — the chat's cost read from the tail of a model's
  stream (`worker/chat/usage.ts`), and the browser's model client
  (`@ai-sdk/openai-compatible`) reading streams recorded from Workers AI, as
  the server passes them on: an answer, its usage, a tool call. The browser's
  tools on made-up data, and what they keep back: no amount without
  `includeAmounts`, never a note
  ([src/features/chat/docs/tools-and-minimization.md](../../src/features/chat/docs/tools-and-minimization.md));
  which messages go to the model within the server's limit.
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
- `src/features/unlock/key-progress.ts` (`unlock/`) — Argon2's readings reach
  the ring's one listener; the ring's pace closes it as a fast derivation ends,
  crawls on a slow device, waits when ahead, and never exceeds its limit.
- `shared/schemas/` (`schemas.test.ts`) — accepted and rejected envelopes,
  Argon2 settings, record kinds, transactions by type and the currencies.
- `src/vault/` (`vault/`) — the key's states and flows against a fake server
  with the real API's rules, several tabs on real BroadcastChannels (handing
  the key over, Lock everywhere, refusing stale or foreign keys), "Remember
  this device", the idle lock, replacing keys after a lost answer or a
  conflict, records with revisions. What each file proves:
  [docs/vault-tests.md](docs/vault-tests.md).

- **Portfolio:** `src/features/portfolio` (`portfolio/`) — `summarize()`
  with numbers worked out by hand: profit sold and still held with income
  apart, the period's chart and gain, a coin without a price listed but left
  out of every figure, a dash rather than zero without any price, no period
  figure from part of the histories, a period moved to the first fully priced
  day; allocation colors by first purchase, five and "Other"; the server's
  histories and rates as series and a rate lookup through the dollar (a
  weekend keeps Friday's rate); formats.
- **Transactions:** `src/features/transactions` (`transactions/`) — what is
  held at a moment for **All** (`held.test.ts`): that day and not today, the
  transaction being edited left out, moments compared as times. Through a
  real vault against the fake server: stored encrypted, replaced with the next
  revision, refused when invalid, dated in the future or leaving a sale short
  (this one, a later one, or after shrinking or deleting a purchase it needs),
  a sale already short allowed to stay so but not grow, edits of records
  changed or deleted on another device refused with the current list, damaged
  records named and deletable. The form's amount fields (`form-values.test.ts`):
  what typing and pasting let through. Hostile text (`rendering.test.ts`): a note
  or a coin's name with markup reaches the page as text, rendered to a string
  with `react-dom/server`; an asset id in a logo's address stays encoded.
  "Price that day" (`market.test.ts`, a stubbed `fetch`): today's current
  price, an earlier day's close with its source, a rate from the day or the last
  one before it, six significant digits under a dollar, none before a history
  starts. The coins a sale offers (`held.test.ts`): those held now, the edited
  transaction left out, the largest value first. CSV (`csv.test.ts`,
  `csv-import.test.ts`): quotes, separators and line ends read back as written,
  formulas kept as text; a file refused before reading (size, not UTF-8, NUL),
  missing columns named, each kind of bad row skipped with its reason and
  spreadsheet row number, duplicates matched once each, the ledger's rule over
  the whole file, the account's room, and an export that imports back as it
  was. Importing through the service (`service.test.ts`): batches of 100 with
  progress, the lot refused before writing, a 429 waited out, a failure part
  of the way leaving exactly what is in. Deleting several: the chosen ones and
  unreadable ones among them in one request, a purchase a remaining sale needs
  refused with nothing deleted, everything at once; the page's copy kept only
  while the key is open (`keepIfUnlocked`).
- **Privacy policy:** `legal/storage-names.test.ts` — every `keyworth-…` name
  the browser's code stores is listed by name on the privacy page, as
  `src/features/legal/README.md` requires.
- **Free text:** `shared/schemas/text.ts` (in `schemas.test.ts`) — hidden
  characters dropped as typed, refused by the schema, cleaning twice changes
  nothing ([input-validation.md](../../shared/schemas/docs/input-validation.md)).

- **Calculations:** `shared/money` and `shared/metrics` (positions, average cost,
  P&L, splits, transfers, currencies, time-weighted returns, drawdown, volatility,
  correlation), every expected number worked out by hand. These are the numbers
  users see. What each file proves:
  [docs/metrics-tests.md](docs/metrics-tests.md).

Not here: anything that needs workerd (see [`integration/`](../integration/README.md))
or a real browser engine. Node 24 implements WebCrypto with the browsers' API,
so the crypto core runs here; that it also works in Chromium, Firefox and WebKit,
under the production CSP, is checked by `tests/e2e/encryption.spec.ts`.

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
