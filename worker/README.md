# worker/

## Purpose

The Cloudflare Worker behind `/api/*`, built with [Hono](https://hono.dev). The same
deployment serves the React SPA through Workers Assets, so the frontend and the API
share one origin.

The Worker is designed to only ever see encrypted envelopes and service data
(profile, dates, usage counters, the public asset catalog). The single planned
exception is `/api/chat`, a pass-through to the model that never stores or logs
bodies.

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
/api/*           everything else: a valid session or 401 (deny by default), e.g. /api/me
```

| File                           | Role                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `index.ts`                     | Hono app: headers, per-request database and auth, session check     |
| `auth.ts`                      | Better Auth configuration: Google, invite list, sessions, limits    |
| `db/`                          | Schema, connection, migrations, roles ([README](db/README.md))      |
| `security-headers.ts`          | Headers for every Worker response (CSP, `no-store`, HSTS, ...)      |
| `../public/_headers`           | Headers for static assets and the SPA shell, including the page CSP |
| `../wrangler.jsonc`            | Worker config: assets routing, observability, compatibility date    |
| `../worker-configuration.d.ts` | Generated runtime and `Env` types (`npm run cf:types`)              |

Production runs at **https://keyworth.app**, a Custom Domain declared in
`wrangler.jsonc` (`routes` with `custom_domain: true`): each deploy keeps its DNS
record and certificate in place. The `workers.dev` address stays on until sign-in
goes live, then it is turned off so the app has a single origin.

`vite build` produces `dist/client` (static assets) and `dist/keyworth` (the Worker
bundle plus a generated `wrangler.json`). `wrangler deploy` reads the generated config
through `.wrangler/deploy/config.json`, not `wrangler.jsonc` directly.
`npm run preview` serves that build with `wrangler dev --config dist/keyworth/wrangler.json`:
the same runtime, assets and headers as production.

### Sign-in and sessions

1. The SPA asks `POST /api/auth/sign-in/social` for Google's URL; Better Auth
   stores the OAuth state and sends the browser to Google.
2. Google redirects back to `/api/auth/callback/google`. Better Auth exchanges
   the code for the user's profile, then the database hooks in `auth.ts` decide:
   the email must be verified by Google and on the invite list, both when the
   account is created and at every later sign-in.
3. Accepted: a session row and a signed `__Secure-better-auth.session_token`
   cookie (httpOnly, Secure, SameSite=Lax), then a redirect to the app.
   Refused: a redirect to `/sign-in?error=NOT_INVITED`, and nothing is stored.
4. Every other `/api/*` request reads the session from the cookie and the
   database. The user comes only from there, never from a request body or URL.

### Security headers

Two sources, because two different layers produce responses:

- **Page and assets (`public/_headers`).** The CSP that actually protects the
  encryption key lives here:
  `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-38Rh…' 'sha256-gYiS…'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'`
  (the two hashes are explained below).
  Plus HSTS, `nosniff`, a deny-by-default `Permissions-Policy`, COOP/COEP/CORP
  (the page is cross-origin isolated), `X-Frame-Options: DENY`, and `noindex`
  until release 1.
- **Worker responses (`security-headers.ts`).** JSON is never a document, so the
  CSP is just `default-src 'none'; frame-ancestors 'none'`, with
  `Cache-Control: no-store` so no proxy or browser cache keeps user data.

The e2e suite asserts the exact values of both sets against the production build,
and after every deploy against the live site.

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
- **Static CSP without nonces.** There are no inline scripts, so a fixed policy
  in `_headers` is enough and costs no Worker invocation per page load. The
  price: libraries that inject `<style>` tags with variable content at runtime
  are not usable.
- **Two style hashes for React Aria.** React Aria (`src/ui`) inserts two
  `<style>` blocks whose text never changes: `touch-action` for pressable
  elements (no double-tap zoom delay) and `overscroll-behavior` while a dialog
  is open on iOS. A `'sha256-…'` source allows exactly that text and nothing
  else, so `'unsafe-inline'` stays off. Style attributes (`style="…"`) remain
  blocked: hashes do not apply to them. Details and how to update the hashes:
  [src/ui/README.md](../src/ui/README.md#pitfalls--gotchas).
- **`Cache-Control: no-transform` on pages and assets.** On a zone (unlike
  `workers.dev`), Cloudflare can rewrite HTML at the edge: its Web Analytics
  beacon, email obfuscation, Rocket Loader. When keyworth.app went live, the
  beacon was injected into the page; the CSP blocked it, and the post-deploy
  smoke test caught the violation. `no-transform` tells the edge not to touch the
  response, so the page arrives exactly as built and no third-party script is
  ever inserted.
- **Trusted Types (`require-trusted-types-for 'script'`).** The browser refuses
  string assignments to DOM injection sinks such as `innerHTML`, at the engine
  level, even if a bug or a dependency tries one. React does not need these sinks;
  ESLint bans them in our code as well.
- **`Referrer-Policy: same-origin` for the page, not `no-referrer`.** With
  `no-referrer`, browsers send `Origin: null` on same-origin `POST` requests, and
  Better Auth checks `Origin` for CSRF protection, so sign-in and sign-out would
  fail. `same-origin` still sends nothing to other sites.
- **Better Auth.** It runs on Workers with Hono, keeps sessions in our own
  database (so they can be revoked at once), and brings CSRF origin checks and
  rate limiting for its routes. Rejected: writing OAuth and session handling by
  hand (easy to get subtly wrong), and Lucia, which its author deprecated.
- **Database sessions, no cookie cache.** Each request checks the session row,
  so signing out, deleting the account or revoking a session takes effect on the
  next request. It costs one query per request.
- **Only what sign-in needs is stored.** Google's access, refresh and ID tokens
  would let a database reader act on the user's Google account; Keyworth never
  calls Google APIs, so the hooks drop them before saving, along with the avatar
  URL (the page cannot load it anyway: `img-src 'self'`).
- **Deleting the account needs a sign-in from the last 10 minutes.** A stolen
  session cookie alone cannot erase someone's data.
- **Deny by default.** The session check sits in front of every route except
  health and auth, so a new route is protected unless it is deliberately made
  public. Without a session, an unknown route answers 401, not 404, and does not
  reveal what exists.
- **A fresh auth instance per request.** Bindings and secrets arrive with each
  request in Workers, so `createAuth(db, env)` runs inside the middleware.
- **Explicit logs only.** Workers Logs is on, but automatic invocation logs are off
  and query strings are redacted: the only records are what our code logs on
  purpose. Request bodies are never logged.
- **Rejected:** a separate API domain (CORS and cookie complexity), Pages Functions
  (Cloudflare steers new projects to Workers with static assets), a meta-framework
  (the app is deliberately an SPA plus a small API).

## Pitfalls & gotchas

- Run `npm run cf:types` after every change to `wrangler.jsonc`; CI fails if
  `worker-configuration.d.ts` is stale.
- `compatibility_date` cannot be newer than the workerd version bundled with
  wrangler, or local dev refuses to start.
- Never log request bodies or put user data into error messages: `/api/chat` and
  `/api/vault` carry it.
- `_headers` is not applied in `npm run dev` (and the React dev server needs an
  inline script), so there is **no CSP in dev**. CSP problems only show up in the
  production build: run `npm run test:e2e`, which fails on any CSP violation.
- `_headers` never applies to Worker responses and `security-headers.ts` never
  applies to static files. A new header usually belongs in both.
- Every CSP exception must be justified in this README. Current ones: the two
  React Aria style hashes (above). Planned: `'wasm-unsafe-eval'` for Argon2id
  (phase 3). `'unsafe-eval'` and `'unsafe-inline'` are never allowed.
- `BETTER_AUTH_URL` must be the origin the browser uses: Better Auth builds the
  OAuth redirect URI and its trusted origin from it. It is a var in
  `wrangler.jsonc` for production and overridden in `.dev.vars` locally.
- Secrets are declared by name in `wrangler.jsonc` (`secrets.required`), so the
  generated types are the same on every machine and missing secrets are reported
  in local dev.
- A database hook that refuses sign-in must throw an `APIError` **with a
  `code`**; only then does Better Auth's callback redirect to the error page
  instead of answering with JSON.
- Account deletion with a session older than 10 minutes fails with
  `400 SESSION_EXPIRED`; the client then asks the user to sign in again.
- Better Auth rate-limits only its own routes (`/api/auth/*`); other routes get
  their limits when they are added.
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
- The database: [db/README.md](db/README.md).

## Related

- [Root README](../README.md)
- [Design system](../src/ui/README.md) — why the CSP allows two style hashes
- [Database](db/README.md) — schema, roles, migrations, local Postgres
- [Integration tests](../tests/integration/README.md) — Worker tests in workerd
