# Vault tests

What the unit tests of `src/vault` prove, and how to extend them. They run in
Node, whose WebCrypto, BroadcastChannel and structured clone of `CryptoKey`
behave like the browsers'. That the same flows work in Chromium, Firefox and
WebKit, with IndexedDB and the production CSP, is shown by
`tests/e2e/encryption.spec.ts`.

## Approach

`vault/fake-browser.ts` builds a browser for the tests:

- **A fake server** with the real API's rules: setup once (409 after),
  replacing a slot only by the IV it replaces (409 with the stored IV
  otherwise) and only with a fresh sign-in (403), revisions on records, one
  device half per session. Calls can be made to fail as if offline, or to
  succeed while their answer is lost.
- **Tabs:** each `openTab()` is a `Vault` with its own BroadcastChannel on a
  channel shared by the browser, the browser's localStorage, IndexedDB and Web
  Locks (in-memory fakes), and its own sessionStorage. Passing another tab's
  sessionStorage stands for a reload of that tab.
- `goIdle()` fires a tab's idle lock; the clock logic is tested on its own.
- Argon2 runs with OWASP's minimum (`FAST_KDF`); the sign-in counts as stale
  unless a test sets `freshForSeconds`, so unlocks do not upgrade the slot.

## What is proven

**First sign-in** (`vault.test.ts`)

- No keys → setup → unlocked with the recovery key until it is marked saved.
- A passphrase that is not plain Latin is refused before Argon2.
- When another tab or device set up first: `already-set-up`, locked, and its
  passphrase unlocks. A setup whose answer was lost counts as done; one that
  never reached the server is reported and leaves `no-keys`.

**Unlocking**

- Locked at start; a wrong, too short or non-Latin passphrase fails with the
  right code; the right one unlocks and starts the idle watch.
- A slot that opens next to another account's check value is refused.
- Keys that cannot be loaded give `failed`; retry recovers. An insecure page
  gives `insecure`.

**Tabs**

- A new tab gets the key without the passphrase; unlocking one tab unlocks the
  waiting ones; Lock in one tab locks all (the locking tab reloads, the others
  too); a tab opened after a Lock finds nobody to ask.
- A tab that slept through a Lock locks when it wakes up.
- A tab signed in as another user does not answer.
- An answer on the channel is taken when its key and epoch are right, and
  refused when its epoch predates the latest Lock, when the key is not this
  account's (check value), or when it is extractable, even the right key.

**Remember this device**

- After a reload the vault opens without the passphrase and without the idle
  lock; Lock removes the IndexedDB key and the server half.
- A device key without its server half, and a server half without its key, are
  both dropped.
- A failed remember still unlocks, unremembered, with no key left behind.
- A Lock made offline deletes the server half at the next start.

**Idle lock** (`vault.test.ts`, `idle.test.ts`)

- It locks every tab, and the next start says so once.
- 15 minutes exactly; activity in any tab counts; the first key press after a
  long absence locks instead of extending; activity is written at most every
  10 seconds; unlocking counts as activity.

**Changing keys**

- The recovery key resets a forgotten passphrase (a mistyped key fails first)
  and keeps working; the old passphrase stops working.
- Changing the passphrase needs the current one.
- When another device replaced the passphrase first: `changed-elsewhere`, and
  the vault has reloaded the keys. A change whose answer was lost counts as
  done. Without a fresh sign-in: `session_not_fresh`.
- A new recovery key replaces the old one, which stops working.
- Weaker Argon2 settings are upgraded to the current ones at an unlock only
  when the sign-in is fresh.

**Records and keys at boundaries** (`records.test.ts`)

- Records are stored encrypted (no value in the fake server's rows), read back
  with their revision; a stale revision is refused (409).
- A replayed envelope (served under a later revision) and a value that does not
  match the schema come back as damaged, next to the good record.
- The settings schema keeps fields it does not know.
- IndexedDB storage takes only a non-extractable wrap/unwrap key; the tab
  channel only a non-extractable encrypt/decrypt key.

**The HTTP client** (`api.test.ts`, against a stubbed `fetch`)

- Reading records follows the server's `next` cursor to the last page and
  returns every record in order; a server that repeats a cursor stops the loop
  with an error instead of asking forever.
- Deleting sends `DELETE /api/vault/:id`; a record already gone is an
  `ApiError` 404 `not_found`.

## Not covered here

IndexedDB itself, the real Web Locks, the browser events of the idle watch and
the page reload: they need a browser and are in the e2e tests.

## Adding a case

```ts
it("…", async () => {
  const { b } = await withKeys(); // a user with keys, nobody unlocked
  const tab = b.openTab();
  await tab.vault.start(ALICE);
  await tab.vault.unlock(PASSPHRASE);
  b.server.state.offline.add("forgetDevice"); // make a call fail
  await tab.vault.lock("lock");
  expect(b.server.device).toBeNull();
});
```

Close every tab (the helpers register `closeAll` for `afterEach`), or open
BroadcastChannels keep the test process alive.

Last reviewed: 2026-11-08
