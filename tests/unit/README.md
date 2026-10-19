# tests/unit/

Fast tests for pure logic with no runtime APIs, run by Vitest in Node.

## What is covered (and what is not)

Covered now:

- `scripts/license-policy.ts` — SPDX parsing (precedence, parentheses, `WITH`,
  malformed input), allowlist evaluation, runtime vs dev-only rules, exceptions.
- `src/ui/tokens.css` — both themes define every semantic color and data
  series, and every text/background pair meets WCAG AA (4.5:1 for text, 3:1 for
  field borders and focus). The test parses the CSS, so a token change that
  breaks contrast fails before anyone sees it.

Planned: `shared/metrics` (positions, average cost, P&L, splits, transfers, time
zones, tiny quantities without precision loss), `shared/money` and the zod schemas
in `shared/schemas`. These are the numbers users see, so they get the most cases.

Not here: anything that needs workerd (see [`integration/`](../integration/README.md))
or a browser (WebCrypto keys, IndexedDB, components — a browser-based runner will be
chosen when that code arrives).

## How to run

```sh
npx vitest run --project unit    # once
npx vitest --project unit        # watch mode
```

No network or services needed.

## Approach

- Table-driven tests (`it.each`) for rules with many inputs, so a new edge case is
  one line.
- Inputs are small inline fixtures, not real lockfiles or recorded data, so each
  test shows exactly what it checks.
- Functions under test take their dependencies as parameters (for example, the
  exceptions map) instead of reading globals, which keeps them pure.

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

- Keep these tests free of time, randomness and the network; pass such values in
  as parameters.
- Do not import code that touches browser or Worker globals here; it will fail in
  Node or, worse, pass for the wrong reason.
