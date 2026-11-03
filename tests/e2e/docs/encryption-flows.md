# Encryption flows in real browsers

What `tests/e2e/encryption.spec.ts` proves: every flow around the user's keys,
in the production build with its CSP, against the local test database, in
Chromium, Firefox and WebKit. The unit tests
([tests/unit/docs/vault-tests.md](../../unit/docs/vault-tests.md)) cover the
same flows' logic and failure cases against a fake server; this suite proves
that the browser parts hold: IndexedDB, BroadcastChannel between real tabs,
Web Locks, reloads, downloads, print styles, the session and device cookies,
and the production Argon2 settings.

## Approach

- **Sessions without Google:** `tests/support/session.ts` signs a user in
  directly in the test database and gives the browser the cookie.
- **Keys without onboarding:** `tests/support/keys.ts` runs `src/crypto` in
  Node to make keys exactly as onboarding does (production Argon2 settings)
  and stores them as `POST /api/keys` would, so most tests start at the unlock
  screen. Onboarding itself has its own test.
- **The database is the witness** for what the server holds: key slots after
  onboarding, the device row before and after Lock, the recovery slot's IV
  after a new key, and the settings record's ciphertext.
- **Tabs** are pages of one browser context: they share localStorage,
  IndexedDB, BroadcastChannel and Web Locks, like tabs of one profile.
- **Reloads the app starts** (Lock, the idle lock) are awaited with
  `waitForEvent("load")` before the test acts again; acting during the reload
  loses input or aborts the test's own navigation (Firefox).
- **Time** for the idle lock is moved by writing an older activity time to
  localStorage and firing `focus`, which is what a returning user does.
- **The keyhole mark's statuses** (`data-key-mark`: `working` while Argon2
  runs, `opened` while the lock turns, `refused`) are recorded by a
  MutationObserver from the moment the screen shows (`watchKeyMark`): the
  finale lasts a quarter of a second, too short to catch by polling.
- Each test also asserts **no CSP violations and no console errors** where it
  matters: a 404 in the console fails the test, which is why "not remembered"
  is a 200 with `{ slot: null }`.

## What is proven

- **How it works:** a new account opens on "Only you can read your
  portfolio"; Next, Back and the dots move between the six steps (the caption
  follows, the current dot is `aria-current`, Back and Next turn off at the
  ends); Continue works from the first step and leads to "Create a
  passphrase", step 2 of 3. Without motion, its first and last step have no
  axe violations (the last one dims a key but keeps its label readable).
- **Onboarding:** a non-Latin and a short passphrase are refused with their
  messages; a valid one leads to the recovery key (nine groups), which
  downloads as `keyworth-recovery-key.txt` containing it exactly; "I've saved
  it" opens the app; both slots are stored. The ring runs only for the
  derivation (refusals before Argon2 do not start it), and the lock turns
  before the recovery key shows.
- **Printing** shows only the key: with print media and the printing marker,
  the heading and buttons are hidden and the key is visible.
- **Unlocking:** a wrong and a non-Latin passphrase get their messages; after
  the wrong one the mark went from the ring to a refusal, and the cursor is
  back in the field; the right one turns the lock before the page that was
  asked for (`/settings`) shows; a reload asks again.
- **One unlock per browser:** a second tab opens without the passphrase; Lock
  in one tab locks both; unlocking one unlocks the other.
- **Remember this device:** with the checkbox, the device row exists and a
  reload opens the app; Lock removes the row, and the next reload asks again.
- **Idle lock:** 16 minutes after the last activity, coming back locks the tab
  with "Locked after 15 minutes without activity."
- **Recovery:** a key with one wrong character is caught as a typo; the right
  key (typed with spaces instead of dashes) and a new passphrase open the app
  after the lock turns, and the new passphrase unlocks after a reload. With a sign-in older than 10
  minutes, `/recover` offers "Sign in again" (to Google) and no fields and no
  delete button. With a fresh sign-in, someone who lost the recovery key too
  deletes the account from `/recover` and lands on the sign-in page; the user
  is gone from the database.
- **Settings:** a wrong current passphrase is refused; the change works, and
  the new passphrase unlocks after a reload; a new recovery key replaces the
  stored recovery slot and is shown until "I've saved it". With an old
  sign-in, "Change passphrase" opens on "Sign in again" with no fields.
- **The first encrypted record:** choosing EUR stores one `settings` record
  whose ciphertext contains neither "EUR" nor the field name; after a reload
  and unlock the choice is back.
- **Sign out everywhere** from one tab sends both tabs to the sign-in page.

## Not covered here

The real Google round trip (checked by hand); "Copy" (clipboard permissions
differ between engines in headless mode); the print dialog itself; the
Argon2 upgrade (no slot has weaker settings yet; unit-tested); browser
storage being unavailable; how smooth the ring looks (checked by eye, on a
phone over HTTPS; its pace is unit-tested); the keyboard closing on a phone
(touch screens only).

## Adding a case

```ts
test("…", async ({ page, context, baseURL }) => {
  const { passphrase, userId } = await returningUser(context, baseURL);
  await page.goto("/settings");
  await unlock(page, passphrase);
  // act, then check the page and, where it matters, the database
});
```

Give Argon2 time: every test in the file is marked `test.slow()` (three times
the usual 30 seconds), and assertions right after an unlock or a key change
use `AFTER_ARGON2` (30 seconds). In CI a derivation takes several seconds,
most in WebKit on Linux; with 15 seconds and the default test time, the test
with six derivations failed there twice in a row (2026-11-03).

Last reviewed: 2026-11-03
