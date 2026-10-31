# src/routes/

## Purpose

The app's pages and how they connect: the route tree, the signed-in layout,
and the pages that belong to no feature (home, not found).

## How it works

| File                        | Role                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `router.tsx`                | Every route, declared in code, and the router factory           |
| `AppShell.tsx`              | The signed-in frame: header (mark, theme, settings) and content |
| `HomePage.tsx`              | The signed-in start page (a placeholder until the portfolio)    |
| `NotFoundPage.tsx`          | Any unknown path                                                |
| `KdfBenchmarkPage.tsx`      | `/design/kdf`: times Argon2id on this device (developer tool)   |
| `EncryptionMockupsPage.tsx` | `/design/encryption`: every state of the encryption screens     |

```
/            ┐ app layout: no session → redirect to /sign-in
/settings    ┘
/sign-in       a session → redirect to /
/privacy, /terms
/design        only in dev and design builds
/design/kdf    the same; Argon2id timing (see src/crypto/README.md)
/design/encryption  the same; the encryption screens in every state, with a
               switcher (`?screen=<id>` opens one, `&bare` hides the switcher)
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
- **`/design` is a conditional route.** In a production build its condition is
  the constant `false`, so the page's code is not in the bundle.

## Pitfalls & gotchas

- Redirects are thrown (`throw redirect(...)`); ESLint allows exactly that type.
- Search params are validated per route (`validateSearch`); read them with
  `route.useSearch()`, never from `window.location`.

## How to work with it

Add a route in `router.tsx` under `appRoute` for signed-in pages or under
`rootRoute` for public ones, then add it to `routeTree`.

## Related

- [features/auth/](../features/auth/README.md): the session the guards read
- [ui/](../ui/README.md): components and `UIProvider`
