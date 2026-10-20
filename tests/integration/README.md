# tests/integration/

Worker tests that run **inside workerd**, the same runtime as production, through
[`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/),
against a real Postgres: the local test database from `compose.yaml`.

## What is covered (and what is not)

Covered now:

- **`worker.test.ts`**: `/api/health` and the Worker security headers on every
  response, including errors; paths outside `/api` get a JSON 404; without a
  session, unknown `/api` routes get the same 401 as protected ones.
- **`auth.test.ts`**, through the real Google sign-in flow (state cookie,
  callback, database hooks, session):
  - an invited user gets a session, and `/api/me` returns only their own profile;
  - the session cookie is httpOnly, Secure and SameSite=Lax; a forged cookie gets 401;
  - neither Google's tokens nor the avatar URL are stored;
  - the invite list is case-insensitive; uninvited and unverified emails are
    sent to `/sign-in?error=NOT_INVITED` with nothing stored; removing an email
    from the list blocks the next sign-in;
  - sign-out ends the session at once; a cross-site request with the session
    cookie is refused (403);
  - **isolation**: deleting Alice's account removes Alice and her sessions,
    while Bob's account and session keep working;
  - account deletion needs a sign-in from the last 10 minutes;
  - sign-in attempts are limited to three per 10 seconds per address.

Deliberately not covered here:

- Headers of static assets and the SPA shell: they come from `public/_headers`,
  applied by the assets layer, which this pool does not emulate. `tests/e2e`
  asserts them against the real build.
- Google itself: its token endpoint is replaced in the test (see Approach). The
  real sign-in is checked by hand on each deploy that touches auth.

## How to run

```sh
npm run db:up                          # once per session: local Postgres in Docker
npm test                               # all Vitest projects
npx vitest run --project worker        # only these tests
npx vitest --project worker            # watch mode
```

No network or account is needed. Before the tests, `tests/support/integration-setup.ts`
applies every migration to `keyworth_test` and empties its tables.

## Approach

- The test calls the real Worker entry point with
  `exports.default.fetch(new Request(...))` from `cloudflare:workers`.
- **The Worker connects as `keyworth_app`**, the restricted production role,
  through the Hyperdrive binding pointed at the test database
  (`miniflare.hyperdrives` in `vitest.config.ts`). Secrets are fixed test values
  there too.
- **Google is replaced at one point only.** In the authorization-code flow,
  Better Auth gets the ID token directly from Google's token endpoint over TLS
  and only decodes it. `signInWithGoogle()` in `helpers.ts` swaps that one
  response (via `vi.spyOn(globalThis, "fetch")`, which works because the test
  and the Worker share an isolate) and drives everything else for real: the
  sign-in request, the state cookie, the callback, the hooks and the session.
- **Every test uses its own identity** (`uniqueUser()`): a unique email and
  client IP, so tests never share users or rate-limit counters and can run in
  any order without cleanup.
- Expected values (headers, cookie flags, error codes) are written out in the
  tests, not imported from the code under test.

## Adding a test

```ts
import { expect, it } from "vitest";
import {
  fetchWorker,
  invite,
  signInWithGoogle,
  uniqueUser,
} from "./helpers.ts";

it("GET /api/example returns the signed-in user's data", async () => {
  const user = uniqueUser("example");
  await invite(user.email);
  const { cookie } = await signInWithGoogle(user);

  const response = await fetchWorker("/api/example", { headers: { cookie } });

  expect(response.status).toBe(200);
});
```

Name files `*.test.ts` and put them in this folder. For a check on stored data,
`query()` runs SQL as the Worker's role.

## Pitfalls

- **The database must be running** (`npm run db:up`); the setup fails with that
  hint otherwise.
- After changing `wrangler.jsonc`, run `npm run cf:types`, or the `Env` types go
  stale.
- `pg` needs two module redirects in this test runner (`pg-protocol` and
  `pg-cloudflare`, in `vitest.config.ts`); without them it fails to load.
- Do not end database pools in tests or Worker code: the closed socket surfaces
  as an unhandled rejection that fails the run.
- Rate limits are per client IP: a test that signs in more than three times in
  10 seconds needs fresh identities, or it gets 429.
- This folder has its own `tsconfig.json` because the code runs in workerd, not
  Node; Node-side setup lives in `tests/support/`.
