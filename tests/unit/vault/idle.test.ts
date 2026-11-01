import { describe, expect, it } from "vitest";
import { IDLE_LOCK_MS, idleClock, isIdle } from "../../../src/vault/idle.ts";
import { memoryStore } from "../../../src/vault/storage.ts";

/*
 * The idle lock decides by clock time shared through localStorage, not by
 * timers, which browsers slow down in the background and stop during sleep.
 */

function clock(start = 1_000_000) {
  let now = start;
  let locks = 0;
  const store = memoryStore();
  const options = {
    store,
    now: () => now,
    onIdle: () => {
      locks += 1;
    },
  };
  return {
    store,
    tab: () => idleClock(options),
    advance(ms: number) {
      now += ms;
    },
    get locks() {
      return locks;
    },
  };
}

describe("idle lock", () => {
  it("locks 15 minutes after the last activity, not before", () => {
    expect(isIdle(null, 0)).toBe(false);
    expect(isIdle(0, IDLE_LOCK_MS - 1)).toBe(false);
    expect(isIdle(0, IDLE_LOCK_MS)).toBe(true);
  });

  it("counts activity in any tab", () => {
    const c = clock();
    const first = c.tab();
    const second = c.tab();
    first.start();

    c.advance(10 * 60_000);
    second.activity();
    c.advance(10 * 60_000);

    expect(first.check()).toBe(false);
    c.advance(5 * 60_000);
    expect(first.check()).toBe(true);
    expect(c.locks).toBe(1);
  });

  it("locks on the first key press after a long absence instead of counting it", () => {
    const c = clock();
    const tab = c.tab();
    tab.start();

    // A laptop asleep for an hour: no timer ran in between.
    c.advance(60 * 60_000);
    tab.activity();

    expect(c.locks).toBe(1);
  });

  it("writes activity at most every 10 seconds", () => {
    const c = clock();
    const tab = c.tab();
    tab.start();
    const written = c.store.get("keyworth-last-activity");

    c.advance(5_000);
    tab.activity();
    expect(c.store.get("keyworth-last-activity")).toBe(written);

    c.advance(5_000);
    tab.activity();
    expect(c.store.get("keyworth-last-activity")).not.toBe(written);
  });

  it("treats unlocking as activity", () => {
    const c = clock();
    c.store.set("keyworth-last-activity", "1");
    const tab = c.tab();

    tab.start();

    expect(tab.check()).toBe(false);
  });
});
