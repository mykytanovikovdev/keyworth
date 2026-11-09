# src/routes/

## Purpose

The app's pages and how they connect: the route tree, the signed-in layouts,
and the pages that belong to no feature (home, not found).

## How it works

| File                          | Role                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `router.tsx`                  | Every route, declared in code, and the router factory                                             |
| `AppShell.tsx`                | Behind the key gate: header (mark, sections, theme, settings) and content                         |
| `AppNav.tsx`                  | The sections in the header (Portfolio, Transactions): inline, or a second row on phones           |
| `/` → `PortfolioPage`         | The signed-in start page ([src/features/portfolio](../features/portfolio/README.md))              |
| `/transactions`               | The transactions and their form ([src/features/transactions](../features/transactions/README.md)) |
| `NotFoundPage.tsx`            | Any unknown path                                                                                  |
| `KdfBenchmarkPage.tsx`        | `/design/kdf`: Argon2id timing on this device, and why it is slow (developer tool)                |
| `EncryptionMockupsPage.tsx`   | `/design/encryption`: every state of the encryption screens; "try it" with real Argon2            |
| `TransactionsMockupsPage.tsx` | `/design/transactions`: the transactions screens in every state                                   |
| `PortfolioMockupsPage.tsx`    | `/design/portfolio`: the portfolio page in every state, from made-up transactions                 |

```
             ┌ session layout: no session → redirect to /sign-in
/            │ ┐ app layout: the key gate (create a passphrase, unlock)
/transactions│ │
/settings    │ ┘   ?then=change-passphrase | new-recovery-key | delete-account
/recover     └   outside the gate: a forgotten passphrase
/sign-in       a session → redirect to /
/privacy, /terms
/design        only in dev and design builds
/design/kdf    the same; Argon2id timing (see src/crypto/README.md)
/design/encryption  the same; the encryption screens in every state, with a
               switcher (`?screen=<id>` opens one, `&bare` hides the switcher,
               Replay starts a "try it" screen over)
/design/transactions, /design/portfolio  the same; mockups with a switcher
```

`src/App.tsx` creates the query client and the router, and passes the router's
`navigate` to `UIProvider`, so React Aria links navigate without page loads.

## Why this way

- **Routes in code, not file-based.** A handful of routes, fully typed, with no
  generator and no generated file to keep in sync. Switching to file-based
  routing later is mechanical.
- **Guards decide pages, not access.** `beforeLoad` redirects based on the
  cached session, but the Worker checks the session on every API request; a
  page that slipped through would get no data.
- **The key gate is a component, not a redirect**
  ([features/unlock/VaultGate.tsx](../features/unlock/VaultGate.tsx)): the
  address stays, so unlocking on `/settings` lands on `/settings`, and the
  vault's state changes (Lock in another tab) apply without navigation.
- **`/design` is a conditional route.** In a production build its condition is
  the constant `false`, so the page's code is not in the bundle.

## Pitfalls & gotchas

- Redirects are thrown (`throw redirect(...)`); ESLint allows exactly that type.
- Search params are validated per route (`validateSearch`); read them with
  `route.useSearch()`, never from `window.location`.
- Links inside the app go through the router (`ButtonLink`, `TextLink`, React
  Aria's `Link`), never a plain `<a>`: a page reload locks the data unless the
  device is remembered.
- The header must fit a 320 px screen (folding phones' outer screens): below
  360 px the logo shows the mark alone, its name kept for screen readers.

## How to work with it

Add a route in `router.tsx` under `appRoute` for pages that need the data
key, under `sessionRoute` for signed-in pages that do not, or under
`rootRoute` for public ones, then add it to `routeTree`.

## Related

- [features/auth/](../features/auth/README.md): the session the guards read
- [ui/](../ui/README.md): components and `UIProvider`
