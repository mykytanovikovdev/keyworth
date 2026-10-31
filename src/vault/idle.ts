import type { KeyValueStore } from "./storage.ts";

/*
 * Locks after 15 minutes without activity in any tab. Activity is a time in
 * localStorage that every tab updates, so working in one tab keeps the others
 * open. The decision compares clock times instead of trusting a timer:
 * browsers slow timers in background tabs to once a minute or less, and a
 * laptop that sleeps runs none at all. So the check also runs whenever the
 * page becomes visible or focused again, and before any activity is counted:
 * the first key press after 20 minutes away locks instead of extending.
 */

export const IDLE_LOCK_MS = 15 * 60 * 1000;

const LAST_ACTIVITY_KEY = "keyworth-last-activity";
/** Activity is written at most this often: pointer moves come many per second. */
const WRITE_EVERY_MS = 10_000;
const CHECK_EVERY_MS = 30_000;

export function isIdle(lastActivity: number | null, now: number): boolean {
  return lastActivity !== null && now - lastActivity >= IDLE_LOCK_MS;
}

export interface IdleWatchOptions {
  store: KeyValueStore;
  onIdle: () => void;
  now?: () => number;
}

/** The decisions, without the browser events: tested on their own. */
export function idleClock({ store, onIdle, now = Date.now }: IdleWatchOptions) {
  let written = 0;
  const lastActivity = () => {
    const value = Number(store.get(LAST_ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const record = (at: number) => {
    written = at;
    store.set(LAST_ACTIVITY_KEY, String(at));
  };
  return {
    /** Unlocking counts as activity. */
    start() {
      record(now());
    },
    /** True (and onIdle called) when the time is up. */
    check(): boolean {
      if (!isIdle(lastActivity(), now())) return false;
      onIdle();
      return true;
    },
    /** A key press, a click, a touch. */
    activity() {
      if (this.check()) return;
      const at = now();
      if (at - written >= WRITE_EVERY_MS) record(at);
    },
  };
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];
const WAKE_EVENTS = ["focus", "pageshow"];

/** Starts watching this tab; returns a function that stops. */
export function watchIdle(options: IdleWatchOptions): () => void {
  const clock = idleClock(options);
  clock.start();
  const onActivity = () => {
    clock.activity();
  };
  const onWake = () => {
    clock.check();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") clock.check();
  };
  for (const type of ACTIVITY_EVENTS) {
    window.addEventListener(type, onActivity, { capture: true, passive: true });
  }
  for (const type of WAKE_EVENTS) window.addEventListener(type, onWake);
  document.addEventListener("visibilitychange", onVisibility);
  const timer = setInterval(onWake, CHECK_EVERY_MS);
  return () => {
    clearInterval(timer);
    for (const type of ACTIVITY_EVENTS) {
      window.removeEventListener(type, onActivity, { capture: true });
    }
    for (const type of WAKE_EVENTS) window.removeEventListener(type, onWake);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
