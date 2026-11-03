import { createTimeline, cubicBezier, type Timeline } from "animejs";
import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Lock,
  MonitorSmartphone,
  Server,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton, useReducedMotion } from "../../ui/index.ts";

/*
 * What the encryption does, in six steps the person moves through at their
 * own pace: the passphrase becomes a key on the device, which opens the data
 * key, which locks each record; only locked records reach the server; the
 * recovery key opens the data key too; with both lost, nobody can. It shows
 * exactly what src/crypto does (see its README), nothing it does not.
 *
 * Every part of the picture is labelled, so it reads without the caption.
 * Moving forwards plays the step's short scene and stops; going back runs the
 * same motion backwards, quicker; nothing moves on a timer. With reduced
 * motion every step shows its final picture at once.
 */

const STEPS = [
  "Your passphrase turns into a key, right here on your device.",
  "That key opens your data key. Your passphrase never leaves your device.",
  "Your data key locks every record before it's saved.",
  "So we only store locked records. This is all we can see.",
  "Your recovery key opens your data key too. Keep it somewhere safe.",
  "Lose both your passphrase and your recovery key, and nobody can get in, not even us.",
];

// Each step's scene; the film stops in the quiet gap at its end, before the
// next scene, so a late frame cannot show the next step's first motion.
const SCENE_MS = 2000;
const STOP_MS = SCENE_MS - 150;
// The stage is drawn at this size (it fits a 320-pixel screen) and scaled down
// below it, for narrower screens such as a folding phone's outer one.
const STAGE_W = 286;
const STAGE_H = 168;
// The locked record's trip from the device to the server, in the stage's pixels.
const TRIP_PX = 166;

const easeOut = cubicBezier(0.22, 1, 0.36, 1);
const easeTrip = cubicBezier(0.4, 0, 0.2, 1);

const SCRAMBLE =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#$%&@";

function scrambled(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => SCRAMBLE[byte % SCRAMBLE.length]).join("");
}

/** Characters that change while `active`, each in a fixed-width cell so nothing shifts. */
function ScrambledLine({
  length,
  active,
}: {
  length: number;
  active: boolean;
}) {
  const [text, setText] = useState(() => scrambled(length));
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setText(scrambled(length));
    }, 90);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, length]);
  return (
    <span className="flex">
      {Array.from(text, (character, index) => (
        <span key={index} className="w-[0.62em] text-center">
          {character}
        </span>
      ))}
    </span>
  );
}

const PART_NAMES = [
  "chip",
  "userKey",
  "userKeyCircle",
  "userCross",
  "dataKey",
  "dataKeyCircle",
  "card",
  "cardText",
  "cardLock",
  "badge",
  "lockedLabel",
  "scrambled",
  "serverLabel",
  "recovery",
  "recoveryCross",
] as const;

type Parts = Record<(typeof PART_NAMES)[number], HTMLElement>;

/** The stage's moving parts, marked `data-part`; null until all are rendered. */
function findParts(stage: HTMLElement | null): Parts | null {
  const parts: Partial<Parts> = {};
  for (const name of PART_NAMES) {
    const part = stage?.querySelector<HTMLElement>(`[data-part="${name}"]`);
    if (!part) return null;
    parts[name] = part;
  }
  return parts as Parts;
}

const at = (step: number, ms = 0) => step * SCENE_MS + ms;
// While the server's characters keep changing: from their arrival to the scene's stop.
const SCRAMBLE_FROM = at(3, 1150);
const SCRAMBLE_TO = at(3, STOP_MS);
// Where each scene's last motion ends; the rest of the scene stands still.
const MOTION_END_MS = [1600, 1100, 1700, 1450, 1050, 700];
// Going back runs the same motion backwards, quicker, and never for long.
const REWIND_SPEED = 2.5;
const REWIND_MAX_MS = 900;

/**
 * Plays the film backwards from scene `scene` to the time `to`, by seeking it
 * frame by frame, so every part retraces its way. It starts where the scene's
 * motion ended, not after the still tail. Returns the way to stop it.
 */
function rewind(timeline: Timeline, scene: number, to: number): () => void {
  const from = Math.min(
    timeline.currentTime,
    at(scene, MOTION_END_MS[scene] ?? STOP_MS),
  );
  const duration = Math.min((from - to) / REWIND_SPEED, REWIND_MAX_MS);
  const started = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const done = duration > 0 ? Math.min((now - started) / duration, 1) : 1;
    timeline.seek(from + (to - from) * done, true);
    if (done < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
  };
}

/**
 * The six scenes, one after another. `stopAt()` says where the scene being
 * played ends: the film checks it on every frame, pauses there and steps back
 * onto it if a frame went past. (Callbacks placed on the timeline would not do:
 * anime.js does not fire them again after seeking back.)
 */
