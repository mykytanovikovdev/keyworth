# tests/e2e/

Playwright tests against the **production build**, served locally by workerd
(`vite build && vite preview`), and after every deploy against the live site.

## What is covered (and what is not)

Covered now:

- **`headers.spec.ts`** (HTTP only, no browser):
  - the page security headers, including the exact CSP, on `/` and on a deep SPA
    link (the fallback `index.html` must get them too);
  - `index.html` contains no inline scripts, styles or event handlers;
  - hashed assets are `immutable`, `robots.txt` blocks crawling, the `_headers`
    config file is not served;
  - `/api/health` and the Worker headers;
  - a browser _navigation_ to an unknown `/api/*` path reaches the Worker instead
    of the SPA fallback (the guarantee OAuth callbacks rely on).
- **`app.spec.ts`** (Chromium, Firefox, WebKit):
  - the page renders in light and dark mode at 390 px and 1440 px with **zero CSP
    violations, console errors or page errors**, no horizontal scroll, and colors
    that actually follow the color scheme;
  - the page is cross-origin isolated (COOP + COEP work);
  - Trusted Types block `innerHTML` string assignment (skipped in browsers that
    do not implement Trusted Types).

Not covered yet: user flows (sign-in, encryption setup, unlock, chat) — they arrive
with their phases. Screenshot comparison and axe accessibility checks live in
`tests/visual/` from phase 1.

## How to run

```sh
npm run test:e2e                              # builds, starts preview on :4173, runs all projects
npx playwright test --project=headers         # HTTP checks only, fast
npx playwright test --project=chromium        # one browser
npx playwright show-report                    # after a failure (traces are kept)
PLAYWRIGHT_BASE_URL=https://example.workers.dev npx playwright test --project=headers --project=chromium
```

First run on a new machine: `npx playwright install chromium firefox webkit`.
No account, database or network access to third parties is needed.

## Approach

- **Why the production build:** `public/_headers` does not apply in `vite dev`, and
  the dev server needs an inline script, so dev has no CSP at all. Any CSP problem
  shows up only here — which is why the browser tests fail on a single violation.
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

Browser tests go in `app.spec.ts` or a new `*.spec.ts`; add its file name to the
`testMatch` of the browser projects in `playwright.config.ts`. Prefer role- and
label-based locators: they double as a basic accessibility check.

## Pitfalls

- A new header or CSP change must be made in `public/_headers` (or
  `worker/security-headers.ts`) **and** in the expectations here; that is
  intentional friction.
- `reuseExistingServer` is on locally: a stale `vite preview` on port 4173 will be
  reused with an old build. Stop it, or let the command rebuild.
- Unknown `Permissions-Policy` features are silently ignored by browsers (no
  console error), so a typo there is only caught by the exact-value header test.
- Playwright's Firefox build on macOS ignores color-scheme emulation, so the theme
  assertion is skipped there with an annotation in the report; CSP and error
  checks still run.
- Firefox and WebKit may lag behind Chromium on newer security features (Trusted
  Types); feature-detect and skip rather than weakening assertions.
