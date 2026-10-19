# tests/integration/

Worker tests that run **inside workerd**, the same runtime as production, through
[`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/).

## What is covered (and what is not)

Covered now:

- `GET /api/health` responds and carries the Worker security headers.
- Unknown paths and methods get a JSON 404, still with every security header (an
  error response is the easiest place to forget them).
- `X-Powered-By` is never sent.

Deliberately not covered here:

- Headers of static assets and the SPA shell: those come from `public/_headers` and
  are applied by the assets layer, which this pool does not emulate. They are
  asserted by [`tests/e2e`](../e2e/README.md) against the real production build.
- Database-backed behaviour: arrives with phase 2, together with user-isolation
  tests (user A must never read, change or delete user B's records).

## How to run

```sh
npm test                               # all Vitest projects
npx vitest run --project worker        # only these tests
npx vitest --project worker            # watch mode
```

No network, account or database is needed: Miniflare runs everything locally.

## Approach

- The test calls the real Worker entry point with
  `exports.default.fetch(new Request(...))` from `cloudflare:workers`. This is the
  replacement for the deprecated `SELF` from `cloudflare:test`.
- Configuration comes from `wrangler.jsonc` (`cloudflareTest({ wrangler: ... })`),
  so compatibility date and flags match production.
- Expected header values are listed explicitly in the test, not imported from
  `worker/security-headers.ts`: a test that reads its expectations from the code
  under test cannot catch a wrong value.

## Adding a test

```ts
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("GET /api/example returns 401 without a session", async () => {
  const response = await exports.default.fetch(
    new Request("https://keyworth.test/api/example"),
  );
  expect(response.status).toBe(401);
});
```

Name files `*.test.ts` and put them in this folder; `tests/integration/tsconfig.json`
provides the workerd and `cloudflare:test` types.

## Pitfalls

- After changing `wrangler.jsonc`, run `npm run cf:types`, or the `Env` and
  `exports` types used here go stale.
- This folder has its own `tsconfig.json` because the code runs in workerd, not
  Node: there is no `process`, `fs` or DOM.
- The pool requires a Vitest version it supports; check the plugin's peer
  dependencies before upgrading Vitest.
