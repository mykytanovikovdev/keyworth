# Tabs and locking

One unlock per browser, and one Lock for all of it. Code: `tabs.ts`, `idle.ts`,
`vault.ts` (`lock`, `lockedElsewhere`, `offer`, `accept`).

## Handing the key between tabs

All tabs of the origin share a BroadcastChannel (`keyworth-vault`). The data
key travels as a `CryptoKey` (structured clone): it stays non-extractable, and
nothing is written to storage. Messages:

| Message    | From                | Carries                                                            |
| ---------- | ------------------- | ------------------------------------------------------------------ |
| `need-key` | a starting tab      | a random nonce, the user id                                        |
| `key`      | an unlocked tab     | the nonce, the user id, the Lock epoch, the key, remembered or not |
| `unlocked` | a tab that unlocked | the user id, the epoch: locked tabs ask now                        |
| `locked`   | a tab that locked   | the new epoch, the reason                                          |

- **Answering:** only an unlocked tab of the same user, and only if it unlocked
  in the current epoch.
- **Taking an answer:** the nonce, the user id and the current epoch must
  match, the key must be a non-extractable AES-GCM key for encrypt and decrypt,
  and then the vault checks it against the account's check value. Every field
  of every message is validated: another version of the app, or another tab of
  the origin, may send anything.
- **Who could answer:** each unlocked tab holds a shared Web Lock named
  `keyworth-unlocked:<userId>`. A starting tab looks with
  `navigator.locks.query()`: nobody holds it, so it does not wait; someone
  does, so it waits up to 2 seconds for the answer. Without Web Locks it waits
  300 ms.
- **Unlocking one tab unlocks the others:** the `unlocked` message makes locked
  tabs of that user ask for the key.

## The Lock epoch

A counter in localStorage (`keyworth-lock-epoch`). Every Lock increments it
before anything else. A tab remembers the epoch it unlocked in and stops
answering once the counter moves; an answer carrying an older epoch is refused.
This closes the race where a tab that has not yet heard of a Lock hands the key
to a new tab. A tab that could not hear (frozen in the background, or a page
restored from the back-forward cache) compares the epoch when it wakes up
(`pageshow` with `persisted`, `resume`, becoming visible) and locks if it moved
(`vault.wake()`).

## Lock

`vault.lock(reason)`, in this order:

1. Epoch + 1 and the `locked` message: no tab hands the key out any more, and
   every tab forgets it.
2. The data key leaves memory; the idle watch stops; the presence lock is
   released.
3. The device key is removed from IndexedDB.
4. If the device was remembered: `DELETE /api/keys/device` (the row and the
   cookie). Offline, a note in localStorage repeats it at the next start.
5. The page reloads, so nothing decrypted remains in components, caches or
   closures. Signing out and leaving for a fresh Google sign-in navigate away
   instead.

| Reason           | When                                   | This tab after      |
| ---------------- | -------------------------------------- | ------------------- |
| `lock`           | The Lock button                        | Reload              |
| `idle`           | 15 minutes without activity in any tab | Reload, with a note |
| `sign-out`       | Sign out, sign out everywhere          | To the sign-in page |
| `reauthenticate` | "Sign in again" before replacing a key | To Google           |

Other tabs always reload; after `sign-out` that leads them to the sign-in page.

## The idle lock

Only when the device is not remembered (the owner's rule: a remembered device
stays open until Lock, sign-out, the browser closing or 14 days).

- Activity (pointer down, key down, wheel, touch) in any tab writes the time to
  localStorage (`keyworth-last-activity`), at most every 10 seconds.
- Each unlocked tab checks every 30 seconds, and whenever it becomes visible
  or focused, whether 15 minutes have passed since that time. Background
  timers may be slowed and a sleeping laptop runs none, so the visibility
  check is what catches a return after a long break.
- Activity is checked **before** it counts: the first key press after 20
  minutes away locks instead of extending.
- The tab that notices locks every tab. After the reload the unlock screen
  says "Locked after 15 minutes without activity" once.

## Invariants

1. Nothing secret or decrypted is written to Web Storage; the epoch and the
   activity time are the only values there, and they reveal nothing.
2. After a Lock in any tab, no tab answers with the old key, and no answer made
   before it is taken.
3. A key received from another tab is used only after the check value.
4. Lock removes both halves of a remembered device.

## How it is tested

Unit (`tests/unit/vault/vault.test.ts`, `idle.test.ts`): handing over, a tab of
another account not answering, answers with an old epoch, a foreign key or an
extractable key refused, Lock and idle reaching every tab, unlock reaching
waiting tabs. In real browsers (`tests/e2e/encryption.spec.ts`): handing the
key to a second tab and Lock across tabs in Chromium, Firefox and WebKit.

## How to change it safely

- A new message type must be validated in `parseMessage` like the others.
- Never answer `need-key` from a tab that is not unlocked in the current epoch.
- Anything new kept in Web Storage must be as harmless as a counter: no keys,
  no data, nothing derived from either.

Last reviewed: 2026-10-31
