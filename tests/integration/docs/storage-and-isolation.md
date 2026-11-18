# Sign-in, storage and isolation tests

What the Worker tests prove about access and stored data. They run inside
workerd (the production runtime) against the local test Postgres, with the
Worker connected as the restricted `keyworth_app` role, and sign users in
through the real Google flow (only Google's token endpoint is replaced).

## What is proven

**The daily cleanup** (`cleanup.test.ts`, through the real `scheduled` handler)

- An expired session is deleted with its remembered device; the account stays,
  and another user's live session and device are untouched.
- A remembered device older than 14 days is deleted while its session keeps
  working; one just under the limit stays.
- Counters older than an hour are deleted from `rate_limit` and
  `api_rate_limits`; newer ones stay.
- Other test files run at the same time on this database, so each test looks only
  at its own rows. No other file ages a row past these limits and then expects it
  to exist.

**Market data** (`market.test.ts`, CoinGecko replaced at `fetch`)

- The snapshot is served as plain digits (`3.55498e-7` becomes
  `0.000000355498`), symbols in upper case, names without control or invisible
  characters; coins with no price, a negative one or a malformed id are left out;
  the logo's location never reaches the browser; the API key goes in its header.
- One call serves every user for 10 minutes, then the next request refreshes it.
- A failing source: an unexpired entry is served with its real age; with nothing
  usable, 502 and exactly one log line, which names neither the asset nor the
  request; past a day nothing is served.
- By id: coins in the snapshot cost no call; the others are asked for together,
  once, and an unknown coin is cached too. Malformed ids and more than 50 are
  refused.
- Search: one call per distinct search whatever its case and spaces, at most 20
  results; empty or over-long searches, and searches with a hidden character or
  a line break, are refused.
- Logos: the small variant, cached a day with `private, max-age=86400`, from
  the snapshot or a search; none for an unseen coin or another host; SVG refused.
- History: the 35 coins Coin Metrics covers take its series through Frankfurter
  (`base=<coin>&quotes=USD&providers=CM`, from a week before the asked day), any other coin
  CoinGecko's past year; a CoinGecko point closes the day before it and its
  current price is left out; one value per day from the asked day, `null` in a
  gap; rows of another pair, not a number, negative or not a real day (including
  9999-12-31 and before 2010-07-18) are left out; an unknown coin has an empty
  history, cached.
- Series loading: earlier days than those cached are asked for on their own
  and added; a long range goes in pieces of a year, newest first, the newest
  open-ended; a request makes at most 30 calls, shared equally between its
  currencies, and the next one goes on from there.
- Series refresh: one call serves every user; a stale series is served at once
  and refreshed after the answer, from a week before its last day (a month back
  at most for a source silent since), keeping the rest; a failing source leaves
  an unexpired series as it is (also when adding earlier days), and with
  nothing usable answers 502 with one log line naming only the source; a
  failed refresh after the answer logs the same line. An answer cut off while
  read counts as a failing source.
- Rates: units per dollar for each currency asked, USDT and USDC from Coin
  Metrics; only the currencies not cached cost a call; USD, unknown or
  lower-case codes, coins and more than 10 are refused, as are a malformed asset
  or day in a history request.
- CoinGecko's data is kept a day at most, Frankfurter's 90 days.
- `market_cache` holds no user id, email or address, for prices, searches,
  history and rates alike.
- The cleanup deletes expired market data and keeps the rest.

**Sign-in and sessions** (`auth.test.ts`)

- Without a session or with a forged cookie: 401.
- An invited user gets a session and `/api/me` returns only their own profile
  and `freshForSeconds` (about 600 right after sign-in, the rest of the 10
  minutes later, 0 after them); the cookie is httpOnly, Secure and SameSite=Lax; no Google tokens and no avatar
  URL are stored; the invite list is case-insensitive.
- A new account records `TERMS_VERSION` and the time, and signing in again
  changes neither; `get-session` does not show them and `update-user` refuses to
  set them (400).
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
  Without the check value, both slots still read as no keys: the slots and
  the check come in one query, joined on the user.
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
  nothing; it is returned 13 days 23 hours after remembering, not 14 days and a
  minute after; Lock and sign-out remove it.
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
- Pages: following `next` returns every record exactly once in creation order,
  by kind or all kinds; a page ends at 1,000 records or after the record that
  crosses 1 MiB of ciphertext; the bytes come back exactly as the browser's own
  base64url encoder writes them, at every length around padding and line
  breaks (Postgres encodes them); a record created while paging comes on a later
  page and an edited one is not repeated; malformed cursors are refused (400).
- **Isolation:** Bob's writes under Alice's record id create his own record;
  Bob cannot update or delete Alice's record; an envelope copied into Bob's vault
  does not decrypt there; a cursor from Alice's pages shows Bob only his own
  records.
- Quotas (record count, storage) answer 413, and hold when six creates arrive
  at once one record below either limit (exactly one succeeds); the write rate
  limit answers 429 with `Retry-After` (the seconds left in the window), resets
  after its window, and covers Lock (`DELETE /api/keys/device`).
- **Deleting several** (`POST /api/vault/delete`): the user's transactions by
  id go and are counted, a settings record named among them stays, an unknown id
  is no error; another user's ids delete nothing of theirs; no list, an empty
  one, a malformed or repeated id, more than 1,000 ids or another field are
  refused (400), as are a body over 48 KB (413), another origin (403) and a
  user past 30 a minute (429), with nothing deleted.
- **A held lock:** while another transaction keeps a user's write lock, that
  user's write is refused as `busy` (429, `Retry-After: 2`) after the 2-second
  wait, and another user's write goes through at once.
- **Batches** (`POST /api/vault/batch`): every record stored at revision 1 and
  each still decrypts; one taken id (a batch sent again after a lost answer)
  writes nothing (409); a bad envelope, an id twice, another kind, an extra
  `userId`, an empty batch or 101 records are refused whole (400), a body over
  128 KB before it is read (413); another origin is refused; a batch that would
  pass the record count or the storage writes nothing (413), and batches and
  single writes arriving at once with room for two leave exactly one through;
  batches have their own limit of 60 a minute, which leaves single writes
  working; a batch lands only in the sender's vault, and the same ids sent by
  another user make that user's own records, which do not decrypt as theirs.

**Each guard's exact condition** (`isolation.test.ts`) — with well-formed but
meaningless bytes, aimed at what a broken guard would let through:

- Bob cannot update (under either kind) or delete Alice's record by its id, and
  the stored row is unchanged; under one id shared by both, an update touches
  only the writer's row. Replacing one's own slots leaves another user's alone.
- Remembered devices: a well-formed but wrong token gets nothing; Bob with
  Alice's device cookie gets nothing and his Lock keeps her row; Lock in one
  session keeps another session's device; remembering again replaces the row
  and the old cookie stops working.
- Every Origin that is not exactly the app's (a trailing slash, upper case, an
  explicit port, http, a longer domain, `null`, empty) is refused on DELETE as
  on PUT, and a Referer alone is not enough; nothing changes.
- A record body over 96 KB: 413. Record writes, remembering a device and
  replacing a slot are each rate-limited; with three writes left in the window,
  exactly three of six simultaneous writes pass. A replaced record's old size
  counts once against the storage limit (same size passes, larger fails,
  smaller passes).

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
deploys that touch sign-in), the browser part of "Remember this device"
([tests/e2e/docs/encryption-flows.md](../../e2e/docs/encryption-flows.md)).

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

Last reviewed: 2026-11-18