function film(
  parts: Parts,
  stopAt: () => number,
  onScrambling: (on: boolean) => void,
): Timeline {
  const timeline = createTimeline({
    autoplay: false,
    defaults: { ease: easeOut, duration: 600 },
    onUpdate: (self) => {
      const time = self.currentTime;
      if (time >= stopAt()) {
        self.pause();
        self.seek(stopAt(), true);
        return;
      }
      onScrambling(time >= SCRAMBLE_FROM && time < SCRAMBLE_TO);
    },
    onPause: () => {
      onScrambling(false);
    },
  });
  timeline
    // 1. The passphrase turns into a key in its place, keeping its name.
    .add(parts.userKey, { opacity: [0, 1], duration: 400 }, at(0))
    .add(parts.chip, { opacity: 0, scale: 0.6 }, at(0, 900))
    .add(parts.userKeyCircle, { opacity: [0, 1], scale: [0.6, 1] }, at(0, 1000))
    // 2. It opens the data key beside it.
    .add(parts.userKey, { x: -30 }, at(1))
    .add(parts.dataKey, { opacity: [0, 1], scale: [0.6, 1] }, at(1, 500))
    // 3. A record appears and is locked.
    .add(parts.card, { opacity: [0, 1], y: [8, 0] }, at(2))
    .add(parts.cardText, { opacity: 0, duration: 400 }, at(2, 900))
    .add(parts.cardLock, { opacity: [0, 1], scale: [0.6, 1] }, at(2, 1000))
    .add(parts.badge, { opacity: [0, 1], scale: [0.5, 1] }, at(2, 1100))
    .add(parts.lockedLabel, { opacity: [0, 1] }, at(2, 1100))
    // 4. Only the locked record travels; the server cannot read it.
    .add(parts.card, { x: TRIP_PX, duration: 1100, ease: easeTrip }, at(3))
    .add(parts.cardLock, { opacity: 0, duration: 250 }, at(3, 1100))
    .add(parts.lockedLabel, { opacity: 0, duration: 250 }, at(3, 1100))
    .add(parts.scrambled, { opacity: [0, 1], duration: 300 }, at(3, 1150))
    .add(parts.serverLabel, { opacity: [0, 1], duration: 300 }, at(3, 1150))
    // 5. The recovery key opens the data key too.
    .add(parts.recovery, { opacity: [0, 1], y: [8, 0] }, at(4))
    .add(parts.dataKey, { scale: 1.15, duration: 250 }, at(4, 500))
    .add(parts.dataKey, { scale: 1, duration: 300 }, at(4, 750))
    // 6. Without both, nothing opens it.
    .add(
      [parts.userCross, parts.recoveryCross],
      { opacity: [0, 1], scale: [0.5, 1] },
      at(5),
    )
    // Only the key dims; its label keeps its contrast.
    .add(parts.dataKeyCircle, { opacity: 0.35 }, at(5, 100))
    // Runs past the last stop, so the film never completes and can always play on.
    .add({ duration: 1 }, at(6));
  return timeline;
}

