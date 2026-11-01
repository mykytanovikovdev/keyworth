# src/features/unlock/

## Purpose

The screens around the user's keys: creating a passphrase and saving the
recovery key on first sign-in, unlocking, recovering a forgotten passphrase,
and the screens for an insecure address and for keys that could not load. They
decide what the person sees and types; the state of the key (locked,
unlocked, remembered) and every flow are in [src/vault](../../vault/README.md),
the cryptography in [src/crypto](../../crypto/README.md).

## How it works

```
Google sign-in ─► no keys yet ─► Create a passphrase ─► Save your recovery key ─► app
               └► keys exist ──► Unlock ─────────────────────────────────────────► app
                                   └► /recover ─► (sign in again) ─► key + new passphrase ─► app
```

**Screens** take their state as props and report what was typed through
callbacks, so `/design/encryption` can show every state without a server:

| File                         | Shows                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| `KeyScreen.tsx`              | The shared frame: the sign-in page's centered column, title, account row |
| `CreatePassphraseScreen.tsx` | Onboarding step 1: one passphrase field                                  |
| `SaveRecoveryKeyScreen.tsx`  | Onboarding step 2: the key, Download / Copy / Print, "I've saved it"     |
| `RecoveryKeyPanel.tsx`       | The key in a 3 × 3 grid, and the three ways to keep it                   |
| `UnlockScreen.tsx`           | Passphrase, "Remember this device", the link to recovery                 |
| `RecoveryScreen.tsx`         | A fresh Google sign-in first; then the recovery key and a new passphrase |
| `RecoveryKeyField.tsx`       | The recovery key typed back: two lines, capitals, Enter submits          |
| `NeedsHttpsScreen.tsx`       | Instead of failing later when the page is not a secure context           |
| `KeysUnavailableScreen.tsx`  | The keys could not be loaded (offline): "Try again"                      |

**Wiring:**

| File                 | Role                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `VaultGate.tsx`      | Wraps every signed-in page: picks the screen for the vault's state   |
| `RecoverPage.tsx`    | `/recover`, outside the gate (the user is locked out of it)          |
| `useStartedVault.ts` | Starts the vault for the signed-in user                              |
| `fresh-sign-in.ts`   | Asks `/api/me` whether the sign-in is recent enough; "Sign in again" |
| `messages.ts`        | What each refusal means to the person typing; toasts for the rest    |
| `form-text.ts`       | A field's value from a submitted form                                |

Containers check what they can before the slow part: a passphrase that is not
plain Latin, too short or too long is refused at once (`checkPassphrase`),
before Argon2 runs; a recovery key's typos are caught by its check group.

## Why this way (decisions with the owner, 2026-10-31)

- **No "repeat the passphrase" field.** A typo at creation is recoverable with
  the recovery key saved one step later; a second field is friction.
- **No retyping of the recovery key** to prove it was saved, and **no reminder
  later**: one warning and one button, as with Google's backup codes. The key
  is shown only once the server holds the slot it opens.
- **Recovery on one screen**: the recovery key and the new passphrase
  together. The fresh Google sign-in that replacing a key needs comes first,
  before anything secret is typed (`GET /api/me` → `freshForSeconds`, with two
  minutes of margin for typing and Argon2).
- **The recovery key field is two lines and always visible**, not a password
  field: all nine groups stay in view at any width, so a typo can be found by
  comparing group by group. Dashes, spaces, line breaks and case do not matter.
- **Plain Latin only** for everything typed here (the owner's rule): a
  non-Latin character gets "Is the keyboard set to English?" before any
  cryptography runs. Passphrase fields have autocorrect, capitalization and
  spellcheck off, also while shown.
- **Autocomplete is off on every passphrase field** (owner, 2026-11-01): with
  `new-password`, Chrome offered to generate the passphrase and then saved it
  in the Google account without asking, the same account used to sign in.
  Browsers may still offer to save a typed passphrase (Chrome ignores
  `autocomplete="off"` on password fields); the rejected alternative was a
  masked text field that password managers do not recognize, at the cost of
  screen readers echoing it and macOS's secure input.
- **"Remember this device"** is off by default, with an honest hint: until the
  browser closes, Lock or sign-out, at most 14 days, longer than the browser
  session in browsers that reopen tabs, only on a device the user does not
  share.
- **Errors do not blame the user outright** for `wrong-secret`: a damaged slot
  fails the same way as a wrong passphrase.
- **The gate keeps the address.** A locked user who opens `/settings` unlocks
  and lands on `/settings`, not on the home page.

## Pitfalls & gotchas

- **Argon2 nearly stops frames and timers** in Chromium and Firefox while it
  runs: the pending state is a spinner on the button, and the unlock animation
  (step 4) must be CSS `transform`/`opacity` driven by `requestAnimationFrame`.
- **`crypto.subtle` exists only on secure pages** (HTTPS, `localhost`): the
  vault reports `insecure` and the gate shows `NeedsHttpsScreen`. On a phone,
  test on the production site or through an HTTPS tunnel, not on
  `http://<Mac's IP>`.
- **The checkbox is a hidden input under a drawn box**: tests click its label.
- **Printing** sets `data-printing-key` on `<html>`; the print styles in
  `src/ui/styles.css` then hide everything but the key, also in a dialog.
- **Deleting the account is also on the recovery screen** (owner,
  2026-11-01), for someone who lost the recovery key too: Settings is behind
  the gate. It appears once the sign-in is fresh, which deleting needs as
  well, so it works without another trip to Google. It does not weaken
  anything: the server asks for a fresh Google sign-in, never the passphrase,
  wherever the button is. The invitation survives deletion, so the person can
  sign in again and start over.

## How to work with it

`npm run dev`, then `/design/encryption`: every screen and state, with a
switcher at the bottom right. The real flows run against the local database
in the e2e tests (`tests/e2e/encryption.spec.ts`). When a screen changes,
update its states there, and check both themes at 390 and 1440 px.

## Related

- [src/vault](../../vault/README.md): the key's states and flows
- [src/crypto](../../crypto/README.md): keys, slots, error codes
- [src/features/settings](../settings/README.md): the encryption sections
- [src/ui](../../ui/README.md): `PasswordField`, `Checkbox`, `Select`, `Notice`
