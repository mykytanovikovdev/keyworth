# Portfolio flows (e2e)

What `tests/e2e/portfolio.spec.ts` proves about the portfolio page in the
production build, in Chromium, Firefox and WebKit: the vault, the market routes
(answered in the browser) and the screen together, with Argon2 at its
production settings.

## What it proves

- **The start page values what is held:** after unlocking, `/` is the
  portfolio; a purchase added through the form on it (a coin found by typing, a
  date typed from the keyboard) is valued at today's price, its all-time profit
  is the difference from what it cost, the chart is drawn and says what it
  shows, and the holdings table lists it. A longer period changes the words
  under the value. No console error and no CSP violation on the way.
- **Hidden amounts stay hidden** after a reload and a new unlock.
- **The sections link through the router:** the Transactions link opens the
  list without a reload, so without unlocking again.
- **Failing prices show a notice, not zeros:** with `/api/market/prices`
  answering 502, the page says prices couldn't load and shows no "$0.00".
- **Narrow screens and accessibility:** at 320 px the page does not scroll
  sideways, and axe finds no WCAG 2.2 A/AA violation.

## What it does not

- **The figures' arithmetic.** Every figure is worked out by hand in
  `tests/unit/metrics/` and `tests/unit/portfolio/summary.test.ts`; the e2e
  suite checks that they reach the screen.
- **Real market data.** `tests/e2e/market.ts` answers `/api/market` and
  `/api/assets` in the browser: today's prices, a daily history rising to 80%
  of today's price, and rates of 0.9. The routes are tested in
  `tests/integration/market.test.ts`.
- **Screenshots.** The page's dates are relative to today, so a baseline would
  change daily; `/design/portfolio` shows every state for review instead.

## Adding a case

Sign in with `openApp(page, context, baseURL)`, add a purchase with
`buyBitcoin(page)` (half a bitcoin at $60,000 ten days ago), then check the
screen. Every signed-in spec stubs the market in `beforeEach`
(`stubMarket(page)`), or the start page's price requests fail with a console
error.

Last reviewed: 2026-11-09
