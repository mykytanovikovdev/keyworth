# src/features/settings/

## Purpose

The account page: who is signed in, the theme, signing out, and deleting the
account. Phase 3 adds the encryption sections (designed, wired in step 3);
later phases add usage and export.

## How it works

| File                     | Role                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `SettingsPage.tsx`       | Sections: account (sign out), theme, delete account                      |
| `Section.tsx`            | One setting: title and description on the left, its control on the right |
| `DeleteAccount.tsx`      | The confirmation dialog and the fresh sign-in step                       |
| `EncryptionSettings.tsx` | The encryption sections and dialogs, as designed (not wired yet)         |
| `DeleteAccountMock.tsx`  | "Delete account" without its logic, for the design page                  |

**Agreed order** (owner, 2026-10-31): Account, Sign out everywhere,
Passphrase, Recovery key, Lock, Base currency, Theme, Delete account. The base
currency (the first encrypted record) is set here only, defaulting to USD; it
is not an onboarding step.

**Deleting the account:**

1. "Delete account" opens a confirmation (`alertdialog`: no Escape, no click
   outside).
2. Confirming calls Better Auth's `deleteUser`. The server deletes the user and,
   by cascade, everything that belongs to them.
3. If the session is older than 10 minutes, the server answers
   `SESSION_EXPIRED`. The dialog then offers "Sign in again", a fresh Google
   sign-in that returns to `/settings?reauthenticated=1`, where the dialog opens
   by itself for the final confirmation.

## Why this way

- **Lock and "Sign out everywhere" act at once, without a confirmation**
  (owner's decision): both are undone by signing in or unlocking again. A
  confirmation stays only where something is lost for good.
- **Changing the passphrase or creating a new recovery key** asks for a fresh
  Google sign-in first when the session is older than 10 minutes, with the same
  words as account deletion, before anything secret is typed. The new recovery
  key is shown in an `alertdialog` that only "I've saved it" closes.
- **A recent sign-in is required** because deletion cannot be undone: a stolen
  session cookie alone must not be enough to erase someone's data. Ten minutes
  keeps the extra step rare in practice: right after signing in, deletion works
  at once.
- **The dialog reopens after the fresh sign-in**, so the user does not have to
  find the button again, but still confirms explicitly.

## Pitfalls & gotchas

- Only the confirm button inside the dialog is red (`danger`); the button that
  opens the dialog stays neutral. Keep it that way for new destructive actions:
  see "Writing for the interface" in [src/ui](../../ui/README.md).
- `reauthenticated` only opens the dialog; it grants nothing. The server
  decides whether the session is fresh.

## How to work with it

Add a section with `Section` (`Section.tsx`); keep actions on the right and a
one-line description on the left. Destructive actions go last. Every state of
the encryption sections is on `/design/encryption`.

## Related

- [auth/](../auth/README.md): the session cache and Google sign-in
- [worker/](../../../worker/README.md): `freshAge` and account deletion on the server
