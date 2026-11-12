import type { DeviceSlotJson, KeysJson } from "../../../shared/schemas/keys.ts";
import type { RecordKind, VaultWrite } from "../../../shared/schemas/vault.ts";
import { ApiError, type VaultApi } from "../../../src/vault/api.ts";
import {
  type DeviceKeyStore,
  isDeviceKey,
} from "../../../src/vault/device-keys.ts";
import type { KeyValueStore } from "../../../src/vault/storage.ts";
import { createTabs, type LockReason } from "../../../src/vault/tabs.ts";
import { Vault } from "../../../src/vault/vault.ts";
import { ALICE, FAST_KDF } from "../crypto/fixtures.ts";

/*
 * A browser for vault tests: a fake server with the same rules as the real
 * API (one-time setup, replace by IV, revisions, a device half per session),
 * the storage every tab shares, and real BroadcastChannels, so several Vault
 * objects behave like tabs of one browser.
 */

/** localStorage or sessionStorage, in memory. */
export function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}

/** IndexedDB, in memory, with the same check on what it may store. */
function memoryDeviceKeys(): DeviceKeyStore & {
  keys: Map<string, CryptoKey>;
} {
  const keys = new Map<string, CryptoKey>();
  return {
    keys,
    load: (userId) => Promise.resolve(keys.get(userId) ?? null),
    save(userId, key) {
      if (!isDeviceKey(key)) {
        return Promise.reject(
          new Error("Only a non-extractable device key may be stored."),
        );
      }
      keys.set(userId, key);
      return Promise.resolve();
    },
    remove(userId) {
      keys.delete(userId);
      return Promise.resolve();
    },
  };
}

interface StoredRecordRow {
  kind: RecordKind;
  revision: number;
  envelope: VaultWrite["envelope"];
}

export function fakeServer(userId = ALICE) {
  let keys: KeysJson["keys"] = null;
  let device: DeviceSlotJson | null = null;
  const records = new Map<string, StoredRecordRow>();
  const state = {
    /**
     * Seconds the session still counts as a recent sign-in: none by default,
     * as for most unlocks. Tests that replace a slot set it first.
     */
    freshForSeconds: 0,
    /** Calls that fail as if the network dropped. */
    offline: new Set<keyof VaultApi>(),
    /** Calls that reach the server but whose answer is lost. */
    answerLost: new Set<keyof VaultApi>(),
    calls: [] as (keyof VaultApi)[],
  };
  const copy = <T>(value: T): T => structuredClone(value);
  const call = async <T>(
    name: keyof VaultApi,
    run: () => T | Promise<T>,
  ): Promise<T> => {
    state.calls.push(name);
    if (state.offline.has(name)) throw new TypeError("Failed to fetch");
    const result = await run();
    if (state.answerLost.has(name)) throw new TypeError("Failed to fetch");
    return result;
  };
  const replace = (kind: "passphrase" | "recovery", expectedIv: string) => {
    if (!keys) throw new ApiError(404, { error: "not_set_up" });
    if (state.freshForSeconds === 0) {
      throw new ApiError(403, { error: "session_not_fresh" });
    }
    if (keys[kind].iv !== expectedIv) {
      throw new ApiError(409, { error: "conflict", iv: keys[kind].iv });
    }
    return keys;
  };
  const api: VaultApi = {
    me: () =>
      call("me", () => ({
        id: userId,
        name: "Alice Example",
        email: "alice@example.com",
        freshForSeconds: state.freshForSeconds,
      })),
    keys: () => call("keys", () => copy(keys)),
    setUpKeys: (body) =>
      call("setUpKeys", () => {
        if (keys) throw new ApiError(409, { error: "already_set_up" });
        keys = copy({ ...body });
      }),
    replacePassphrase: (expectedIv, slot) =>
      call("replacePassphrase", () => {
        replace("passphrase", expectedIv).passphrase = copy(slot);
      }),
    replaceRecovery: (expectedIv, slot) =>
      call("replaceRecovery", () => {
        replace("recovery", expectedIv).recovery = copy(slot);
      }),
    rememberDevice: (slot) =>
      call("rememberDevice", () => {
        device = copy(slot);
      }),
    deviceSlot: () => call("deviceSlot", () => copy(device)),
    forgetDevice: () =>
      call("forgetDevice", () => {
        device = null;
      }),
    records: (kind) =>
      call("records", () =>
        [...records]
          .filter(([, row]) => row.kind === kind)
          .map(([id, row]) => ({
            id,
            kind: row.kind,
            revision: row.revision,
            envelope: copy(row.envelope),
            updatedAt: new Date(0).toISOString(),
          })),
      ),
    putRecord: (id, write) =>
      call("putRecord", () => {
        const current = records.get(id);
        if (write.revision === 0 && current) {
          throw new ApiError(409, {
            error: "conflict",
            revision: current.revision,
          });
        }
        if (write.revision > 0 && current?.revision !== write.revision) {
          throw new ApiError(current ? 409 : 404, {
            error: current ? "conflict" : "not_found",
            ...(current && { revision: current.revision }),
          });
        }
        const revision = write.revision + 1;
        records.set(id, {
          kind: write.kind,
          revision,
          envelope: copy(write.envelope),
        });
        return revision;
      }),
    createRecords: (batch) =>
      call("createRecords", () => {
        if (batch.records.some(({ id }) => records.has(id))) {
          throw new ApiError(409, { error: "conflict" });
        }
        for (const { id, kind, envelope } of batch.records) {
          records.set(id, { kind, revision: 1, envelope: copy(envelope) });
        }
      }),
    deleteRecord: (id) =>
      call("deleteRecord", () => {
        if (!records.delete(id)) {
          throw new ApiError(404, { error: "not_found" });
        }
      }),
    // Like the server: transactions only, an id already gone is no error.
    deleteRecords: (ids) =>
      call("deleteRecords", () => {
        let deleted = 0;
        for (const id of ids) {
          if (records.get(id)?.kind === "transaction" && records.delete(id)) {
            deleted += 1;
          }
        }
        return deleted;
      }),
  };
  return {
    api,
    state,
    get keys() {
      return keys;
    },
    set keys(value) {
      keys = value;
    },
    get device() {
      return device;
    },
    set device(value) {
      device = value;
    },
    records,
  };
}

