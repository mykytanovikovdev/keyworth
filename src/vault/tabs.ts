import type { KeyValueStore } from "./storage.ts";

/*
 * One unlock per browser: tabs of the same origin hand the data key to each
 * other over a BroadcastChannel (structured clone keeps the CryptoKey
 * non-extractable), and Lock reaches every tab. See docs/tabs.md.
 *
 * - A tab that starts asks "need-key" with a random nonce and its user id; an
 *   unlocked tab of that user answers with the key, the nonce and the Lock
 *   epoch. The asking tab takes the first answer whose nonce, user and epoch
 *   match, and the vault still verifies the key against the account's check
 *   value before using it.
 * - The Lock epoch is a counter in localStorage. Every Lock bumps it and tells
 *   the other tabs; an answer made before the latest Lock is refused, and a tab
 *   that was asleep (bfcache, a frozen background tab) compares the epoch when
 *   it wakes up.
 * - Unlocked tabs hold a shared Web Lock named after their user, so a new tab
 *   knows at once whether anyone could answer, instead of always waiting.
 */

export type LockReason =
  /** The Lock button, in any tab. */
  | "lock"
  /** 15 minutes without activity in any tab. */
  | "idle"
  /** Signing out, or out everywhere. */
  | "sign-out"
  /** Leaving for a fresh Google sign-in, which starts a new session. */
  | "reauthenticate";

const LOCK_REASONS: readonly string[] = [
  "lock",
  "idle",
  "sign-out",
  "reauthenticate",
];

export interface KeyOffer {
  dataKey: CryptoKey;
  /** The browser remembers this device (no idle lock). */
  remembered: boolean;
}

type TabMessage =
  | { type: "need-key"; nonce: string; userId: string }
  | {
      type: "key";
      nonce: string;
      userId: string;
      epoch: number;
      dataKey: CryptoKey;
      remembered: boolean;
    }
  | { type: "unlocked"; userId: string; epoch: number }
  | { type: "locked"; epoch: number; reason: LockReason };

export interface Tabs {
  /** The current Lock epoch, shared by every tab. */
  epoch(): number;
  /**
   * Asks the unlocked tabs of this user for the data key; null if none
   * answers. `announced`: a tab just said it unlocked, so someone will answer.
   */
  requestKey(
    userId: string,
    options?: { announced?: boolean },
  ): Promise<KeyOffer | null>;
  /** How this tab answers "need-key": an offer, or null to stay silent. */
  serve(offer: (userId: string) => KeyOffer | null): void;
  /** Tells locked tabs of this user that they can ask now, and marks this tab as unlocked. */
  announceUnlocked(userId: string): void;
  /** Bumps the epoch and tells every tab; returns the new epoch. */
  announceLocked(reason: LockReason): number;
  /** This tab no longer holds a key (it locked, or another tab locked it). */
  leave(): void;
  onLocked(listener: (reason: LockReason) => void): () => void;
  onUnlocked(listener: (userId: string) => void): () => void;
  close(): void;
}

const EPOCH_KEY = "keyworth-lock-epoch";
/** Waiting for an answer when another tab holds the key, which is the only case we wait. */
const ANSWER_MS = 2000;
/** Without Web Locks we cannot know whether anyone could answer: wait briefly. */
const BLIND_ANSWER_MS = 300;

const presenceLock = (userId: string) => `keyworth-unlocked:${userId}`;

/** A data key as src/crypto makes it: AES-GCM, non-extractable, encrypt and decrypt. */
export function isDataKey(value: unknown): value is CryptoKey {
  if (!(value instanceof CryptoKey)) return false;
  const usages = [...value.usages].sort();
  return (
    value.type === "secret" &&
    value.algorithm.name === "AES-GCM" &&
    !value.extractable &&
    usages.length === 2 &&
    usages[0] === "decrypt" &&
    usages[1] === "encrypt"
  );
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const isEpoch = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Messages come from other tabs of this origin, possibly another app version: check every field. */
function parseMessage(data: unknown): TabMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case "need-key":
      return isText(message.nonce) && isText(message.userId)
        ? { type: "need-key", nonce: message.nonce, userId: message.userId }
        : null;
    case "key":
      return isText(message.nonce) &&
        isText(message.userId) &&
        isEpoch(message.epoch) &&
        isDataKey(message.dataKey) &&
        typeof message.remembered === "boolean"
        ? {
            type: "key",
            nonce: message.nonce,
            userId: message.userId,
            epoch: message.epoch,
            dataKey: message.dataKey,
            remembered: message.remembered,
          }
        : null;
    case "unlocked":
      return isText(message.userId) && isEpoch(message.epoch)
        ? { type: "unlocked", userId: message.userId, epoch: message.epoch }
        : null;
    case "locked":
      return isEpoch(message.epoch) &&
        typeof message.reason === "string" &&
        LOCK_REASONS.includes(message.reason)
        ? {
            type: "locked",
            epoch: message.epoch,
            reason: message.reason as LockReason,
          }
        : null;
    default:
      return null;
  }
}

