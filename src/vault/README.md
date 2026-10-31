# src/vault/

## Purpose

The state of this browser's key: whether the user has keys yet, whether the
data key is in memory, and every flow that changes that (setup, unlock,
recovery, changing the passphrase, a new recovery key, Lock). It also
encrypts and decrypts records for the rest of the app, so the data key never
leaves this module, and talks to `/api/keys` and `/api/vault`.

Not here: the cryptography itself ([src/crypto](../crypto/README.md)), the
screens ([src/features/unlock](../features/unlock/README.md) and
[src/features/settings](../features/settings/README.md)), and what records
mean (each feature owns its record kind and schema).

## How it works

```
                 ┌──────────── secure context? ── no ──► insecure
start(userId) ───┤
                 └─► GET /api/keys ── none ──► no-keys ── createKeys ──► unlocked (recovery key shown once)
                     │  (meanwhile: ask the other tabs)
                     ├─► a tab answered, check value matches ─────────────► unlocked
                     ├─► device key (IndexedDB) + GET /api/keys/device ────► unlocked (remembered)
                     └─► otherwise ──► locked ── unlock / resetPassphrase ─► unlocked
                                          ▲                                    │
                                          └── Lock, idle, sign-out (every tab) ┘
```

| File             | Role                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `index.ts`       | The public surface and this page's `vault`, wired to the browser              |
| `vault.ts`       | `Vault`: the states and every flow; encrypts and decrypts records             |
| `tabs.ts`        | The BroadcastChannel protocol: handing the key over, the Lock epoch, presence |
| `idle.ts`        | The 15-minute idle lock, decided by clock time shared between tabs            |
| `device-keys.ts` | IndexedDB storage for the "Remember this device" key, and nothing else        |
| `records.ts`     | Read (damaged records included) and write records with revisions              |
| `api.ts`         | `fetch` wrappers for `/api/me`, `/api/keys`, `/api/vault`; `ApiError`         |
| `storage.ts`     | Web Storage that never throws, for the epoch and the activity time            |

The rules each flow keeps are in [`docs/`](docs/):

| Document                                        | Covers                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| [key-states.md](docs/key-states.md)             | States, the start order, setup, unlock, recovery, replacing keys, records |
| [tabs-and-locking.md](docs/tabs-and-locking.md) | One unlock per browser, the Lock epoch, Lock, the idle lock               |

React reads the state with `useVaultState()`; flows are methods on `vault`
(`vault.unlock(passphrase, { remember })`, `vault.lock("lock")`…). Errors are
`CryptoError` (wrong passphrase, not Latin, typo in the recovery key),
`VaultError` (`already-set-up`, `changed-elsewhere`, `wrong-state`) or
`ApiError` (the server's code: `session_not_fresh`, `rate_limited`…).

## Why this way

- **One object owns the data key.** Components never hold it; they call
  `vault.encrypt` and `vault.decrypt`. A Lock that forgets the key in one place
  forgets it everywhere.
- **Dependencies are passed in** (`VaultDeps`: the API, IndexedDB, the tab
  channel, Web Storage, the idle watcher, what to do after a Lock). Unit tests
  run every flow in Node against a fake server with the real API's rules and
  several "tabs" on real BroadcastChannels.
- **Tabs share the key, not a copy on disk.** A new tab gets the
  non-extractable `CryptoKey` from an unlocked one over BroadcastChannel;
  nothing decrypted or secret is written to storage. Rejected: keeping the key
  in sessionStorage or IndexedDB for reloads (anything on disk outlives the
  tab), and a SharedWorker (needs a CSP exception and is missing in some
  mobile browsers).
- **The idle lock compares clock times** rather than running a 15-minute
  timer: timers in background tabs are slowed down, and a sleeping laptop runs
  none. Activity in any tab counts.
- **A Lock reloads the page.** That is the only sure way to drop every
  decrypted value that components, caches and closures still hold.

## Pitfalls & gotchas

- **Verify every data key that arrives from elsewhere** (another tab, the
  device half) with the check value before using it; `accept` and
  `openWithDevice` do. A tab of another account, or a damaged device half,
  must end in the passphrase screen, not in encrypting with a wrong key.
- **A replace can succeed while its answer is lost.** `replaceSlot` treats a
  409 naming the new slot's IV, or a stored slot with that IV after a network
  error, as success. Showing a new recovery key whose slot the server never
  stored would leave the user with a worthless key.
- **The recovery key after setup lives in the state** (`recoveryKey`) until
  `recoveryKeySaved()`, and only in this tab's memory: a reload loses it, by
  design (it is shown once).
- **Argon2 blocks the page** for about a second; flows that run it take an
  `onProgress` callback for the unlock animation (phase 3, step 4).
- **Web Storage and Web Locks can be missing.** Storage then behaves as empty
  (each tab on its own); without Web Locks a new tab waits 300 ms for an
  answer instead of knowing at once that nobody holds the key.

## How to work with it

- Run the unit tests: `npx vitest run --project unit tests/unit/vault`.
- A new record kind: add its plaintext schema in `shared/schemas`, read with
  `readRecords(vault, httpApi, kind, schema)` and write with `writeRecord`,
  retrying once on a 409 `conflict` after reading again (see the settings
  feature for an example).
- Debugging in the browser: the state is `vault.getState()`; the Lock epoch and
  the last activity are in localStorage (`keyworth-lock-epoch`,
  `keyworth-last-activity`); the device key is in IndexedDB (`keyworth` →
  `device-keys`).

## Related

- [src/crypto](../crypto/README.md): the keys, slots and envelopes
- [worker/routes](../../worker/routes/README.md): `/api/keys`, `/api/vault`
- [src/features/unlock](../features/unlock/README.md): the screens for these states
- [tests/unit](../../tests/unit/README.md) and [tests/e2e](../../tests/e2e/README.md)
