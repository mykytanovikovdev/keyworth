# Transaction flows (e2e)

What `tests/e2e/transactions.spec.ts` proves about transactions in the
production build, in Chromium, Firefox and WebKit: the screens, the vault and
the database together, with Argon2 at its production settings.

## What it proves

- **Stored encrypted, listed, kept:** a purchase added through the form (a coin
  found by typing, today's date, the day's price used with one press, the total
  shown) is one `transaction` record whose ciphertext holds neither the coin, the
  price nor the source; it is listed, and still listed after a reload and a new
  unlock. No console error and no CSP violation on the way.
- **A date typed from the keyboard:** typed digit by digit, it is taken and
  shown in words, with no error and no CSP violation (React Aria's announcer
  under Trusted Types, [src/ui/README.md](../../../src/ui/README.md)).
- **The ledger's rule at the form:** selling more than was held shows "You held
  0.5 BTC on …" at the quantity, and the database keeps only the purchase.
- **All:** on a sale, "Held on …: 0.53124 BTC" is shown and **All** fills in
  exactly that, which is then sold.
- **Editing, deleting, Undo:** an edit is saved and listed; deleting removes the
  record from the database at once; Undo writes it back.
- **Hostile text:** a note `<img src=x onerror="…">` is listed as that text; no
  image element appears, nothing runs, no CSP violation
  ([input-validation.md](../../../shared/schemas/docs/input-validation.md)).
- **Narrow screens and accessibility:** at 320 px neither the list nor the form
  (on Receive, with every field) scrolls sideways, and axe finds no WCAG 2.2 A/AA
  violation in either.

## What it does not

- **Real market data.** `page.route` answers `/api/market` and `/api/assets` in
  the browser; the routes and their sources are tested in
  `tests/integration/market.test.ts`, "Price that day" in
  `tests/unit/transactions/market.test.ts`.
- **Every rule of the ledger.** Backdated sales, purchases a later sale needs,
  changes from another device and damaged records are tested against a fake
  server in `tests/unit/transactions/service.test.ts`; the e2e suite proves the
  form shows a refusal, not each refusal.
- **Firefox on a developer's Mac when the command sandbox blocks it.** CI runs
  every engine on every pull request.

## Adding a case

Sign in with `openApp(page, context, baseURL)` (a user with keys, unlocked on
`/transactions`), fill the form with `fillForm` or add with `add`, and check both the screen
and the database (`storedTransactions(userId)`). Rows exist twice in the page,
for a phone and a wide screen: find text with `visible(page, text)`.

Last reviewed: 2026-11-09
