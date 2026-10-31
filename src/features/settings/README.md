# src/features/settings/

## Purpose

The account page: who is signed in, signing out (here or everywhere), the
encryption settings (passphrase, recovery key, Lock), the base currency, the
theme, and deleting the account. Later phases add usage and export. Settings
sit behind the key gate: the page opens only once the data key is.

## How it works

| File                     | Role                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| `SettingsPage.tsx`       | The sections in the agreed order; `then` opens a dialog after a fresh sign-in  |
| `Section.tsx`            | One setting: title and description on the left, its control on the right       |
| `EncryptionSettings.tsx` | How the encryption sections and dialogs look, in every state (props only)      |
| `ManageKeys.tsx`         | Those sections wired to the vault: change passphrase, new key, Lock, currency  |
| `settings-record.ts`     | The `settings` record: its id, reading, saving with one retry after a conflict |
| `DeleteAccount.tsx`      | The confirmation dialog and the fresh sign-in step                             |
| `DeleteAccountMock.tsx`  | "Delete account" without its logic, for the design page                        |

**Agreed order** (owner, 2026-10-31): Account, Sign out everywhere,
Passphrase, Recovery key, Lock, Base currency, Theme, Delete account.

**Changing the passphrase, a new recovery key, deleting the account** need a
Google sign-in from the last 10 minutes (the server's rule):

1. The button first asks `GET /api/me` how long the sign-in stays fresh. With
   less than two minutes left, the dialog opens on "Sign in again" instead of
   the form, so nothing secret is typed in vain.
2. "Sign in again" locks every tab (the remembered device is bound to the old
   session, so it is forgotten), then leaves for Google and returns to
   `/settings?then=change-passphrase` (or `new-recovery-key`,
   `delete-account`). After unlocking, the dialog opens by itself.
3. If the server still answers `session_not_fresh`, the dialog switches to
   "Sign in again".

**Changing the passphrase** needs the current one (WebCrypto can wrap only an
extractable copy of the data key); "Sign out other devices" then ends every
other session (Better Auth's `revokeOtherSessions`). **A new recovery key** is
shown in an `alertdialog` that only "I've saved it" closes, and only after the
server stored its slot.

**The base currency** is the first encrypted record (kind `settings`,
`shared/schemas/settings.ts`), created on the first change; until then USD.
Its id is derived from the user id (SHA-256, shaped as a UUID v4), so two
devices that create it at once write the same record and the second gets a
409, re-reads and applies its change on top, instead of leaving two competing
records.

**Deleting the account:** a confirmation (`alertdialog`), then Better Auth's
`deleteUser`; the server deletes the user and, by cascade, everything that
belongs to them. Every tab of the browser locks and the device key goes.

## Why this way

- **Lock and "Sign out everywhere" act at once, without a confirmation**
  (owner's decision): both are undone by signing in or unlocking again. A
  confirmation stays only where something is lost for good.
- **Lock reloads the page** after every tab forgot the key: the only sure way
  to drop every decrypted value still held by components and caches.
- **A recent sign-in is required** for what could lock a user out or erase
  their data: a stolen session cookie alone must not be enough.
- **The fresh sign-in is a redirect** (owner, 2026-10-31), like account
  deletion: the tab loses the key on the way, so after coming back the user
  unlocks and then types the current passphrase again in the dialog. These
  actions are rare. A popup sign-in that keeps the tab unlocked is in the
  backlog (Better Auth's `oauth-popup` plugin conflicts with our COOP).
- **The dialog reopens after the fresh sign-in**, so the user does not have to
  find the button again, but still confirms explicitly.

## Pitfalls & gotchas

- Only the confirm button inside the dialog is red (`danger`); the button that
  opens the dialog stays neutral. Keep it that way for new destructive actions:
  see "Writing for the interface" in [src/ui](../../ui/README.md).
- `then` only opens a dialog; it grants nothing. The server decides whether
  the session is fresh.
- Decrypted settings live in TanStack Query under `["vault", userId, …]`;
  `src/App.tsx` removes every `["vault"]` query whenever the vault leaves
  `unlocked`. New queries with decrypted data must use that prefix.
- Someone who lost both the passphrase and the recovery key cannot reach this
  page to delete the account; the owner can (`npm run users -- delete`).

## How to work with it

Add a section with `Section` (`Section.tsx`); keep actions on the right and a
one-line description on the left. Destructive actions go last. Every state of
the encryption sections is on `/design/encryption`; the flows are tested in
`tests/e2e/encryption.spec.ts`.

## Related

- [auth/](../auth/README.md): the session cache, Google sign-in, signing out
- [unlock/](../unlock/README.md): the key screens and the fresh sign-in check
- [src/vault](../../vault/README.md): the flows these sections call
- [worker/](../../../worker/README.md): `freshAge` and account deletion on the server
