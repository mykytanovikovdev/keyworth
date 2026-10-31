/*
 * The browser half of "Remember this device": one non-extractable AES-GCM key
 * per user, stored in IndexedDB as a CryptoKey (structured clone keeps it
 * non-extractable: scripts can use it, never read it). Nothing else is ever
 * stored here; in particular never the data key, which may be used for
 * encryption and so must stay in memory only.
 */

export interface DeviceKeyStore {
  load(userId: string): Promise<CryptoKey | null>;
  save(userId: string, key: CryptoKey): Promise<void>;
  remove(userId: string): Promise<void>;
}

/**
 * True only for a device key as src/crypto makes it: secret, AES-GCM,
 * non-extractable, and able to wrap and unwrap but not to encrypt. A data key
 * (encrypt, decrypt) or an extractable key is refused, so a bug elsewhere
 * cannot put one on disk.
 */
export function isDeviceKey(value: unknown): value is CryptoKey {
  if (!(value instanceof CryptoKey)) return false;
  const usages = [...value.usages].sort();
  return (
    value.type === "secret" &&
    value.algorithm.name === "AES-GCM" &&
    !value.extractable &&
    usages.length === 2 &&
    usages[0] === "unwrapKey" &&
    usages[1] === "wrapKey"
  );
}

const DATABASE = "keyworth";
const STORE = "device-keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB did not open."));
    };
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => {
        resolve(request.result);
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("IndexedDB request failed."));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB request aborted."));
      };
    });
  } finally {
    db.close();
  }
}

export const indexedDbDeviceKeys: DeviceKeyStore = {
  async load(userId) {
    const value = await run<unknown>("readonly", (store) => store.get(userId));
    if (value === undefined) return null;
    if (isDeviceKey(value)) return value;
    // Not something this code stores: drop it rather than use it.
    await this.remove(userId);
    return null;
  },
  async save(userId, key) {
    if (!isDeviceKey(key)) {
      throw new Error("Only a non-extractable device key may be stored.");
    }
    await run("readwrite", (store) => store.put(key, userId));
  },
  async remove(userId) {
    await run("readwrite", (store) => store.delete(userId));
  },
};

/** In memory, for tests. Applies the same check as IndexedDB storage. */
export function memoryDeviceKeys(): DeviceKeyStore & {
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
