# src/routes/

## Purpose

The app's pages and how they connect: the route tree, the signed-in layouts,
and the pages that belong to no feature (not found, the dev-only mockups).

## How it works

| File                             | Role                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `router.tsx`                     | Every route, declared in code, and the router factory                                                        |
| `pages.ts`                       | The pages loaded on first use, and the sections' code fetched ahead                                          |
| `AppShell.tsx`                   | Behind the key gate: `AppFrame` around the page, its menu item picked from the address                       |
| `AppFrame.tsx`                   | The frame: the menu in a left column, behind a button in a one-line bar on narrow screens                    |
| `/` → `PortfolioPage`            | The signed-in start page ([src/features/portfolio](../features/portfolio/README.md))                         |
| `/transactions`                  | The transactions and their form ([src/features/transactions](../features/transactions/README.md))            |
| `/chat`, `/chat/<id>`            | A new chat and a kept one ([src/features/chat](../features/chat/README.md)); their code is not fetched ahead |
| `NotFoundPage.tsx`               | Any unknown path                                                                                             |
| `KdfBenchmarkPage.tsx`           | `/design/kdf`: Argon2id timing on this device, and why it is slow (developer tool)                           |
| `EncryptionMockupsPage.tsx`      | `/design/encryption`: every state of the encryption screens; "try it" with real Argon2                       |
| `TransactionsMockupsPage.tsx`    | `/design/transactions`: the transactions screens in every state                                              |
| `PortfolioMockupsPage.tsx`       | `/design/portfolio`: the portfolio page in every state, from made-up transactions                            |
| `ChatMockupsPage.tsx`            | `/design/chat`: the chat in every state, and Settings with "Delete all chats"                                |
| `MockFrame.tsx`, `mock-chats.ts` | The mockups' frame: `AppFrame` with made-up chats, shared by every mockup page                               |

```
             ┌ session layout: no session → redirect to /sign-in
/            │ ┐ app layout: the key gate (create a passphrase, unlock)
/transactions│ │
/chat        │ │   a new chat
/chat/<id>   │ │   a kept one (the same route: `/chat/{-$chatId}`)
/settings    │ ┘   ?then=change-passphrase | new-recovery-key | delete-account
/recover     └   outside the gate: a forgotten passphrase
/sign-in       a session → redirect to /
/privacy, /terms
/design        only in dev and design builds
/design/kdf    the same; Argon2id timing (see src/crypto/README.md)
/design/encryption  the same; the encryption screens in every state, with a
               switcher (`?screen=<id>` opens one, `&bare` hides the switcher,
               Replay starts a "try it" screen over)
/design/transactions, /design/portfolio, /design/chat  the same; mockups
               with a switcher, all in the app's frame
```

`src/App.tsx` creates the query client and the router, and passes the router's
`navigate` to `UIProvider`, so React Aria links navigate without page loads.

## Why this way

- **Routes in code, not file-based.** A handful of routes, fully typed, with no
  generator and no generated file to keep in sync. Switching to file-based
  routing later is mechanical.
- **Pages load on first use.** Every page is its own chunk
  (`lazyRouteComponent`), and `package.json` lists the only files with
  import-time effects in `"sideEffects"`, so the build can leave unused
  components of the `src/ui` barrel out of the first chunk. The first load went
  from 298 to 224 kB (gzip): the sign-in and unlock screens no longer carry the
  portfolio, the transaction form and its fields.
- **The router waits for a page's code, and the sections' code comes ahead.**
  A lazy page's `preload` makes the router keep the current page until the
  next one's code is in, so a switch never shows an empty frame. Once the app's
  frame is up (still on the unlock screen, usually), `AppShell` fetches the
  Portfolio, Transactions and Settings code in the background
  (`preloadSections`): code only, no data, and little of it (from the start
  page, about 8 kB gzip: the rest is shared with the portfolio). The first
  switch to a section is then instant, and the first load is not slower. The
  chat is left out: its chunk carries the AI SDK and a markdown parser (about
  160 kB gzip), for those who open it.
- **Guards decide pages, not access.** `beforeLoad` redirects based on the
  cached session, but the Worker checks the session on every API request; a
  page that slipped through would get no data.
- **The key gate is a component, not a redirect**
  ([features/unlock/VaultGate.tsx](../features/unlock/VaultGate.tsx)): the
  address stays, so unlocking on `/settings` lands on `/settings`, and the
  vault's state changes (Lock in another tab) apply without navigation.
- **The menu is a column, not a header** (the chat's frame, approved as a
  mockup on 2026-11-14): on wide screens a left column, below 1024 px a
  one-line bar whose button opens the same menu in a `Drawer`. A header with
  sections took two rows on phones. The theme is chosen in Settings only. The
  chat's part of the menu is New chat, which starts the conversation over
  (`chatSession.startOver`, light enough for the frame), and the list of kept
  chats (`features/chat/useChats.ts`, under the key gate: it needs the data
  key). The mockups pass made-up chats.
- **`/design` is a conditional route.** In a production build its condition is
  the constant `false`, so the page's code is not in the bundle.

## Pitfalls & gotchas

- **A module that must run on import goes into `"sideEffects"`** in
  `package.json` (today: the CSS, `src/main.tsx`, `src/vault/index.ts`'s page
  listeners, `shared/schemas/zod.ts`'s jitless switch). Otherwise the build may
  drop it whenever nothing uses its exports. Measure with `npm run
bundle:size`.
- Redirects are thrown (`throw redirect(...)`); ESLint allows exactly that type.
- Search params are validated per route (`validateSearch`); read them with
  `route.useSearch()`, never from `window.location`.
- **A lazy page that takes props** (Settings, sign-in and Transactions, whose
  `?import=true` opens the import, take the search) is
  rendered by a small route component, which the router cannot see into: wrap
  it in `waitingFor(page, component)` (`pages.ts`), or the router switches at
  once and shows an empty page until the code arrives. A plain `React.lazy`
  page has the same problem. The e2e test holds the Settings code back to
  prove the wait.
- Links inside the app go through the router (`ButtonLink`, `TextLink`, React
  Aria's `Link`), never a plain `<a>`: a page reload locks the data unless the
  device is remembered.
- The frame must fit a 320 px screen (folding phones' outer screens): the bar
  holds the menu button and the name only. Any navigation, from the menu or
  not, closes the phone menu: it remembers the address it was opened on.

## How to work with it

Add a route in `router.tsx` under `appRoute` for pages that need the data
key, under `sessionRoute` for signed-in pages that do not, or under
`rootRoute` for public ones, then add it to `routeTree`.

## Related

- [features/auth/](../features/auth/README.md): the session the guards read
- [ui/](../ui/README.md): components and `UIProvider`
