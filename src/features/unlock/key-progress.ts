/**
 * How far Argon2 has got, for the ring around the mark. noble reports it about
 * 10 000 times per derivation, far too often for React state, so the ring
 * listens here instead.
 */
export class KeyProgress {
  private listener: ((fraction: number) => void) | undefined;

  /** Pass as `onProgress` to the vault. */
  readonly report = (fraction: number): void => {
    this.listener?.(fraction);
  };

  /** One listener at a time: the ring on screen. Returns the way to stop. */
  listen(listener: (fraction: number) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }
}

/** The ring's animation runs this long at rate 1; its rate maps it onto the derivation. */
export const RING_MS = 1000;
/** Before the first readings: a cautious two seconds per turn. */
export const RING_START_RATE = 0.5;
const MIN_RATE = 0.01;
const MAX_RATE = 5;

/**
 * How fast the ring must run from where it is (`shown`, 0–1) to close exactly
 * when Argon2 finishes, judging by the readings so far: `done` of the work in
 * `elapsedMs`, with `fraction` done in all. Argon2's work is uniform, so the
 * pace so far holds for the rest.
 */
export function ringRate({
  shown,
  fraction,
  done,
  elapsedMs,
}: {
  shown: number;
  fraction: number;
  done: number;
  elapsedMs: number;
}): number {
  const remainingMs = (elapsedMs / done) * (1 - fraction);
  const rate = ((1 - shown) * RING_MS) / Math.max(remainingMs, 1);
  return Math.min(Math.max(rate, MIN_RATE), MAX_RATE);
}
