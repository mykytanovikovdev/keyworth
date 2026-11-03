import { useEffect, useRef } from "react";
import { KeyworthMark } from "../../ui/index.ts";
import {
  type KeyProgress,
  RING_MS,
  RING_START_RATE,
  ringRate,
} from "./key-progress.ts";

export type KeyMarkStatus = "idle" | "working" | "opened" | "refused";

const halfClassName = "absolute inset-0 rounded-full border-2 border-accent";

// The first readings to trust: this much progress, or this much time.
const FIRST_FRACTION = 0.03;
const FIRST_MS = 150;
// How often, at most, the ring's speed follows the readings.
const RETUNE_MS = 250;
// How fast the ring closes once the key has opened the data.
const CLOSE_MS = 120;

/** The first half turns during the first half of the time, the second after it. */
const HALVES: Keyframe[][] = [
  [
    { transform: "rotate(0deg)" },
    { transform: "rotate(180deg)", offset: 0.5 },
    { transform: "rotate(180deg)" },
  ],
  [
    { transform: "rotate(0deg)" },
    { transform: "rotate(0deg)", offset: 0.5 },
    { transform: "rotate(180deg)" },
  ],
];

function shown(animation: Animation | undefined): number {
  const time = animation?.currentTime;
  return typeof time === "number" ? Math.min(time / RING_MS, 1) : 0;
}

/**
 * The keyhole mark at the top of the key screens. While Argon2 runs, a ring
 * around it fills with the real progress; when the key opens the data, the
 * ring closes and the keyhole turns a quarter, like a lock; a refused
 * passphrase shakes the mark.
 *
 * Argon2 runs on the main thread and leaves it few frames, so the page draws
 * nothing per frame: the ring is one Web Animation that the browser runs by
 * itself, and the readings only retune its speed a few times a second so that
 * it closes as Argon2 finishes. Each half of the ring is a half-circle turning
 * behind a window onto the other half.
 */
export function KeyMark({
  status = "idle",
  progress,
}: {
  status?: KeyMarkStatus;
  progress?: KeyProgress | undefined;
}) {
  const right = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  const animations = useRef<Animation[]>([]);

  useEffect(() => {
    if (status === "opened") {
      const rest = (1 - shown(animations.current[0])) * RING_MS;
      for (const animation of animations.current) {
        animation.playbackRate = Math.max(rest / CLOSE_MS, 1);
      }
      return;
    }
    const [first, second] = [right.current, left.current];
    if (status !== "working" || !progress || !first || !second) return;
    // A new attempt starts empty.
    for (const animation of animations.current) animation.cancel();
    const timing: KeyframeAnimationOptions = {
      duration: RING_MS,
      easing: "linear",
      fill: "forwards",
    };
    const [firstFrames = [], secondFrames = []] = HALVES;
    const running = [
      first.animate(firstFrames, timing),
      second.animate(secondFrames, timing),
    ];
    // Under way at a guessed pace from the start: playing later would wait
    // for a frame, and Argon2 leaves few. The readings correct the pace.
    for (const animation of running) animation.playbackRate = RING_START_RATE;
    animations.current = running;
    let since: { time: number; fraction: number } | undefined;
    let tuned = -Infinity;
    let rate = RING_START_RATE;
    return progress.listen((fraction) => {
      const now = performance.now();
      since ??= { time: now, fraction };
      const done = fraction - since.fraction;
      const trusted =
        done >= FIRST_FRACTION || (done > 0 && now - since.time >= FIRST_MS);
      if (!trusted || now - tuned < RETUNE_MS) return;
      tuned = now;
      const next = ringRate({
        shown: shown(running[0]),
        fraction,
        done,
        elapsedMs: now - since.time,
      });
      // Setting the rate outright keeps the animation running; each
      // updatePlaybackRate() would hold it until a frame that Argon2 delays.
      if (Math.abs(next - rate) < next * 0.05) return;
      rate = next;
      for (const animation of running) animation.playbackRate = rate;
    });
  }, [status, progress]);

  return (
    <div
      data-key-mark={status}
      className={`relative size-10 ${status === "refused" ? "animate-shake" : ""}`}
    >
      <KeyworthMark
        className="size-10"
        keyholeClassName={`origin-center transform-view transition-transform duration-(--kw-duration-base) ease-out ${status === "opened" ? "rotate-90" : ""}`}
      />
      <div
        aria-hidden="true"
        className={`absolute -inset-2.5 transition-opacity duration-(--kw-duration-fast) ${status === "working" || status === "opened" ? "opacity-100" : "opacity-0"}`}
      >
        <div className="absolute inset-0 rounded-full border-2 border-line" />
        {/* The right window shows the first half turning in from the left. */}
        <div className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
          <div
            ref={right}
            className={`${halfClassName} [clip-path:inset(0_50%_0_0)]`}
          />
        </div>
        <div className="absolute inset-0 [clip-path:inset(0_50%_0_0)]">
          <div
            ref={left}
            className={`${halfClassName} [clip-path:inset(0_0_0_50%)]`}
          />
        </div>
      </div>
    </div>
  );
}
