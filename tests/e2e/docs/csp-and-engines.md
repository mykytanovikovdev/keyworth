# CSP and browser-engine tests

What the end-to-end suite proves about the page's defenses, in Chromium,
Firefox and WebKit (plus an emulated iPhone on `/design`), against production
and design builds served locally by workerd with the real headers, and against
keyworth.app after every deploy.

## What is proven

**Headers** (`headers.spec.ts`, HTTP only): the exact CSP and every security
header on `/` and on a deep SPA link; `index.html` has no inline scripts, styles
or event handlers; hashed assets are immutable and `no-transform`; the Worker's
headers on `/api/health` and on 401s; a browser navigation to an unknown
`/api/*` path reaches the Worker (OAuth callbacks rely on it).

**Zero violations while rendering** (`app.spec.ts`, `design-system.spec.ts`,
`auth.spec.ts`, `encryption.spec.ts`, `transactions.spec.ts`, `portfolio.spec.ts`,
`chat.spec.ts`): the pages record **no CSP or Trusted Types
violation, console error or page error**; Trusted Types actually block an
`innerHTML` string; the page is cross-origin isolated; React Aria's two hashed
styles are applied; the `/design` page is absent from production. These checks
found that zod's eval probe triggers a Trusted Types report, which led to zod's
jitless mode. A date typed digit by digit (`/design` and the transaction form)
covers React Aria's live announcer, which clears with `innerHTML`; a button that
fills the date does not reach that code.

**Argon2id under the CSP** (`encryption.spec.ts`): in each engine, the production
build runs Argon2id with the production settings under the real CSP and Trusted
Types. It opens keys that `tests/support/keys.ts` made in Node, so an engine that
computed it differently could not unlock. The RFC 9106 vector itself is checked in
`tests/unit/crypto/kdf.test.ts`.

**Which scenarios need every engine:** anything that touches what engines
implement differently (WebCrypto, IndexedDB, Web Locks, BroadcastChannel, cookies,
reloads and tabs, downloads, printing, a new UI component, layout). This is where
the engines have earned their keep: WebKit reports a CSP violation for any native
`<select>` and shows ungranted Web Locks only as pending, and Firefox aborts
requests during a reload. Scenarios that only exercise text and routing on screens
other scenarios already load in every engine are tagged `@chromium-only`.

**After every deploy:** the headers and Chromium projects run against
keyworth.app in CI.

## Invariants these tests hold

1. The production CSP is exactly as documented in
   [worker/docs/security-headers.md](../../../worker/docs/security-headers.md).
2. No page of the app or the design system triggers a policy violation in any
   engine.
3. The encryption core's Argon2id works under that policy in every engine.

## Deliberately not here

Visual comparison (`tests/visual`) and the real Google round trip (by hand).
The encryption screens have their own suite, with the same CSP checks:
[encryption-flows.md](encryption-flows.md).

## Pitfalls

- **There is no CSP in `npm run dev`;** only these tests (built output with
  `_headers`) see violations.
- **Playwright's WebKit against the live site sometimes renders a blank page**
  (about 1 in 36 runs) after a 200 response; Chromium and Firefox do not, and
  Safari on an iPhone did not. Rerun before concluding anything; the CI smoke
  test uses Chromium.
- Violations are collected from the first script on every page load
  (`watchCspViolations` in `support.ts`); a test that opens a page without it
  sees nothing.

Last reviewed: 2026-11-25
