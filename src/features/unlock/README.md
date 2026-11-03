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
| `KeyMark.tsx`                | The keyhole mark on top: Argon2's progress ring, the lock turning        |
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
| `key-progress.ts`    | `KeyProgress` (Argon2's readings for the ring) and the ring's pace   |
| `useFinale.ts`       | Keeps a key screen up while its keyhole turns, after the data opens  |
| `messages.ts`        | What each refusal means to the person typing; toasts for the rest    |
| `form-text.ts`       | A field's value from a submitted form                                |

Containers check what they can before the slow part: a passphrase that is not
plain Latin, too short or too long is refused at once (`checkPassphrase`),
before Argon2 runs; a recovery key's typos are caught by its check group.

**The lock while Argon2 runs** (owner's choice of three storyboards,
2026-11-03): on Unlock, Create a passphrase and Recovery, a thin ring around
the keyhole mark fills with Argon2's real progress (0.6–1 s on today's
phones and laptops); the button says "Unlocking…" or "Encrypting…" without a
spinner, since the ring shows the progress. When the data opens, the ring
closes and the keyhole turns a quarter, like a key in a lock (240 ms), and
only then does the next screen show; a refused passphrase or recovery key
shakes the mark. Dialogs in Settings keep the spinner on their button.

```
submit ─► KeyMark "working": a Web Animation, paced by KeyProgress readings
       │       (vault … onProgress: progress.report ─► progress.listen)
       ├► data open ─► vault unlocked; useFinale holds the same screen,
       │               KeyMark "opened" (keyhole turns) ─► next screen
       └► refused ───► KeyMark "refused" (shake), message under the field
```

The vault turns unlocked before the call that opened it returns, so the
screen tells the gate beforehand (`hold(true)` at submit, `hold(false)` on a
failure); `useFinale` then keeps that screen, the same element in the tree,
for `baseDuration()` once the vault is unlocked. A device that is already
remembered, or a key from another tab, has no Argon2 and no ring: the app
opens at once.

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

- **Argon2 leaves the main thread few frames** (Chromium draws about ten a
  second while it runs). So the ring is one Web Animation of `transform` that
  the browser runs by itself; the readings only retune its `playbackRate`, at
  most every 250 ms. Set `playbackRate` directly: `updatePlaybackRate()` holds
  the animation until the next frame, and with frames this scarce the ring
  stood still. The pace starts cautious (two seconds per turn), so a slow
  device does not see the ring run ahead, and follows the first readings
  after 3% or 150 ms (`ringRate`, unit-tested).
- **On a phone the keyboard would hide the ring**: when work starts, the
  key screen takes the focus out of the field (`dismissKeyboard`, touch only).
  With a mouse, a refusal puts the cursor back in the field.
- **The finale relies on the gate rendering the same element type** for the
  screen while locked and while holding: a different element would remount
  the screen and lose its state.
- **`crypto.subtle` exists only on secure pages** (HTTPS, `localhost`): the
  vault reports `insecure` and the gate shows `NeedsHttpsScreen`. On a phone,
  test on the production site or over HTTPS on the local network, not on
  `http://<Mac's IP>`. The same goes for anything timed: WebKit (every
  browser on iOS) runs JavaScript 8 to 55 times slower on a page that is not
  a secure context, which made Argon2 take 40 s on an iPhone opening the
  mockups over plain http.
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
switcher at the bottom right. The "try it" screens (1c, 3e–3g, 4c) run real
Argon2 for the ring, the turn and a refusal (3f takes four times longer, to
watch the ring); Replay starts a screen over. The real flows run against the
local database in the e2e tests (`tests/e2e/encryption.spec.ts`), which also
record the mark's statuses. When a screen changes, update its states there,
and check both themes at 390 and 1440 px.

## Related

- [src/vault](../../vault/README.md): the key's states and flows
- [src/crypto](../../crypto/README.md): keys, slots, error codes
- [src/features/settings](../settings/README.md): the encryption sections
- [src/ui](../../ui/README.md): `PasswordField`, `Checkbox`, `Select`, `Notice`
