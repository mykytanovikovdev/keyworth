import { describe, expect, it } from "vitest";
import {
  KeyProgress,
  RING_MS,
  ringRate,
} from "../../../src/features/unlock/key-progress.ts";

describe("KeyProgress", () => {
  it("passes readings to the one listener until it stops", () => {
    const progress = new KeyProgress();
    const heard: number[] = [];
    const stop = progress.listen((fraction) => heard.push(fraction));
    progress.report(0.25);
    stop();
    progress.report(0.5);
    expect(heard).toEqual([0.25]);
  });

  it("keeps a newer listener when an older one stops", () => {
    const progress = new KeyProgress();
    const older: number[] = [];
    const newer: number[] = [];
    const stopOlder = progress.listen((fraction) => older.push(fraction));
    progress.listen((fraction) => newer.push(fraction));
    stopOlder();
    progress.report(1);
    expect(older).toEqual([]);
    expect(newer).toEqual([1]);
  });
});

describe("ringRate", () => {
  it("closes the ring as a fast derivation finishes", () => {
    // 10% in 60 ms: 540 ms to go, and the ring has 95% of its length left.
    const rate = ringRate({
      shown: 0.05,
      fraction: 0.1,
      done: 0.1,
      elapsedMs: 60,
    });
    expect(rate * 540).toBeCloseTo(0.95 * RING_MS);
  });

  it("slows right down on a device that takes forty seconds", () => {
    const rate = ringRate({
      shown: 0.1,
      fraction: 0.01,
      done: 0.01,
      elapsedMs: 400,
    });
    expect(rate).toBeLessThan(0.03);
  });

  it("waits, at the slowest pace, when the ring is ahead", () => {
    expect(
      ringRate({ shown: 1, fraction: 0.5, done: 0.5, elapsedMs: 300 }),
    ).toBe(0.01);
  });

  it("never runs faster than five times its length", () => {
    expect(ringRate({ shown: 0, fraction: 1, done: 1, elapsedMs: 500 })).toBe(
      5,
    );
  });
});
