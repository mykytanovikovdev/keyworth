# tests/

The overall testing strategy for Keyworth. Each folder has its own README with
details.

## What is covered (and what is not)

| Folder                                  | Runner            | Runs in                                                | Covers                                                                      |
| --------------------------------------- | ----------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`unit/`](unit/README.md)               | Vitest (`unit`)   | Node                                                   | Pure logic, the encryption core, shared schemas                             |
| [`integration/`](integration/README.md) | Vitest (`worker`) | workerd (Miniflare) + the local test Postgres          | Worker routes, sign-in, encrypted storage, isolation                        |
| [`e2e/`](e2e/README.md)                 | Playwright        | Chromium, Firefox, WebKit against the production build | Page and Worker headers, CSP, rendering in both themes                      |
|                                         |                   | the same, plus an emulated iPhone, against `/design`   | Every `src/ui` component under the CSP, themes, axe; Argon2id under the CSP |
|                                         |                   | the same, with the local test database                 | Sign-in pages, sign-out, account deletion                                   |
|                                         |                   | the same                                               | Encryption flows, transactions, the portfolio page                          |
| [`visual/`](visual/README.md)           | Playwright        | Chromium in the Playwright Docker image                | Screenshots of `/design`, sign-in, settings, deletion                       |

Planned, each arriving with the code it tests:

- `e2e/` grows with importing and exporting CSV (phase 4) and recording a trade
  through chat (phase 7); transactions and the portfolio are already covered.
- `visual/` grows with the app's screens as they are built.
- `agent/` — the chat agent with a scripted mock model from `ai/test`:
  deterministic, runs in CI (phases 5–7).
- `evals/` — a question set run manually against the real model; results are
  saved for comparison when the prompt changes (phase 9).

Not covered on purpose: third-party services (Google, Anthropic, price APIs) are
never called from automated tests; the Worker tests have no network at all. Encryption tests are mandatory and run in CI
on every push: the core in `unit/crypto/`, storage, isolation and "no plaintext
in the database" in `integration/keys.test.ts` and `integration/vault.test.ts`,
and Argon2id in every browser engine in `e2e/encryption.spec.ts`.

## How to run

```sh
npm run db:up       # once: the local Postgres the Worker tests need (Docker)
npm test            # all Vitest projects
npm run test:watch  # Vitest in watch mode
npm run test:e2e    # Playwright against fresh production and design builds
npm run test:visual # screenshots of /design (needs Docker)
npm run check       # format, lint, types, tests, licenses, docs, build — run before "done"
```

## Approach

- Tests run in the same runtime as the code: Worker code in workerd, browser code
  in a browser, pure logic in Node.
- No real network: external services are replaced at the boundary.
- Expected values are written out in tests, not derived from the code under test.

## Keeping it lean

A test earns its place by catching something no cheaper test catches.

- **Reworking a feature includes its tests:** what is outdated or now duplicated
  goes in the same branch.
- **Each phase ends with a short review:** duplicates, test doubles in production
  code, scenarios that do not need every browser, baselines that change for
  unrelated reasons.
- **Encryption and isolation tests stay even when they look alike.** They sit at
  different layers of the defense (the input check, the schema, the database), and
  a mistake there costs someone's data.

## Adding a test

Find the folder whose runtime matches the code, follow the example in its README,
and name the file `*.test.ts`. A new test folder gets its own README and an entry
in the table above.

## Pitfalls

- Each test folder has its own `tsconfig.json` because runtimes differ (workerd,
  Node, browser); a type that exists in one may not exist in another.
  Node-side helpers shared by several folders live in `support/`: the test
  database setup, and signed-in sessions for browser tests created with Better
  Auth's `testUtils` plugin.
- Tests must not depend on order or on shared state; workerd storage is isolated
  per test by the pool.
