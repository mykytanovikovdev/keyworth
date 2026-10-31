# src/features/unlock/

## Purpose

The screens around the user's keys: creating a passphrase and saving the
recovery key on first sign-in, unlocking, and recovering a forgotten
passphrase, plus the screen for an insecure address. They decide what the
person sees and types; the cryptography is in [src/crypto](../../crypto/README.md)
and the state of the key (locked, unlocked, remembered) will be in `src/vault/`.

**Status (phase 3, step 3):** designed and agreed with the owner on
2026-10-31; the screens take their state as props and are not wired to
`src/vault/` or the API yet. Every state is on `/design/encryption`.

## How it works

| File                         | Role                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| `KeyScreen.tsx`              | The shared frame: the sign-in page's centered column, title, account row |
| `CreatePassphraseScreen.tsx` | Onboarding step 1: one passphrase field                                  |
| `SaveRecoveryKeyScreen.tsx`  | Onboarding step 2: the key, Download / Copy / Print, "I've saved it"     |
| `RecoveryKeyPanel.tsx`       | The key in a 3 × 3 grid of groups, and the three ways to keep it         |
| `UnlockScreen.tsx`           | Passphrase, "Remember this device", the link to recovery                 |
| `RecoveryScreen.tsx`         | A fresh Google sign-in first; then the recovery key and a new passphrase |
| `RecoveryKeyField.tsx`       | The recovery key typed back: two lines, capitals, Enter submits          |
| `NeedsHttpsScreen.tsx`       | Shown instead of failing later when the page is not a secure context     |
| `messages.ts`                | What each refusal from `src/crypto` means to the person typing           |

```
Google sign-in ─► no keys yet ─► Create a passphrase ─► Save your recovery key ─► app
               └► keys exist ──► Unlock ─────────────────────────────────────────► app
                                   └► Use your recovery key ─► (sign in again) ─► key + new passphrase ─► app
```

## Why this way (decisions with the owner, 2026-10-31)

- **No "repeat the passphrase" field.** A typo at creation is recoverable with
  the recovery key saved one step later; a second field is friction.
- **No retyping of the recovery key** to prove it was saved: one warning and
  one button, as with Google's backup codes.
- **Recovery on one screen**: the recovery key and the new passphrase
  together. The fresh Google sign-in that replacing a key needs comes first,
  before anything secret is typed.
- **The recovery key field is two lines and always visible**, not a password
  field: all nine groups stay in view at any width, so a typo can be found by
  comparing group by group. It shows capitals whatever is typed; dashes,
  spaces, line breaks and case do not matter.
- **Plain Latin only** for everything typed here (the owner's rule): a
  non-Latin character gets "Is the keyboard set to English?" before any
  cryptography runs. Passphrase fields have autocorrect, capitalization and
  spellcheck off, also while shown.
- **"Remember this device"** is off by default, with an honest hint: until
  Lock, sign-out or closing the browser, longer in browsers that reopen tabs,
  only on a device the user does not share.
- **Errors do not blame the user outright** for `wrong-secret`: a damaged slot
  fails the same way as a wrong passphrase.

## Pitfalls & gotchas

- **Show the recovery key only after the server stored the keys** (a 2xx, or a
  409 naming the slot just sent); see
  [src/crypto/docs/key-hierarchy.md](../../crypto/docs/key-hierarchy.md).
- **Argon2 nearly stops frames and timers** in Chromium and Firefox while it
  runs: the pending state is a spinner on the button, and the unlock animation
  (step 4) must be CSS `transform`/`opacity` driven by `requestAnimationFrame`.
- **`crypto.subtle` exists only on secure pages** (HTTPS, `localhost`): check
  it at start and show `NeedsHttpsScreen`.

## How to work with it

`npm run dev`, then `/design/encryption`; pick a screen and a state with the
switcher at the bottom right. When a screen changes, update its mockup states
there, and check both themes at 390 and 1440 px.

## Related

- [src/crypto](../../crypto/README.md): keys, slots, error codes
- [src/features/settings](../settings/README.md): the encryption sections
- [src/ui](../../ui/README.md): `PasswordField`, `Checkbox`, `Select`, `Notice`
