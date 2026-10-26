# tests/

The overall testing strategy for Keyworth. Each folder has its own README with
details.

## What is covered (and what is not)

| Folder                                  | Runner            | Runs in                                                | Covers                                                 |
| --------------------------------------- | ----------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| [`unit/`](unit/README.md)               | Vitest (`unit`)   | Node                                                   | Pure logic, the encryption core, shared schemas        |
| [`integration/`](integration/README.md) | Vitest (`worker`) | workerd (Miniflare) + the local test Postgres          | Worker routes and headers, Google sign-in, isolation   |
| [`e2e/`](e2e/README.md)                 | Playwright        | Chromium, Firefox, WebKit against the production build | Page and Worker headers, CSP, rendering in both themes |
|                                         |                   | the same, plus an emulated iPhone, against `/design`   | Every `src/ui` component under the CSP, themes, axe    |
|                                         |                   | the same, with the local test database                 | Sign-in pages, sign-out, account deletion              |
| [`visual/`](visual/README.md)           | Playwright        | Chromium in the Playwright Docker image                | Screenshots of `/design`, sign-in and settings         |

Planned, each arriving with the code it tests:

- `unit/` grows with `shared/metrics` and `shared/money` (phase 4).
- `e2e/` grows with sign-in, encryption setup, unlock and recording a trade
  through chat (phase 2+).
- `visual/` grows with the app's screens as they are built.
- `agent/` — the chat agent with a scripted mock model from `ai/test`:
  deterministic, runs in CI (phases 5–7).
- `evals/` — a question set run manually against the real model; results are
  saved for comparison when the prompt changes (phase 9).

Not covered on purpose: third-party services (Google, Anthropic, price APIs) are
never called from automated tests. Encryption tests are mandatory and always run
in CI once phase 3 lands.

## How to run

```sh
npm run db:up       # once: the local Postgres the Worker tests need (Docker)
npm test            # all Vitest projects
npm run test:watch  # Vitest in watch mode
npm run test:e2e    # Playwright against fresh production and design builds
npm run test:visual # screenshots of /design (needs Docker)
npm run check       # format, lint, types, tests, licenses, build — run before "done"
```

## Approach

- Tests run in the same runtime as the code: Worker code in workerd, browser code
  in a browser, pure logic in Node.
- No real network: external services are replaced at the boundary.
- Expected values are written out in tests, not derived from the code under test.

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
