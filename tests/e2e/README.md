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
  - the page renders in light and dark mode at 390 px with **zero CSP
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
  - the line right under the Google button says what continuing accepts, and
    the privacy policy and terms open from it and directly, without signing in;
  - signed in: the app opens (a new account on how its encryption works),
    `/sign-in` sends back to it, Settings links to the policy and terms and coming
    back does not lock the data, sign-out ends the session, account deletion
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
  Settings, the base currency found by typing and stored encrypted, and Sign
  out everywhere reaching every tab. What it proves:
  [docs/encryption-flows.md](docs/encryption-flows.md).
- **`transactions.spec.ts`** (Chromium, Firefox, WebKit; local builds only): a
  purchase added through the form (a coin found by typing, today, the day's
  price used with one press) is stored encrypted, listed and still there after
  unlocking again; a sale of more than was held is refused with how much was,
  and nothing is stored; editing, deleting and Undo; a note with markup shown
  as text that runs nothing; the list and the form at 320 px with no axe
  violations. Market data is answered in the browser (`market.ts`), so no test
  reaches CoinGecko. What it proves:
  [docs/transaction-flows.md](docs/transaction-flows.md).
- **`portfolio.spec.ts`** (Chromium, Firefox, WebKit; local builds only): the
  start page values a purchase added on it (today's price, all-time profit, the
  chart, the table), a longer period, hidden amounts kept after a reload, the
  Transactions link without a reload, failing prices shown as a notice and not
  as zeros, 320 px with no axe violations. What it proves:
  [docs/portfolio-flows.md](docs/portfolio-flows.md).
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

Scenarios tagged `@chromium-only` run in Chromium alone, because they exercise
text and routing, not anything the engines implement differently. Which scenarios
need every engine: [docs/csp-and-engines.md](docs/csp-and-engines.md).

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
- **Shared signed-in helpers** (`signed-in.ts`): a user with keys set up as on an
  earlier visit, unlocking, the app's start page, reading the test database.
- **Market data stubbed in the browser:** `stubMarket(page)` (`market.ts`)
  answers Keyworth's own `/api/market` and `/api/assets` routes, so the tests
  need neither the CoinGecko key nor the network; the routes themselves are
  tested in `tests/integration/market.test.ts`. Every spec that signs in calls
  it in `beforeEach`: the signed-in start page asks for prices at once, and
  without a key the e2e Worker answers 502, which the browser logs as a console
  error. How fast that happens depends on the network (a blocked connection
  only hangs), so a missing stub fails some runs and not others.
- **axe and React Aria's announcer:** after a combobox closes, React Aria's live
  region keeps for seven seconds a `role="img"` entry pointing at an option that
  is gone; `transactions.spec.ts` excludes exactly those entries.

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
- **Each test is its own visitor** (`ownAddress` in `signed-in.ts`, called by
  every sign-in helper and by `auth.spec.ts`). Better Auth limits requests per
  client address; locally every test shares one, so a long run would end in
  429s on `/api/auth/get-session` and a "Something went wrong" page. The
  address is a random IPv6 documentation-range network (Better Auth counts
  IPv6 by /64, so the random part comes first), sent as `cf-connecting-ip`,
  which only Cloudflare's edge sets in production.
- **Open a combo box's list with `click(LIKE_A_PERSON)`** (`support.ts`), not a
  bare `click()`. Playwright releases the button within a millisecond; when
  the page is busy at that moment (just unlocked, code loading in the
  background), React Aria opens the list on the press and closes it again on
  the late release. CI's slower runners hit it; locally it shows with the CPU
  slowed (`Emulation.setCPUThrottlingRate`), 6 runs of 6.
- **Do not run the Worker tests while e2e runs:** both use `keyworth_test`,
  and the Worker tests' setup empties the users table, so e2e users and
  sessions vanish mid-test.
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
