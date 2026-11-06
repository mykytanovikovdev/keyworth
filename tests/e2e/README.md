# tests/e2e/

Playwright tests against the **production build** and the **design-mode build**
(the same app plus the `/design` page), both served locally by workerd with the
production headers and the local test database, and after every deploy against
the live site.

## What is covered (and what is not)

Covered now:

- **`headers.spec.ts`** (HTTP only, no browser):
  - the page security headers, including the exact CSP, on `/` and on a deep SPA
    link (the fallback `index.html` must get them too);
  - `index.html` contains no inline scripts, styles or event handlers;
  - hashed assets are `immutable`, `robots.txt` blocks crawling, the `_headers`
    config file is not served, and the design prototype never ships;
  - `/api/health` and the Worker headers; `/api/me` without a session is 401;
  - a browser _navigation_ to an unknown `/api/*` path reaches the Worker instead
    of the SPA fallback (the guarantee OAuth callbacks rely on).
- **`app.spec.ts`** (Chromium, Firefox, WebKit):
  - the page renders in light and dark mode at 390 px and 1440 px with **zero CSP
    violations, console errors or page errors**, no horizontal scroll, and colors
    that actually follow the color scheme;
  - the page is cross-origin isolated (COOP + COEP work);
  - Trusted Types block `innerHTML` string assignment (skipped in browsers that
    do not implement Trusted Types);
  - the `/design` page is absent from the production build (an unknown path).
- **`auth.spec.ts`** (Chromium, Firefox, WebKit; local builds only):
  - "Continue with Google" leaves for Google with this app's client ID,
    callback URL and a state value (the request to Google is intercepted);
  - the invite-list refusal is explained in the app's own words, and text in
    the URL is never shown; unknown error codes get a generic message;
  - the privacy policy and terms are public;
  - signed in: the app opens (a new account on how its encryption works),
    `/sign-in` sends back to it, sign-out ends the session, account deletion
    works after confirmation, and a session older than 10 minutes is asked to
    sign in again first.
- **`encryption.spec.ts`** (Chromium, Firefox, WebKit; local builds only):
  the header at 320 px and its logo keeping the data open, how the encryption
  works (steps both ways, axe), onboarding with the
  recovery key shown once and downloaded, printing the key
  alone, unlocking (wrong, non-Latin, right), one unlock per browser (a new tab
  gets the key, Lock locks every tab, unlocking one unlocks the other),
  "Remember this device" and Lock, the 15-minute idle lock, recovery (a typo
  caught, then a new passphrase), deleting the account from the recovery
  screen, a fresh Google sign-in asked before secrets are typed, changing the passphrase and creating a new recovery key in
  Settings, the base currency stored encrypted, and Sign out everywhere
  reaching every tab. What it proves:
  [docs/encryption-flows.md](docs/encryption-flows.md).
- **`design-system.spec.ts`** (`/design` in Chromium, Firefox, WebKit, plus an
  emulated iPhone), in both themes:
  - every component used for real (dialog, confirmation, toast, tooltip) with
    **zero CSP violations or errors**, and React Aria's two hashed runtime styles
    actually applied, on desktop and on iOS;
  - keyboard and focus: focus moves into a dialog, Escape closes it and focus
    returns to its button; a confirmation ignores Escape;
  - **axe** finds no WCAG 2.2 A/AA violations, on the page and with a dialog open;
  - themes: set by `theme-init.js` before the app's JavaScript runs (the bundle
    is blocked in that test), a choice survives a reload, "System" clears it, and
    the page follows a live change of the system setting.
- **`kdf-benchmark.spec.ts`** (`/design/kdf` in Chromium, Firefox, WebKit): the
  encryption core's Argon2id (`@noble/hashes`) matches RFC 9106's test vector in
  each engine and runs with the production settings under the real CSP and
  Trusted Types with **zero violations or errors**. The measured time is added to
  the report as an `argon2id` annotation, one per browser.

