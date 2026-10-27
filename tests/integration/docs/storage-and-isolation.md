# Sign-in, storage and isolation tests

What the Worker tests prove about access and stored data. They run inside
workerd (the production runtime) against the local test Postgres, with the
Worker connected as the restricted `keyworth_app` role, and sign users in
through the real Google flow (only Google's token endpoint is replaced).

## What is proven

**Sign-in and sessions** (`auth.test.ts`)

- Without a session or with a forged cookie: 401.
- An invited user gets a session and `/api/me` returns only their own profile;
  the cookie is httpOnly, Secure and SameSite=Lax; no Google tokens and no avatar
  URL are stored; the invite list is case-insensitive.
- Uninvited and unverified emails are sent to `/sign-in?error=NOT_INVITED` with
  nothing stored; removing an invite stops the next sign-in.
- Sign-out ends the session at once; a cross-site request with the cookie is
  refused (403).
- **Isolation:** deleting Alice's account removes Alice and her sessions while
  Bob keeps working; deletion needs a sign-in from the last 10 minutes; sign-in
  attempts are limited to three per 10 seconds per address.

**User management** (`users.test.ts`): blocking, unblocking, revoking,
uninviting, deleting and listing, as described in
[scripts/docs/user-management.md](../../../scripts/docs/user-management.md).

**Wrapped keys** (`keys.test.ts`) — with slots made by the real `src/crypto`:

- Setup stores both slots and the check value once (409 after), and what comes
  back still opens the data key with the passphrase and passes the check.
- Setup is all or nothing: over a leftover slot it writes nothing (409, no check
  value, no second slot); of three setups sent at once exactly one wins, and
  its slots and check value are the ones stored together.
- Malformed slots and Argon2 settings below OWASP's minimum are refused; Bob
  never sees Alice's keys.
- Writes from another origin or with no origin: 403; oversized bodies: 413; the
  21st key write in a minute: 429.
- Replacing a slot works with a recent sign-in and is refused (403
  `session_not_fresh`) with an older one; a slot that was never set up: 404.
- Replacing names the slot it replaces by its IV: a second writer from the same
  starting point gets 409 with the stored IV, and so does a retry of the
  request that already went through (its own new IV), so a lost answer is
  recognisable; Bob cannot replace Alice's slot even with its IV (404).
- "Remember this device": a session-only, httpOnly, Secure, SameSite=Strict
  `__Host-` cookie; the device slot is returned only to the same session with
  that cookie and opens the data key; another sign-in with the same cookie gets
  nothing; Lock and sign-out remove it.
- Deleting the account removes slots, the check value, records, remembered
  devices and counters (each table is checked to hold something first).

**Encrypted records** (`vault.test.ts`)

- An envelope comes back unchanged and still decrypts.
- **No plaintext anywhere in the database:** every column of the user's records
  and key slots, as text and as raw bytes, is searched for the record's content,
  the passphrase and the recovery key.
- Revisions: an update needs the current revision (409 with the current one
  otherwise); re-creating an existing record is refused; a record cannot change
  its kind (`kind_mismatch`); updating a missing record: 404; a revision the
  32-bit column cannot hold is refused (400), not a 500; an old version written
  back over a newer one is stored but no longer decrypts (`tampered`).
- Listing by kind, deleting once, malformed ids, envelopes and extra plaintext
  fields refused, writes from another origin refused.
- **Isolation:** Bob's writes under Alice's record id create his own record;
  Bob cannot update or delete Alice's record; an envelope copied into Bob's vault
  does not decrypt there.
- Quotas (record count, storage) answer 413, and hold when six creates arrive
  at once one record below either limit (exactly one succeeds); the write rate
  limit answers 429 with `Retry-After` (the seconds left in the window), resets
  after its window, and covers Lock (`DELETE /api/keys/device`).

## Invariants these tests hold

1. Nothing is reachable without a session; the user comes only from it.
2. One user can never read, change or delete another user's data.
3. The database never contains plaintext of records, passphrases or recovery
   keys.
4. Every guard in
   [worker/routes/docs/api-guards.md](../../../worker/routes/docs/api-guards.md)
   answers as documented.

## Deliberately not here

Static headers and the SPA shell (e2e), Google itself (checked by hand on
deploys that touch sign-in), the browser part of "Remember this device" (e2e
with the screens).

## Approach and pitfalls

- Every test signs in its own user (`signedIn()`, `uniqueUser()`: unique email
  and client IP), so tests never share data or rate limits.
- Argon2 runs at OWASP's minimum here (`FAST_KDF`) to keep the suite fast.
- **Requests in this runner keep their database connections until the file
  ends** (they share one isolate). Sending a hundred requests exhausts
  Postgres's connections, so rate limits and quotas are tested by seeding the
  counter or the rows with `query()` and sending one request (races send six
  at once, no more). `compose.yaml` sets `max_connections` to 300 because
  files run in parallel.
- A `beforeAll` warm-up (`setup.ts`) keeps the Worker's cold start out of each
  file's first test.

## Adding a case

```ts
it("refuses a revision from the future", async () => {
  const user = await vaultUser("future");
  const id = crypto.randomUUID();
  await put(user, id, { a: 1 });

  const response = await put(user, id, { a: 2 }, { revision: 5 });

  expect(response.status).toBe(409);
});
```

Last reviewed: 2026-10-27
