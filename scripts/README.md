# scripts/

## Purpose

Small project tooling run by Node directly: the dependency license check, the
documentation check, the mutation runner and the bundle size report, the local
runner for visual tests, user management (invites, sessions, blocks, account
deletion) and the auth schema generator. Not application code: nothing here is bundled into
the SPA or the Worker.

## How it works

| File                      | Role                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| `check-licenses.ts`       | CLI: reads `package-lock.json`, prints violations, exits non-zero         |
| `license-policy.ts`       | The policy (allowlists, exceptions) and pure functions to evaluate it     |
| `visual.ts`               | Runs `tests/visual` with Chromium in the Playwright image, here and in CI |
| `users.ts`                | `npm run users`: invites, sessions, blocks and account deletion           |
| `user-admin.ts`           | The SQL behind `users.ts`, without I/O, so the Worker tests can run it    |
| `generate-auth-schema.ts` | `npm run db:auth-schema`: regenerates Better Auth's tables                |
| `check-docs.ts`           | `npm run docs:check`: public Markdown against `docs-policy.ts`            |
| `docs-policy.ts`          | Links, review dates and forbidden content, as pure functions              |
| `mutate.ts`               | `npm run mutate -- <plan.json>`: do the tests notice a broken line?       |
| `mutation-plan.ts`        | The plan's format, its validation and the exact-once replacement          |
| `bundle-size.ts`          | `npm run bundle:size`: script chunks, and the largest one by package      |
| `bundle-map.ts`           | Sizes per source and package from a source map (its own VLQ decoder)      |

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

### The documentation check

`npm run docs:check` (part of `npm run check`, so CI runs it) reads every
README and `docs/` file git tracks or would add; ignored working notes are
never read. It fails on:

- a relative link to a file or folder that does not exist (links inside code
  are examples and are skipped);
- a `docs/` file whose last line is not `Last reviewed: YYYY-MM-DD`, a real day
  that has come;
- a database connection string other than a local one, a Neon password or
  host, an email address outside the example domains (`example.com`, `*.test`),
  an IP address outside loopback and the documentation ranges (RFC 5737), and a
  credit to a development assistant. It reports the file and line, never the
  text found: that may be the secret.

It does not judge prose: whether a document is still true, and whether it
names a user or an open weakness, is the review that the date records.

### Mutation runs

A test suite that passes says nothing about what it would catch. `npm run
mutate -- plan.json` takes a list of deliberate breakages (format in
`mutation-plan.ts`; the plan is written for one branch and kept out of the
repository), checks that each `from` text occurs exactly once and that the
tests pass before any change, then for each one: breaks the line, runs the
tests, restores the file (also on Ctrl+C). A breakage the tests miss is
reported as `SURVIVED` and fails the run. It is a review tool, not part of
`npm run check`: plans go stale as the code changes.

### Bundle size

`npm run bundle:size` builds with source maps into a temporary folder, lists
every script chunk with its gzip size, and splits the largest chunk by package
(`react-aria`, `zod`) and project folder (`src/features`). The real `dist/` is
not touched, and the deploy target that every build rewrites
(`.wrangler/deploy/config.json`) is put back.

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

- **Own scripts for docs, mutations and bundle sizes:** no Markdown linter,
  mutation framework or bundle visualizer as dependencies. Each fits on a
  screen and its rules are this project's (review dates, no secrets, no
  assistant credits); Stryker and similar tools would mutate everything and
  take minutes per run, while a hand-written plan targets the lines a branch
  changed.

## Pitfalls & gotchas

- The check trusts each package's declared `license` field; it does not read
  `LICENSE` files. A package that misdeclares its license will not be caught.
- An exception in `LICENSE_EXCEPTIONS` is tied to the exact license string, so a
  license change in a new version fails again and needs a fresh review. A
  package with no license field at all (`license: "none"`) is excepted for one
  `version` only, after its `LICENSE` file was read by hand: so far
  `@react-aria/optimize-locales-plugin`, whose files are Apache-2.0.
- Lockfile v3 is required (npm 7+); older lockfiles do not record licenses.
- **Every `vite build` rewrites `.wrangler/deploy/config.json`** to point
  `wrangler deploy` at its output. `bundle-size.ts` restores it; a new script
  that builds elsewhere must do the same.
- **A mutation run killed hard (`kill -9`) leaves the file broken.** Ctrl+C
  restores it; otherwise `git diff` shows the change.
- **The docs check knows only patterns.** A secret in an unusual shape passes
  it; gitleaks (pre-commit and CI) is the second net.

## How to work with it

- `npm run licenses` — run the check (also part of `npm run check` and CI).
- New dependency fails the check: first look for an alternative. If the license is
  genuinely compatible, add it to the right list with a row in the table above; for
  a one-off, add a `LICENSE_EXCEPTIONS` entry with the reason.
- Tests: [`tests/unit/license-policy.test.ts`](../tests/unit/license-policy.test.ts).
- `npm run docs:check` — before reporting a branch ready (also in `npm run
check`). A false positive: use an example address or range rather than widen
  the rules. Tests: [`tests/unit/docs-policy.test.ts`](../tests/unit/docs-policy.test.ts).
- `npm run mutate -- plan.json` — after writing tests for risky code: one
  mutation per rule the tests should guard, the cheapest command that runs
  those tests. Tests: [`tests/unit/mutation-plan.test.ts`](../tests/unit/mutation-plan.test.ts).
- `npm run bundle:size` (`-- --all` for every package) — before and after a
  change that adds a dependency or splits code. Tests:
  [`tests/unit/bundle-map.test.ts`](../tests/unit/bundle-map.test.ts).
- `npm run users -- <command>` — targets `DATABASE_URL` when set, the local
  database otherwise, and always prints which one first. Commands, when to use
  which, and blocking IP addresses at Cloudflare:
  [docs/user-management.md](docs/user-management.md).
- `npm run db:auth-schema` — runs Better Auth's CLI at the installed version
  (not the newest on npm) and switches every timestamp to `with time zone`.
- `npm run test:visual` / `npm run test:visual:update` — `visual.ts` starts the
  pinned Playwright image (as `linux/amd64`, like CI), serves its browser on
  `127.0.0.1:3123`, runs the tests on this machine against it, and removes the
  container afterwards. Why and how: [tests/visual/README.md](../tests/visual/README.md).

## Related

- [docs/user-management.md](docs/user-management.md): invites, blocks, deletion, IP blocking

- [Root README](../README.md)
- [Unit tests](../tests/unit/README.md)
