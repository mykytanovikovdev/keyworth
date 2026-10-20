# src/features/settings/

## Purpose

The account page: who is signed in, the theme, signing out, and deleting the
account. Later phases add the passphrase, the recovery key, usage and export.

## How it works

| File                | Role                                                |
| ------------------- | --------------------------------------------------- |
| `SettingsPage.tsx`  | Sections: account (sign out), theme, delete account |
| `DeleteAccount.tsx` | The confirmation dialog and the fresh sign-in step  |

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

- **A recent sign-in is required** because deletion cannot be undone: a stolen
  session cookie alone must not be enough to erase someone's data. Ten minutes
  keeps the extra step rare in practice: right after signing in, deletion works
  at once.
- **The dialog reopens after the fresh sign-in**, so the user does not have to
  find the button again, but still confirms explicitly.

## Pitfalls & gotchas

- The confirm button uses the primary style: the design system has no
  destructive variant yet. Add one to `src/ui` (with contrast checks) before
  more destructive actions appear.
- `reauthenticated` only opens the dialog; it grants nothing. The server
  decides whether the session is fresh.

## How to work with it

Add a section with the local `Section` component in `SettingsPage.tsx`; keep
actions on the right and a one-line description on the left. Destructive
actions go last.

## Related

- [auth/](../auth/README.md): the session cache and Google sign-in
- [worker/](../../../worker/README.md): `freshAge` and account deletion on the server