export function createTabs({
  store,
  channelName = "keyworth-vault",
  locks = (globalThis.navigator as Navigator | undefined)?.locks,
}: {
  /** localStorage in the browser: shared by all tabs. */
  store: KeyValueStore;
  channelName?: string;
  locks?: LockManager | undefined;
}): Tabs {
  const channel = new BroadcastChannel(channelName);
  const lockedListeners = new Set<(reason: LockReason) => void>();
  const unlockedListeners = new Set<(userId: string) => void>();
  const waiting = new Map<string, (offer: KeyOffer | null) => void>();
  let offer: (userId: string) => KeyOffer | null = () => null;
  let presence: { release: (() => void) | null; dropped: boolean } | null =
    null;

  const epoch = () => {
    const stored = Number(store.get(EPOCH_KEY));
    return isEpoch(stored) ? stored : 0;
  };
  const post = (message: TabMessage) => {
    channel.postMessage(message);
  };

  channel.onmessage = (event: MessageEvent) => {
    const message = parseMessage(event.data);
    if (!message) return;
    switch (message.type) {
      case "need-key": {
        const answer = offer(message.userId);
        if (answer) {
          post({
            type: "key",
            nonce: message.nonce,
            userId: message.userId,
            epoch: epoch(),
            dataKey: answer.dataKey,
            remembered: answer.remembered,
          });
        }
        return;
      }
      case "key": {
        const resolve = waiting.get(message.nonce);
        // Made before the latest Lock: the answering tab had not heard of it yet.
        if (resolve && message.epoch === epoch()) {
          resolve({ dataKey: message.dataKey, remembered: message.remembered });
        }
        return;
      }
      case "unlocked":
        if (message.epoch === epoch()) {
          for (const listener of unlockedListeners) listener(message.userId);
        }
        return;
      case "locked":
        for (const listener of lockedListeners) listener(message.reason);
        return;
    }
  };

  // Held from unlock to lock; a request granted after leave() lets go at once.
  function holdPresence(userId: string) {
    dropPresence();
    if (!locks) return;
    const held: NonNullable<typeof presence> = {
      release: null,
      dropped: false,
    };
    presence = held;
    void locks
      .request(presenceLock(userId), { mode: "shared" }, () =>
        held.dropped
          ? undefined
          : new Promise<void>((resolve) => {
              held.release = resolve;
            }),
      )
      .catch(() => undefined);
  }

  function dropPresence() {
    if (!presence) return;
    presence.dropped = true;
    presence.release?.();
    presence = null;
  }

  async function anyoneUnlocked(userId: string): Promise<boolean | null> {
    if (!locks) return null;
    try {
      // A lock requested a moment ago may not be granted yet: count those too.
      const { held = [], pending = [] } = await locks.query();
      return [...held, ...pending].some(
        (lock) => lock.name === presenceLock(userId),
      );
    } catch {
      return null;
    }
  }

  return {
    epoch,
    async requestKey(userId, { announced = false } = {}) {
      const present = announced || (await anyoneUnlocked(userId));
      if (present === false) return null;
      const nonce = crypto.randomUUID();
      return new Promise<KeyOffer | null>((resolve) => {
        const timer = setTimeout(
          () => {
            waiting.delete(nonce);
            resolve(null);
          },
          present ? ANSWER_MS : BLIND_ANSWER_MS,
        );
        waiting.set(nonce, (answer) => {
          clearTimeout(timer);
          waiting.delete(nonce);
          resolve(answer);
        });
        post({ type: "need-key", nonce, userId });
      });
    },
    serve(provider) {
      offer = provider;
    },
    announceUnlocked(userId) {
      holdPresence(userId);
      post({ type: "unlocked", userId, epoch: epoch() });
    },
    announceLocked(reason) {
      const next = epoch() + 1;
      store.set(EPOCH_KEY, String(next));
      post({ type: "locked", epoch: next, reason });
      return next;
    },
    leave: dropPresence,
    onLocked(listener) {
      lockedListeners.add(listener);
      return () => {
        lockedListeners.delete(listener);
      };
    },
    onUnlocked(listener) {
      unlockedListeners.add(listener);
      return () => {
        unlockedListeners.delete(listener);
      };
    },
    close() {
      dropPresence();
      channel.close();
      for (const resolve of [...waiting.values()]) resolve(null);
    },
  };
}