What these suites prove about the CSP and the browser engines, and their
pitfalls: [docs/csp-and-engines.md](docs/csp-and-engines.md).

Not covered yet: the real round trip through Google (checked by hand), and
chat, which arrives with its phase. Screenshot comparison lives in [`tests/visual/`](../visual/README.md).

## How to run

```sh
npm run db:up                                 # once: the local test database (Docker)
npm run test:e2e                              # builds both, serves :4173 and :4174, runs all projects
npx playwright test --project=headers         # HTTP checks only, fast
npx playwright test --project=chromium        # production build, one browser
npx playwright test --project=design-webkit   # /design, one browser
npx playwright show-report                    # after a failure (traces are kept)
PLAYWRIGHT_BASE_URL=https://keyworth.app npx playwright test --project=headers --project=chromium
```

First run on a new machine: `npx playwright install chromium firefox webkit`.
No account, database or network access to third parties is needed.

## Approach

- **Why the production build:** `public/_headers` does not apply in `vite dev`, and
  the dev server needs an inline script, so dev has no CSP at all. Any CSP problem
  shows up only here — which is why the browser tests fail on a single violation.
- **Two builds, two servers.** Production on 4173, design mode on 4174. Each is
  served by `wrangler dev` from its own generated config, because `vite preview`
  serves whichever build ran last.
- **Test servers, test database, fake secrets.** Both servers get the test
  database through `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`
  and fixed fake secrets through `wrangler dev --var`; the global setup
  (`tests/support/e2e-setup.ts`) migrates and empties the database first.
- **Signed-in sessions without Google.** `createSignedInUser()`
  (`tests/support/session.ts`) runs Better Auth's `testUtils` plugin in Node,
  with the production auth options: it invites a unique email, creates the
  user and session in the test database and returns the signed cookie for
  `context.addCookies()`. The Worker contains no test routes.
- **Themes are chosen, not emulated, where it matters.** Component and axe tests
  store the theme choice before loading, which works in every engine; only the
  "follows the system" test relies on color-scheme emulation.
- **One suite, two targets:** `PLAYWRIGHT_BASE_URL` switches from the local build
  to a deployed URL; CI runs the `headers` and `chromium` projects against
  production right after each deploy.
- CSP violations are captured twice: through a `securitypolicyviolation` listener
  injected before any page script, and through console errors.
- Expected header values are written out in the test, never imported from the
  config files they check.

## Adding a test

```ts
import { expect, test } from "@playwright/test";

test("settings page renders", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
```

Browser tests go in `app.spec.ts` (production build), `design-system.spec.ts`
(`/design`) or a new `*.spec.ts`; add its file name to the `testMatch` of the
matching projects in `playwright.config.ts`. Shared helpers (CSP violation
capture, error collection, theme choice) are in `support.ts`. Prefer role- and
label-based locators: they double as a basic accessibility check.

## Pitfalls

- A new header or CSP change must be made in `public/_headers` (or
  `worker/security-headers.ts`) **and** in the expectations here; that is
  intentional friction.
- **The test database must be running** (`npm run db:up`); the global setup
  fails with that hint otherwise.
- `reuseExistingServer` is on locally: a stale server on port 4173 or 4174 will
  be reused with an old build. Stop it, or let the command rebuild.
- Axe scans run with reduced motion: text caught mid-fade fails the contrast
  rule for the wrong reason.
- React Aria detects iOS from `navigator.platform`, which Playwright's WebKit
  takes from the host, so the iPhone test overrides it. Chromium reports
  `touch-action: pan-x pan-y pinch-zoom` as `manipulation`; both mean the hashed
  style applied.
- Unknown `Permissions-Policy` features are silently ignored by browsers (no
  console error), so a typo there is only caught by the exact-value header test.
- Playwright's Firefox build on macOS ignores color-scheme emulation, so the theme
  assertion is skipped there with an annotation in the report; CSP and error
  checks still run.
- Firefox and WebKit may lag behind Chromium on newer security features (Trusted
  Types); feature-detect and skip rather than weakening assertions.
