import { useSyncExternalStore } from "react";
import { httpApi } from "./api.ts";
import { indexedDbDeviceKeys } from "./device-keys.ts";
import { watchIdle } from "./idle.ts";
import { localStore, sessionStore } from "./storage.ts";
import { createTabs } from "./tabs.ts";
import { Vault, type VaultState } from "./vault.ts";

// The public surface of src/vault. See README.md.
export { ApiError, httpApi } from "./api.ts";
export {
  newRecord,
  readRecord,
  readRecords,
  type StoredRecord,
  writeRecord,
} from "./records.ts";
export type { LockReason } from "./tabs.ts";
export { VaultError, type VaultErrorCode, type VaultState } from "./vault.ts";

/** This page's vault: one per tab, shared by every component. */
export const vault = new Vault({
  api: httpApi,
  deviceKeys: indexedDbDeviceKeys,
  tabs: createTabs({ store: localStore }),
  local: localStore,
  session: sessionStore,
  // crypto.subtle exists only on secure pages (HTTPS, localhost).
  isSecureContext: () => window.isSecureContext && "subtle" in crypto,
  watchIdle: (onIdle) => watchIdle({ store: localStore, onIdle }),
  afterLock(reason, here) {
    // A reload is the only sure way to drop every decrypted value in memory.
    // Signing out and leaving for Google navigate away by themselves.
    if (!here || reason === "lock" || reason === "idle") {
      window.location.reload();
    }
  },
});

// A frozen tab or a page from the back-forward cache heard no Lock meanwhile.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) vault.wake();
});
document.addEventListener("resume", () => {
  vault.wake();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") vault.wake();
});

export function useVaultState(): VaultState {
  return useSyncExternalStore(vault.subscribe, vault.getState);
}
