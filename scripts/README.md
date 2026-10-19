# scripts/

## Purpose

Small project tooling run by Node directly. Right now: the dependency license
check. Not application code: nothing here is bundled into the SPA or the Worker.

## How it works

| File                | Role                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| `check-licenses.ts` | CLI: reads `package-lock.json`, prints violations, exits non-zero     |
| `license-policy.ts` | The policy (allowlists, exceptions) and pure functions to evaluate it |

The check walks every entry in `package-lock.json` (lockfile v3 records each
package's `license` field and whether it is a dev-only dependency), parses the
SPDX expression and decides:

- **Runtime dependencies** (shipped in the SPA or Worker) must satisfy
  `ALLOWED_LICENSES`.
- **Dev-only dependencies** may additionally use `DEV_ONLY_LICENSES`.
- `OR` passes if any branch passes, `AND` needs every part, `X WITH exception`
  is judged by `X` (exceptions only add permissions).
- A missing, non-string or unparseable license fails.

Scripts are TypeScript run by Node's built-in type stripping (Node 24), which is
why the project enables `erasableSyntaxOnly`: no enums or other syntax that would
need a compiler.

## Why this way

The project is **AGPL-3.0-or-later**, so dependencies must be compatible with it.

| License                                                                  | Where allowed | Why                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIT, MIT-0, ISC, BSD-2/3-Clause, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0 | anywhere      | Permissive, compatible with (A)GPLv3                                                                                                                                                                  |
| Apache-2.0                                                               | anywhere      | Compatible with GPLv3/AGPLv3 (not with GPLv2, which does not matter here)                                                                                                                             |
| MPL-2.0                                                                  | anywhere      | File-level copyleft, explicitly compatible with (A)GPL via its secondary-license clause                                                                                                               |
| OFL-1.1                                                                  | anywhere      | Font license. The font files are separate works served alongside the app; OFL explicitly allows bundling them with any software, including (A)GPL, as long as the fonts themselves are not sold alone |
| LGPL-3.0-or-later                                                        | dev only      | Compatible, but it comes from native image libraries in the local Workers runtime; a runtime LGPL dependency deserves a conscious decision                                                            |
| CC-BY-4.0                                                                | dev only      | Browser-support data (`caniuse-lite`), not code                                                                                                                                                       |

Rejected alternatives:

- **`license-checker` and similar packages:** one more dependency (and supply-chain
  risk) for logic that fits on one screen and is easy to audit.
- **GitHub `dependency-review-action`:** needs GitHub Advanced Security on private
  repositories.

## Pitfalls & gotchas

- The check trusts each package's declared `license` field; it does not read
  `LICENSE` files. A package that misdeclares its license will not be caught.
- An exception in `LICENSE_EXCEPTIONS` is tied to the exact license string, so a
  license change in a new version fails again and needs a fresh review.
- Lockfile v3 is required (npm 7+); older lockfiles do not record licenses.

## How to work with it

- `npm run licenses` — run the check (also part of `npm run check` and CI).
- New dependency fails the check: first look for an alternative. If the license is
  genuinely compatible, add it to the right list with a row in the table above; for
  a one-off, add a `LICENSE_EXCEPTIONS` entry with the reason.
- Tests: [`tests/unit/license-policy.test.ts`](../tests/unit/license-policy.test.ts).

## Related

- [Root README](../README.md)
- [Unit tests](../tests/unit/README.md)
