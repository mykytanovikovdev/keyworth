# Security headers and the CSP

A script injected into the page could use the encryption key, so the page runs
under a strict Content Security Policy, Trusted Types and cross-origin
isolation. Two layers produce responses, so there are two sources of headers:
`public/_headers` (the page and static assets) and `security-headers.ts`
(everything the Worker answers).

## The page and assets (`public/_headers`)

| Header                                                                 | Value / effect                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`                                              | see below                                                                                                             |
| `Strict-Transport-Security`                                            | `max-age=63072000; includeSubDomains; preload`                                                                        |
| `X-Content-Type-Options`                                               | `nosniff`                                                                                                             |
| `Referrer-Policy`                                                      | `same-origin` (not `no-referrer`: see auth-and-sessions.md)                                                           |
| `Permissions-Policy`                                                   | everything denied except passkeys for this origin                                                                     |
| `Cross-Origin-Opener-Policy` / `-Embedder-Policy` / `-Resource-Policy` | `same-origin` / `require-corp` / `same-origin`: the page is cross-origin isolated                                     |
| `X-Frame-Options`                                                      | `DENY`                                                                                                                |
| `X-Robots-Tag`                                                         | `noindex, nofollow` until release 1                                                                                   |
| `Cache-Control`                                                        | `public, max-age=0, must-revalidate, no-transform`; hashed assets `public, max-age=31536000, immutable, no-transform` |

The CSP:

```
default-src 'none'; script-src 'self'; style-src 'self' '<hash 1>' '<hash 2>';
img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self';
base-uri 'none'; form-action 'self'; frame-ancestors 'none';
require-trusted-types-for 'script'; trusted-types 'none'
```

- Only same-origin scripts, styles, images, fonts and requests; no inline
  scripts, no `eval`, no WebAssembly, no third-party anything.
- **Trusted Types** (`require-trusted-types-for 'script'`, `trusted-types
'none'`): the browser refuses string assignments to DOM injection sinks such
  as `innerHTML`, and no policy may be created to get around that. That also
  rules out Web Workers (their constructor is a sink).
- **The two style hashes** allow exactly two fixed `<style>` blocks that React
  Aria inserts at runtime (`touch-action` for pressable elements;
  `overscroll-behavior` while a dialog is open on iOS). Style attributes stay
  blocked. How to update them: [src/ui/README.md](../../src/ui/README.md).
- **`no-transform`** stops Cloudflare's zone features (the Web Analytics beacon,
  email obfuscation, Rocket Loader) from rewriting HTML at the edge. When
  keyworth.app went live, the beacon was injected and the CSP blocked it; the
  post-deploy smoke test caught it.

## Worker responses (`security-headers.ts`)

JSON is never a document: `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'`, `Cache-Control: no-store` (nothing user-related is
cached; a route may set its own only for data that is the same for everyone,
which today means coin logos: `private, max-age=86400`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, CORP and COOP `same-origin`, HSTS, `X-Robots-Tag:
noindex, nofollow`, no `X-Powered-By`. Applied to every Worker response,
including 404s and errors.

## Exceptions policy

**Current exceptions:** the two React Aria style hashes, nothing else.
`'unsafe-inline'`, `'unsafe-eval'` and `'wasm-unsafe-eval'` are never allowed;
Argon2id runs as plain JavaScript precisely to avoid the last one
([src/crypto/docs/argon2.md](../../src/crypto/docs/argon2.md)). Any new
exception needs the owner's approval and a justification here and in
`worker/README.md`.

## Invariants

1. Zero CSP or Trusted Types violations on every page, in every engine (the e2e
   suite fails on any).
2. `index.html` contains no inline scripts, styles or event handlers.
3. Every Worker response has its own CSP, and `no-store` unless its route set a
   `Cache-Control` for data that is the same for everyone (coin logos).

## Decisions and alternatives

- **A static policy without nonces:** there are no inline scripts, so a fixed
  policy in `_headers` costs no Worker invocation per page. The price: libraries
  that inject `<style>` with variable content cannot be used (Radix was
  rejected for this).
- **Dependencies that probe `eval`:** zod's probe is switched off (jitless mode,
  `shared/schemas/zod.ts`); anime.js modules that write `innerHTML` are banned
  by ESLint.

## Edge cases

- **No CSP in `npm run dev`:** `_headers` is not applied there and React's dev
  server needs an inline script. CSP problems show up only in built output:
  run `npm run test:e2e`.
- **`_headers` never applies to Worker responses, and `security-headers.ts`
  never to static files.** A new header usually belongs in both.
- **Repeated headers in `_headers` are joined with commas;** detach the parent
  rule's value first (`! Cache-Control` under `/assets/*`).

## How it is tested

`tests/e2e/headers.spec.ts` (exact values on pages, deep links, assets and
Worker responses; no inline code in `index.html`), every rendering e2e test
(zero violations), `tests/e2e/encryption.spec.ts` (Argon2id under the CSP),
and the post-deploy smoke test against keyworth.app. See
[tests/e2e/docs/csp-and-engines.md](../../tests/e2e/docs/csp-and-engines.md).

Last reviewed: 2026-11-07
