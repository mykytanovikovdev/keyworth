/*
 * The few small values the vault keeps in Web Storage: never a key and never
 * user data, only coordination between tabs (the Lock epoch, the time of the
 * last activity) and one note for the next page load. Storage can be missing
 * or throw (blocked site data, some private modes); then each tab works on
 * its own, and nothing breaks.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function webStorage(pick: () => Storage): KeyValueStore {
  return {
    get(key) {
      try {
        return pick().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        pick().setItem(key, value);
      } catch {
        // Full or blocked: coordination degrades to this tab only.
      }
    },
    remove(key) {
      try {
        pick().removeItem(key);
      } catch {
        // As above.
      }
    },
  };
}

/** Shared by every tab of this browser profile. */
export const localStore = webStorage(() => window.localStorage);

/** This tab only, and it survives a reload. */
export const sessionStore = webStorage(() => window.sessionStorage);
