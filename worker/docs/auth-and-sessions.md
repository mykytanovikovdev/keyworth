# Sign-in, sessions and access

Who can use Keyworth, how they sign in, how a session is checked, and what it
takes to delete an account. Code: `auth.ts`, `index.ts` (`requireSession`),
`limits.ts` (`requireFreshSession`); the invite and block lists: `db/schema.ts`
and `scripts/user-admin.ts`.

## How it works

1. The SPA asks `POST /api/auth/sign-in/social` for Google's URL. Better Auth
   stores the OAuth state and sends the browser to Google, which shows its
   account chooser (scopes `openid email profile`).
2. Google redirects back to `/api/auth/callback/google`. Better Auth exchanges
   the code for the user's profile, then the database hooks in `auth.ts`
   decide, each with one query (`maySignIn`):

   - **creating a user:** the email must be verified by Google, on the invite
     list (`allowed_emails`) and not blocked (`blocked_emails`);
   - **creating a session (every sign-in):** the account's email must still be
     invited and not blocked.

   A refusal throws an `APIError` with the code `NOT_INVITED`, so the callback
   redirects to `/sign-in?error=NOT_INVITED`; a blocked email gets exactly the
   same answer.

3. Accepted: a session row and a signed cookie
   `__Secure-better-auth.session_token` (httpOnly, Secure, SameSite=Lax), then
   a redirect to the app.
4. Every other `/api/*` request goes through `requireSession`: the session is
   read from the cookie **and the database** (no cookie cache), and the user id
   comes only from there — never from a body, URL or model output. No session:
   401, even for paths that do not exist. The session row and its user come in
   one query (`advanced.database.joins`, through the relations in
   `db/auth-schema.ts`).
5. Writes to the app's own routes also need the app's `Origin` (403
   otherwise); Better Auth checks `Origin` on its own routes.

**Sessions** last 7 days and are extended once a day while used (Better Auth's
defaults). Signing out deletes the session row; the next request is
unauthenticated. An expired row goes when Better Auth next sees its cookie, or
with the daily cleanup ([db/docs/data-inventory.md](../db/docs/data-inventory.md)).

**Account deletion** (`POST /api/auth/delete-user`) needs a session created in
the last 10 minutes (`freshAge`); an older one gets `400 SESSION_EXPIRED`, and
the client asks the user to sign in with Google again. Deleting the user
cascades to sessions, the Google link, wrapped keys, encrypted records,
remembered devices and counters. Replacing a wrapped key (`PUT /api/keys/*`)
needs the same fresh sign-in (403 `session_not_fresh`).

**What is stored from Google:** name and email only. The account hooks drop
Google's access, refresh and ID tokens before saving, and the user hook drops
the avatar URL.

**Accepting the terms:** the sign-in page says that continuing accepts them,
and the user hook writes `terms_version` (`TERMS_VERSION` from
`shared/legal.ts`) and `terms_accepted_at` in the insert that creates the
account. Later sign-ins change nothing. The fields are `input: false` and
`returned: false`: no client can set them and no auth response shows them.
Accounts older than these columns have them null, because their acceptance was
never recorded and a date made up afterwards would prove nothing.

**Rate limits:** Better Auth's own, stored in Postgres (`rate_limit`), per
client IP from `cf-connecting-ip` (set by Cloudflare, not spoofable by the
client): 100 requests per 10 seconds, and 3 per 10 seconds on `/sign-in*`.
Reading the session (`GET /api/auth/get-session`, on every start of the app)
is not counted: it only reads, a forged cookie fails its signature before any
query, and the app's own routes check the session without a limit too.
Counting it cost a read and a write of the counter each time.
The app's own routes have their limits in
[routes/docs/api-guards.md](../routes/docs/api-guards.md).

**Telemetry** of Better Auth is off.

## Invariants

1. Nobody gets an account or a session without a Google-verified email that is
   invited and not blocked — checked at account creation **and** every sign-in.
2. The user id comes only from the session.
3. Every route after `requireSession` returns 401 without a valid session row.
4. Destructive account actions need a sign-in from the last 10 minutes.
5. No Google tokens and no avatar URL are ever stored.
6. Every account created since the terms record exists has it, written once by
   the server.

## Decisions and alternatives

- **The terms record is two columns on `user`, not a table:** a hook that
  changes the user's insert cannot leave an account without its record, while
  a table would be written by an `after` hook, which runs after the transaction
  and can fail on its own. The record goes with the account: deleting an account
  keeps nothing about it.

- **Better Auth:** runs on Workers with Hono, keeps sessions in our database
  (revocable at once), brings CSRF origin checks and rate limiting. Rejected:
  hand-written OAuth and sessions (easy to get subtly wrong), Lucia (deprecated
  by its author).
- **Google only, invite list in the database:** the closed beta needs no
  passwords to manage; emails are personal data and never in code.
- **Database sessions, no cookie cache:** revocation (sign-out, deletion,
  `npm run users -- revoke`) takes effect on the next request, at the cost of
  one query per request. That query joins the user to the session: without
  joins, Better Auth reads them in two queries one after the other, a second
  round trip to the database on every request.
- **A fresh auth instance per request** (`createAuth(db, env)`): bindings and
  secrets arrive with each request in Workers.
- **Blocked emails see "not invited":** nothing confirms to that person that
  they were singled out.
- **`Referrer-Policy: same-origin` on the page:** with `no-referrer`, browsers
  send `Origin: null` on same-origin POSTs and Better Auth's origin check would
  refuse sign-in and sign-out.

## Edge cases and failure modes

- **A hook refusal without a `code`** makes the callback answer with JSON
  instead of redirecting — always throw `APIError` with a code.
- **`BETTER_AUTH_URL` must be the origin the browser uses:** Better Auth builds
  the redirect URI and its trusted origin from it (production:
  `https://keyworth.app`; local: set in `.dev.vars`).
- **Local previews rewrite `Origin`** unless started with `--local-upstream`
  (the `preview` scripts do); otherwise every POST with the session cookie
  fails with `403 INVALID_ORIGIN`.
- **Removing an invite by hand** stops the next sign-in only; `npm run users --
uninvite` or `block` also ends open sessions.
- **Google's app is in Testing mode:** a new user must also be added to its test
  users, or Google itself refuses the sign-in.

## How it is tested

`tests/integration/auth.test.ts` (real OAuth flow with Google's token endpoint
replaced; invite list, unverified emails, cookie flags, no tokens stored,
sign-out, CSRF, deletion and freshness, sign-in rate limit, session reads not
counted),
`tests/integration/users.test.ts` (block, revoke, uninvite, delete) and
`tests/e2e/auth.spec.ts` (the pages). See
[tests/integration/docs/storage-and-isolation.md](../../tests/integration/docs/storage-and-isolation.md).

## How to change it safely

Any new route goes after `requireSession` unless it is deliberately public
(with a comment). Any new hook refusal needs a code and a test through the real
callback. Changing session lifetime or freshness changes the threat model:
update [src/crypto/docs/threat-model.md](../../src/crypto/docs/threat-model.md).

Last reviewed: 2026-11-18
