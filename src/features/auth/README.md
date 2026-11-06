# src/features/auth/

## Purpose

Signing in from the browser: the sign-in page, Better Auth's client, and the
cached session the rest of the app reads. Who may sign in, and how sessions are
stored and checked, is decided by the server ([worker/README.md](../../../worker/README.md));
this folder only starts the flow and shows its outcome.

## How it works

| File             | Role                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| `client.ts`      | Better Auth client, `sessionQuery` (TanStack Query), `signInWithGoogle()` |
| `SignInPage.tsx` | "Continue with Google", error messages, links to the terms and privacy    |
| `useSignOut.ts`  | Sign out here or everywhere, then lock every tab of this browser          |

1. "Continue with Google" calls `signInWithGoogle()`: the client asks the
   Worker for Google's URL and the browser leaves for Google.
2. Google sends the browser back to the Worker's callback, which redirects to
   `/` on success or to `/sign-in?error=CODE` on refusal.
3. Routes read `sessionQuery`: signed-in pages redirect to `/sign-in` without a
   session, and `/sign-in` redirects to `/` with one (`src/routes/router.tsx`).
4. Sign-out and account deletion set the cached session to `null` before
   navigating, so no stale page flashes. Then the vault locks every tab of the
   browser and forgets the device key (`useSignOut`); the other tabs reload
   into the sign-in page. "Sign out everywhere" is Better Auth's
   `revokeSessions`: every session ends, and every remembered device with it.

## Why this way

- **Error text comes from known codes only.** The URL carries `?error=CODE`
  (and Better Auth may add `error_description`), but the page never renders
  URL text: a crafted link cannot put words on the sign-in screen. Unknown
  codes, such as Google's `access_denied` when the user cancels, get a generic
  message.
- **One session cache.** TanStack Query holds the session for the router, the
  header and settings, refreshed every five minutes. The server still checks
  the session on every API call; the cache only decides which page to show.
- **No Google avatar.** The CSP allows images from our own origin only, and the
  server does not even store the avatar URL.
- **The line about the terms sits right under the button, in readable text.** A
  sign-in page binds someone to its terms only if they could not miss the notice,
  so it is not fine print at the bottom. Continuing is the acceptance, and the
  server records it (`worker/docs/auth-and-sessions.md`). No checkbox: signing in
  stays one click.
- **The Google mark is a static file** (`public/google-g.svg`), so brand colors
  stay out of components, which use only design tokens.

## Pitfalls & gotchas

- The sign-in redirect goes through `window.location`, so Playwright tests stop
  it with `page.route("https://accounts.google.com/**")`.
- Signing in with real Google locally needs a real OAuth client in `.dev.vars`
  and `http://localhost:5173/api/auth/callback/google` registered on it.
- Better Auth's client also listens for focus and broadcasts session changes to
  other tabs; the app still reads the session through `sessionQuery`.

## How to work with it

- New error code from the server: add its text to `errorMessages` in
  `SignInPage.tsx` and a test in `tests/e2e/auth.spec.ts`.
- Need the user in a component: `useSuspenseQuery(sessionQuery)` under the
  signed-in layout, where the session is guaranteed.

## Related

- [worker/](../../../worker/README.md): sign-in on the server, invite list, sessions
- [settings/](../settings/README.md): sign-out and account deletion
- [tests/e2e/](../../../tests/e2e/README.md): sign-in and signed-in flows in three browsers
