# worker/

## Purpose

The Cloudflare Worker behind `/api/*`, built with [Hono](https://hono.dev). The same
deployment serves the React SPA through Workers Assets, so the frontend and the API
share one origin.

The Worker is designed to only ever see encrypted envelopes and service data
(profile, dates, usage counters, the public asset catalog). The single planned
exception is `/api/chat`, a pass-through to the model that never stores or logs
bodies.

**Not responsible for:** serving static files or the SPA fallback (the assets layer
does that without invoking the Worker), and any computation on financial data (that
happens in the browser, on decrypted data).

## How it works

```
request ─► Cloudflare edge
            ├─ path matches /api/*                 ─► Worker (Hono) ─► JSON
            ├─ path matches a file in dist/client  ─► static asset
            └─ anything else
                 ├─ browser navigation              ─► index.html (SPA fallback)
                 └─ fetch / script / image request  ─► Worker ─► JSON 404
```

| File                           | Role                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `index.ts`                     | Hono app mounted at `/api`: routes, JSON 404, error handler      |
| `../wrangler.jsonc`            | Worker config: assets routing, observability, compatibility date |
| `../worker-configuration.d.ts` | Generated runtime and `Env` types (`npm run cf:types`)           |

`vite build` produces `dist/client` (static assets) and `dist/keyworth` (the Worker
bundle plus a generated `wrangler.json`). `wrangler deploy` reads the generated config
through `.wrangler/deploy/config.json`, not `wrangler.jsonc` directly.

## Why this way

- **One Worker, one origin.** The session cookie (phase 2) works without CORS or
  `SameSite=None`, and there is a single CSP to reason about.
- **Hono.** Tiny, built on Web-standard `Request`/`Response`, typed routes, and
  ready-made middleware. It also runs on Node, which keeps an exit path open if the
  API ever has to move off Cloudflare.
- **`run_worker_first: ["/api/*"]`.** Without it, a browser _navigation_ to an
  unknown path gets `index.html` and the Worker never runs. OAuth redirects back to
  `/api/auth/callback/*` are navigations, so sign-in would silently break.
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
- `vite preview` adds `Vary: Origin` locally; production responses don't have it.

## How to work with it

- `npm run dev` — Vite and the Worker (running in workerd) on one port, with HMR.
- `npm run build && npm run preview` — the production build, served locally by
  workerd exactly as it will run on Cloudflare.
- New route: add it to `index.ts` (or a sub-app under `worker/routes/` once there
  are several), with session checks, validation and rate limits from the start.
- Local secrets go in `.dev.vars` (see `.dev.vars.example`); production secrets
  via `wrangler secret put <NAME>`.

## Related

- [Root README](../README.md)
- [Integration tests](../tests/integration/README.md) — Worker tests in workerd
