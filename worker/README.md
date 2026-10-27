# worker/

## Purpose

The Cloudflare Worker behind `/api/*`, built with [Hono](https://hono.dev). The same
deployment serves the React SPA through Workers Assets, so the frontend and the API
share one origin.

The Worker only ever sees encrypted envelopes, wrapped keys and service data
(profile, dates, usage counters, the public asset catalog): it stores what the
browser's encryption produces and cannot open it. The single planned exception
is `/api/chat`, a pass-through to the model that never stores or logs bodies.

It also owns sign-in: Google through [Better Auth](https://www.better-auth.com),
an invite list for the closed beta, database sessions in an httpOnly cookie, and
a session check in front of every other API route.

**Not responsible for:** serving static files or the SPA fallback (the assets layer
does that without invoking the Worker), and any computation on financial data (that
happens in the browser, on decrypted data).

## How it works

```
request ─► Cloudflare edge
            ├─ path matches /api/*                 ─► Worker (Hono) ─► JSON + Worker headers
            ├─ path matches a file in dist/client  ─► static asset  ─► + public/_headers
            └─ anything else (any request type)    ─► index.html    ─► + public/_headers
```

Inside the Worker:

```
/api/health      public, never touches the database
/api/auth/*      Better Auth: Google sign-in and callback, session, sign-out, account deletion
/api/*           everything else: a valid session or 401 (deny by default), e.g. /api/me;
                 writes also need the app's own Origin (403 otherwise)
/api/keys        wrapped data keys and remembered devices   (routes/)
/api/vault       encrypted records                          (routes/)
```

| File                           | Role                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `index.ts`                     | Hono app: headers, per-request database and auth, session check     |
| `env.ts`                       | Types of the bindings and per-request values every route sees       |
| `limits.ts`                    | Rate limits, body size, fresh-session and same-origin checks        |
| `routes/`                      | `/api/keys` and `/api/vault` ([README](routes/README.md))           |
| `auth.ts`                      | Better Auth configuration: Google, invite list, sessions, limits    |
| `db/`                          | Schema, connection, migrations, roles ([README](db/README.md))      |
| `security-headers.ts`          | Headers for every Worker response (CSP, `no-store`, HSTS, ...)      |
| `../public/_headers`           | Headers for static assets and the SPA shell, including the page CSP |
| `../wrangler.jsonc`            | Worker config: assets routing, observability, compatibility date    |
| `../worker-configuration.d.ts` | Generated runtime and `Env` types (`npm run cf:types`)              |

Production runs at **https://keyworth.app**, a Custom Domain declared in
`wrangler.jsonc` (`routes` with `custom_domain: true`): each deploy keeps its DNS
record and certificate in place. The `workers.dev` address is off, so the app has
a single origin: session cookies, the OAuth redirect URI and Better Auth's trusted
origin all assume keyworth.app.

`vite build` produces `dist/client` (static assets) and `dist/keyworth` (the Worker
bundle plus a generated `wrangler.json`). `wrangler deploy` reads the generated config
through `.wrangler/deploy/config.json`, not `wrangler.jsonc` directly.
`npm run preview` serves that build with `wrangler dev --config dist/keyworth/wrangler.json`:
the same runtime, assets and headers as production.

### Sign-in, access and headers

- **Sign-in:** Google through Better Auth, for invited and not blocked emails
  only (checked at account creation and every sign-in); database sessions in an
  httpOnly cookie; every route after the session check needs a session (401),
  and every write needs the app's own `Origin` (403). Details:
  [docs/auth-and-sessions.md](docs/auth-and-sessions.md).
- **Security headers:** the page's strict CSP with Trusted Types and
  cross-origin isolation comes from `public/_headers`; every Worker response
  gets its own from `security-headers.ts`. Details and the exceptions policy:
  [docs/security-headers.md](docs/security-headers.md).
- **The app's own routes** (`/api/keys`, `/api/vault`) and their guards:
  [routes/README.md](routes/README.md),
  [routes/docs/api-guards.md](routes/docs/api-guards.md).

## Why this way

- **One Worker, one origin.** The session cookie (phase 2) works without CORS or
  `SameSite=None`, and there is a single CSP to reason about.
- **Hono.** Tiny, built on Web-standard `Request`/`Response`, typed routes, and
  ready-made middleware. It also runs on Node, which keeps an exit path open if the
  API ever has to move off Cloudflare.
- **`run_worker_first: ["/api/*"]`.** Without it, a browser _navigation_ to an
  unknown path gets `index.html` and the Worker never runs. OAuth redirects back to
  `/api/auth/callback/*` are navigations, so sign-in would silently break. The
  pattern form also turns off `Sec-Fetch-Mode` guessing: only `/api/*` ever reaches
  the Worker, so a missing file gets `index.html` instead of a billable invocation.
- **Explicit logs only.** Workers Logs is on, but automatic invocation logs are off
  and query strings are redacted: the only records are what our code logs on
  purpose. Request bodies are never logged, and neither are error messages: an
  unhandled error is logged as its type, its Postgres code and its stack frames
  (`describe-error.ts`), because a failed query's message lists the query's
  parameters (ciphertext, wrapped keys) and a JSON error quotes the body.
- **Security decisions** (static CSP, Trusted Types, `no-transform`, Better
  Auth, database sessions, what is stored from Google, deny by default) are
  explained in [docs/auth-and-sessions.md](docs/auth-and-sessions.md) and
  [docs/security-headers.md](docs/security-headers.md).
- **Rejected:** a separate API domain (CORS and cookie complexity), Pages Functions
  (Cloudflare steers new projects to Workers with static assets), a meta-framework
  (the app is deliberately an SPA plus a small API).

## Pitfalls & gotchas

- Run `npm run cf:types` after every change to `wrangler.jsonc`; CI fails if
  `worker-configuration.d.ts` is stale.
- **Local previews pass `--local-upstream localhost:<port>`.** Because
  `wrangler.jsonc` declares the keyworth.app route, a bare `wrangler dev`
  rewrites each request's host and `Origin` header to keyworth.app. Better Auth
  then sees a foreign origin and refuses every POST that carries the session
  cookie (`403 INVALID_ORIGIN`): sign-out and account deletion break while
  reads keep working. `npm run dev` (the Vite plugin) does not rewrite.
- **CSP exceptions** need the owner's approval and a justification in
  [docs/security-headers.md](docs/security-headers.md). Current ones: the two
  React Aria style hashes. There is **no CSP in `npm run dev`**: run
  `npm run test:e2e` to see violations.
- **Sign-in pitfalls** (`BETTER_AUTH_URL`, hook refusals need a `code`,
  `SESSION_EXPIRED` on stale deletion): [docs/auth-and-sessions.md](docs/auth-and-sessions.md).
- `compatibility_date` cannot be newer than the workerd version bundled with
  wrangler, or local dev refuses to start.
- Never log request bodies, error objects or error messages (`console.error(error)`
  prints the message): `/api/chat`, `/api/keys` and `/api/vault` carry user data.
  Log `describeError(error)` instead.
- Secrets are declared by name in `wrangler.jsonc` (`secrets.required`), so the
  generated types are the same on every machine and missing secrets are reported
  in local dev.
- `npm run build:design` (the `/design` page) also rewrites
  `.wrangler/deploy/config.json`, so a bare `wrangler deploy` right after it would
  deploy the design build. `npm run deploy` and CI always rebuild production first.

## How to work with it

- `npm run dev` — Vite and the Worker (running in workerd) on one port, with HMR.
- `npm run build && npm run preview` — the production build, served locally by
  workerd exactly as it will run on Cloudflare (port 4173).
- `npm run build:design && npm run preview:design` — the same with the `/design`
  page (port 4174); see [src/ui/README.md](../src/ui/README.md).
- New route: add it to `index.ts` after `requireSession` (or a sub-app under
  `worker/routes/` once there are several), read the user with `c.get("user")`,
  and add validation and limits from the start. A public route goes before the
  session check, on purpose and with a comment.
- Local secrets go in `.dev.vars` (copy `.dev.vars.example`); production
  secrets via `npx wrangler secret put <NAME>`. Local sign-in with real Google
  also needs the localhost redirect URI on the OAuth client.
- The database: [db/README.md](db/README.md). Invites, blocks, account
  deletion and blocking IP addresses at Cloudflare:
  [scripts/docs/user-management.md](../scripts/docs/user-management.md).

## Related

- [docs/](docs/): sign-in and sessions, security headers and the CSP

- [Root README](../README.md)
- [Design system](../src/ui/README.md) — why the CSP allows two style hashes
- [Database](db/README.md) — schema, roles, migrations, local Postgres
- [Integration tests](../tests/integration/README.md) — Worker tests in workerd
