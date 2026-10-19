import { animate, createDrawable, cubicBezier, stagger } from "animejs";

/*
 * anime.js wrappers for motion that CSS cannot express well: drawing a chart
 * line, growing bars, choreographed reveals. Durations come from the CSS motion
 * tokens, so CSS and JS animations share one rhythm. Every helper is a no-op
 * when the user prefers reduced motion: the element simply shows its final state.
 */

type Cleanup = () => void;
const noop: Cleanup = () => undefined;

const easeOut = cubicBezier(0.22, 1, 0.36, 1);

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function token(name: "duration-base" | "duration-slow" | "stagger"): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    `--kw-${name}`,
  );
  return Number.parseFloat(value) || 0;
}

/** Draws an SVG line from its start to its end, like a pen. */
export function drawPath(path: SVGGeometryElement | null): Cleanup {
  if (!path || prefersReducedMotion()) return noop;
  const [drawable] = createDrawable(path);
  if (!drawable) return noop;
  const animation = animate(drawable, {
    draw: ["0 0", "0 1"],
    duration: token("duration-slow"),
    ease: easeOut,
  });
  return () => {
    animation.cancel();
  };
}

/** Fades and lifts elements in one after another. */
export function revealInSequence(elements: Element[], startDelay = 0): Cleanup {
  if (elements.length === 0 || prefersReducedMotion()) return noop;
  const animation = animate(elements, {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: token("duration-base"),
    delay: stagger(token("stagger"), { start: startDelay }),
    ease: easeOut,
  });
  return () => {
    animation.cancel();
  };
}

/** Grows bars from zero width, one after another. Needs `origin-left` on the bars. */
export function growInSequence(elements: Element[], startDelay = 0): Cleanup {
  if (elements.length === 0 || prefersReducedMotion()) return noop;
  const animation = animate(elements, {
    scaleX: [0, 1],
    duration: token("duration-slow"),
    delay: stagger(token("stagger"), { start: startDelay }),
    ease: easeOut,
  });
  return () => {
    animation.cancel();
  };
}

/** Fades elements in after a delay, all at once. */
export function fadeIn(elements: Element[], delay = 0): Cleanup {
  if (elements.length === 0 || prefersReducedMotion()) return noop;
  const animation = animate(elements, {
    opacity: [0, 1],
    duration: token("duration-base"),
    delay,
    ease: easeOut,
  });
  return () => {
    animation.cancel();
  };
}