export function EncryptionExplainer({
  className = "",
  still: stillProp,
}: {
  className?: string;
  /** No motion regardless of the user's setting (the design page). */
  still?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const still = stillProp ?? reducedMotion;
  const [step, setStep] = useState(0);
  const [scrambling, setScrambling] = useState(false);
  const timeline = useRef<Timeline | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const frame = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const stopAt = useRef(0);
  // The step on screen before this one, to tell forwards from back.
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFit(Math.min(1, entry.contentRect.width / STAGE_W));
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, []);

  // One film for the component's life; the next effect moves through it.
  useEffect(() => {
    const parts = findParts(stage.current);
    if (!parts) return;
    const built = film(parts, () => stopAt.current, setScrambling);
    timeline.current = built;
    return () => {
      timeline.current = null;
      built.revert();
    };
  }, []);

  // Forwards, a step plays its scene from the start; back, the film runs
  // backwards to where that step's scene ended; with reduced motion every
  // step shows its scene's end at once.
  useEffect(() => {
    const current = timeline.current;
    if (!current) return undefined;
    const previous = shown.current;
    shown.current = step;
    current.pause();
    stopAt.current = at(step, STOP_MS);
    if (still) {
      current.seek(stopAt.current, true);
      return undefined;
    }
    if (previous !== null && step < previous) {
      return rewind(current, previous, stopAt.current);
    }
    current.seek(at(step), true);
    current.play();
    return undefined;
  }, [step, still]);

  return (
    <figure className={className}>
      <div
        ref={frame}
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-line bg-raised py-4"
      >
        <div className="relative" style={{ height: STAGE_H * fit }}>
          <div
            ref={stage}
            className="absolute top-0 left-1/2 h-[168px] w-[286px] origin-top -translate-x-1/2 text-xs text-fg-muted"
            style={{ scale: String(fit) }}
          >
            <p className="absolute top-0 left-0 flex w-30 items-center justify-center gap-1.5">
              <MonitorSmartphone className="size-3.5" />
              Your device
            </p>
            <p className="absolute top-0 left-[166px] flex w-30 items-center justify-center gap-1.5">
              <Server className="size-3.5" />
              Our server
            </p>
            <div className="absolute top-[22px] left-0 h-[146px] w-30 rounded-lg border border-line bg-canvas" />
            <div className="absolute top-[22px] left-[166px] h-[146px] w-30 rounded-lg border border-line bg-canvas" />
            {/* The way to the server. */}
            <div className="absolute top-[116px] left-[125px] h-px w-[30px] bg-line-strong" />
            <div className="absolute top-[112px] left-[155px] size-0 border-y-[4.5px] border-l-[7px] border-y-transparent border-l-line-strong" />

            <div
              data-part="userKey"
              className="absolute top-[34px] left-11 flex w-8 flex-col items-center opacity-0"
            >
              <span className="relative size-8">
                {/* The passphrase as typed; the key takes its place. */}
                <span
                  data-part="chip"
                  className="absolute top-[5px] left-[-11px] flex h-[22px] w-[54px] items-center justify-center rounded-full border border-line-strong bg-raised tracking-[0.15em] text-fg"
                >
                  ••••
                </span>
                <span
                  data-part="userKeyCircle"
                  className="flex size-8 items-center justify-center rounded-full border border-line-strong bg-raised text-fg opacity-0"
                >
                  <KeyRound className="size-4" />
                </span>
                <span
                  data-part="userCross"
                  className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-loss text-on-loss opacity-0"
                >
                  <X className="size-3" />
                </span>
              </span>
              <span className="mt-1 text-[10px] whitespace-nowrap">
                Passphrase
              </span>
            </div>
            <div
              data-part="dataKey"
              className="absolute top-[34px] left-[74px] flex w-8 flex-col items-center opacity-0"
            >
              <span
                data-part="dataKeyCircle"
                className="flex size-8 items-center justify-center rounded-full bg-accent text-on-accent"
              >
                <KeyRound className="size-4" />
              </span>
              <span className="mt-1 text-[10px] whitespace-nowrap">
                Data key
              </span>
            </div>

            <div
              data-part="card"
              className="absolute top-[96px] left-1.5 w-[108px] opacity-0"
            >
              <div className="relative h-10 rounded-md border border-line-strong bg-raised">
                <div
                  data-part="cardText"
                  className="flex h-full items-center justify-center text-[11px] font-medium whitespace-nowrap text-fg"
                >
                  BTC · at $60,000
                </div>
                <div
                  data-part="cardLock"
                  className="absolute inset-0 flex items-center justify-center text-accent opacity-0"
                >
                  <Lock className="size-4" />
                </div>
                <div
                  data-part="scrambled"
                  className="absolute inset-0 flex flex-col items-center justify-center text-[11px] leading-tight opacity-0"
                >
                  <ScrambledLine length={13} active={scrambling} />
                  <ScrambledLine length={13} active={scrambling} />
                </div>
                <div
                  data-part="badge"
                  className="absolute -top-2 -right-2 flex size-[18px] items-center justify-center rounded-full bg-accent text-on-accent opacity-0"
                >
                  <Lock className="size-2.5" />
                </div>
              </div>
              <div className="relative mt-1 h-3 text-center text-[10px]">
                <span
                  data-part="lockedLabel"
                  className="absolute inset-0 opacity-0"
                >
                  Locked record
                </span>
                <span
                  data-part="serverLabel"
                  className="absolute inset-0 opacity-0"
                >
                  What we see
                </span>
              </div>
            </div>

            <div
              data-part="recovery"
              className="absolute top-[100px] left-1.5 flex w-[108px] flex-col items-center gap-1 opacity-0"
            >
              <span className="relative flex h-[26px] w-full items-center justify-center gap-1.5 rounded-full border border-line-strong bg-raised text-fg">
                <KeyRound className="size-3.5" />
                810M-4GT4-…
                <span
                  data-part="recoveryCross"
                  className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-loss text-on-loss opacity-0"
                >
                  <X className="size-3" />
                </span>
              </span>
              <span className="text-[10px]">Recovery key</span>
            </div>
          </div>
        </div>
      </div>

      <figcaption
        aria-live="polite"
        className="mt-4 min-h-12 text-base text-fg"
      >
        <span className="sr-only">
          Step {step + 1} of {STEPS.length}:{" "}
        </span>
        {STEPS[step]}
      </figcaption>
      <div className="mt-2 flex items-center justify-between gap-3">
        <IconButton
          label="Previous step"
          isDisabled={step === 0}
          onPress={() => {
            setStep(step - 1);
          }}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <div className="flex">
          {STEPS.map((caption, index) => (
            <button
              key={caption}
              type="button"
              aria-label={`Step ${String(index + 1)} of ${String(STEPS.length)}`}
              aria-current={index === step ? "step" : undefined}
              onClick={() => {
                setStep(index);
              }}
              className="flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span
                className={`size-2 rounded-full transition-colors duration-(--kw-duration-fast) ${index === step ? "bg-accent" : "bg-line-strong"}`}
              />
            </button>
          ))}
        </div>
        <IconButton
          label="Next step"
          isDisabled={step === STEPS.length - 1}
          onPress={() => {
            setStep(step + 1);
          }}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>
    </figure>
  );
}