export type FakeServer = ReturnType<typeof fakeServer>;

/** Web Locks shared by the tabs of one fake browser. */
function fakeLocks(): LockManager {
  const held = new Map<string, number>();
  return {
    query: () =>
      Promise.resolve({
        held: [...held.keys()].map((name) => ({ name, mode: "shared" })),
        pending: [],
      }),
    request: ((
      name: string,
      _options: LockOptions,
      callback: (lock: Lock | null) => unknown,
    ) => {
      held.set(name, (held.get(name) ?? 0) + 1);
      return Promise.resolve(callback({ name, mode: "shared" })).finally(() => {
        const count = (held.get(name) ?? 1) - 1;
        if (count === 0) held.delete(name);
        else held.set(name, count);
      });
    }) as LockManager["request"],
  };
}

let browsers = 0;

export interface FakeTab {
  vault: Vault;
  /** Every afterLock call: the reason, and whether this tab locked. */
  events: { reason: LockReason; here: boolean }[];
  session: KeyValueStore;
  /** Fires this tab's idle lock, as 15 minutes without activity would. */
  goIdle(): void;
  readonly watchingIdle: boolean;
  close(): void;
}

export function fakeBrowser(server: FakeServer = fakeServer()) {
  const channelName = `vault-test-${String(++browsers)}`;
  const local = memoryStore();
  const deviceKeys = memoryDeviceKeys();
  const locks = fakeLocks();
  const opened: FakeTab[] = [];

  function openTab({
    session = memoryStore(),
    secure = true,
    api = server.api,
  }: {
    /** sessionStorage: pass another tab's to stand for a reload of that tab. */
    session?: KeyValueStore;
    secure?: boolean;
    /** Another account's server, for a tab signed in as someone else. */
    api?: FakeServer["api"];
  } = {}): FakeTab {
    const events: { reason: LockReason; here: boolean }[] = [];
    let idle: (() => void) | null = null;
    const tabs = createTabs({ store: local, channelName, locks });
    const vault = new Vault({
      api,
      deviceKeys,
      tabs,
      local,
      session,
      isSecureContext: () => secure,
      watchIdle(onIdle) {
        idle = onIdle;
        return () => {
          idle = null;
        };
      },
      afterLock(reason, here) {
        events.push({ reason, here });
      },
      kdf: FAST_KDF,
    });
    const tab: FakeTab = {
      vault,
      events,
      session,
      goIdle() {
        if (!idle) throw new Error("This tab does not watch for idleness.");
        idle();
      },
      get watchingIdle() {
        return idle !== null;
      },
      close() {
        tabs.close();
      },
    };
    opened.push(tab);
    return tab;
  }

  return {
    server,
    local,
    deviceKeys,
    channelName,
    locks,
    openTab,
    closeAll() {
      for (const tab of opened) tab.close();
    },
  };
}

/** Waits until the vault reaches a status, or fails after a while. */
export async function settled(
  vault: Vault,
  status: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (vault.getState().status !== status) {
    if (Date.now() > deadline) {
      throw new Error(
        `Expected ${status}, still ${vault.getState().status} after ${String(timeoutMs)} ms.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export const PASSPHRASE = "purple elephant dances at noon";
