# tests/visual/

Screenshot comparison of the `/design` page: every design system component, in
both themes, at phone and desktop widths. A change to a token, a component or
a dependency that alters how anything looks fails here until a person has looked
at the difference and accepted it.

## What is covered (and what is not)

Covered (Chromium):

`design.spec.ts`:

- the whole `/design` page, light and dark, at 390 px and 1440 px;
- an open dialog over the page, in the same four combinations;
- a toast, in both themes.

`app.spec.ts`, light and dark, at 390 px and 1440 px:

- sign-in, with the "not on the invite list" message;
- how the encryption works (a new account's first screen), at its last step
  without motion, with the server's random characters masked;
- creating a passphrase (a new account) and unlocking (keys set up earlier by
  `tests/support/keys.ts`);
- settings, for a signed-in user with a fixed name and email, unlocked with
  the production Argon2 settings (slow in the emulated browser: those tests
  allow two minutes).
- the account deletion dialog over settings, with the red `danger` confirm
  button.

Not covered here:

- **Behavior and accessibility.** Keyboard, focus, CSP and axe checks run in
  three engines in [`tests/e2e/`](../e2e/README.md); they need no pixels.
- **Other browsers.** Rendering differs slightly between engines, and three sets
  of baselines would triple the review work for little gain. Chromium is the
  reference.
- **Hover and animation frames.** Screenshots use reduced motion, so every
  element is in its final state. Motion was reviewed by eye in phase 1.
- **Other app screens.** They join this suite as they are built.

## How to run

```sh
npm run test:visual          # compare with the baselines
npm run test:visual:update   # rewrite the baselines after an intended change
```

Both need **Docker** running (the image is about 2 GB, downloaded on first use).
The command builds the design-mode app, serves it on port 4174 against the
local test database (`npm run db:up` first), starts the browser container and
runs the tests. CI runs the same command (`.github/workflows/ci.yml`, job
`visual`).

After a failure, the report shows the expected, actual and diff images:
`npx playwright show-report playwright-report/visual` (CI uploads it as an
artifact).

## Approach

- **Baselines come from one environment.** Fonts are rasterized differently on
  macOS and Linux, and even on Linux between CPU architectures, so screenshots
  taken on a laptop would never match CI. Every screenshot, local or CI, is
  rendered by Chromium inside `mcr.microsoft.com/playwright:v1.64.1-noble`,
  pinned by digest, on `linux/amd64` (emulated on Apple silicon).
- **Only the browser is in Docker, locally and in CI.** `scripts/visual.ts` starts
  Playwright's browser server in the image and the tests connect to it; the web
  server and test runner stay on the host, so there is no `npm ci` inside a
  container. `exposeNetwork: "<loopback>"` lets the containerized browser open
  `localhost:4174` on the host.
- **Deterministic pages.** Reduced motion (all motion tokens are 0), fonts
  awaited with `document.fonts.ready`, the theme chosen through the stored
  preference rather than color-scheme emulation, and no live data: `/design`
  uses fixed sample values, and signed-in pages use a session created in the
  test database (`tests/support/session.ts`) for a user whose name and email
  are the same on every run.
- **One file per screenshot.** `snapshotPathTemplate` drops the OS suffix
  Playwright adds by default (every run renders on Linux), so baselines live in
  `__screenshots__/` with readable names such as `design-dark-390.png`.
- **Review is part of the change.** Baselines are committed; a pull request
  that changes them shows the old and new images side by side on GitHub.

## Adding a test

```ts
import { expect, test } from "@playwright/test";

test("settings page, dark, 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("keyworth-theme", "dark");
  });
  await page.goto("/settings");
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("settings-dark-390.png", {
    fullPage: true,
  });
});
```

Then run `npm run test:visual:update`, open the new PNG and check it before
committing it.

## Pitfalls

- **Never update baselines with a plain `npx playwright test`** on macOS: it
  would write macOS renderings that fail in CI. Always go through
  `npm run test:visual:update`.
- **Keep the image tag, its digest and `@playwright/test` on the same
  version** (in `scripts/visual.ts`, `ci.yml` and `package.json`). A Playwright
  upgrade means updating all three and regenerating the baselines in a separate
  commit. A Dependabot pull request that bumps only `@playwright/test` is
  expected to fail the `visual` job: the image ships the browsers of the older
  version.
- **A stale server on 4174 is reused locally** (`reuseExistingServer`). Stop
  it after changing code, or the screenshots show the old build.
- **The first run under emulation is slow** (Chromium on `linux/amd64` on an
  Apple silicon Mac); later runs reuse the downloaded image.
- **Anything time-dependent breaks baselines.** Pages under test must not show
  the current date, random values or live prices.
