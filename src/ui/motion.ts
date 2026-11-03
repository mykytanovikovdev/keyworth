import { animate, cubicBezier, stagger } from "animejs";
import { useSyncExternalStore } from "react";

/*
 * anime.js wrappers for motion that CSS cannot express well: drawing a chart
 * line, revealing its fill, choreographed reveals. Durations come from the CSS
 * motion tokens, so CSS and JS animations share one rhythm. Every helper is a
 * no-op when the user prefers reduced motion: the element shows its final state.
 */

type Cleanup = () => void;
const noop: Cleanup = () => undefined;

// Matches --kw-ease-out.
const easeOut = cubicBezier(0.22, 1, 0.36, 1);
// Matches --kw-ease-chart: gentle at both ends, so a line reads as one stroke.
const easeChart = cubicBezier(0.4, 0, 0.2, 1);

type DurationToken = "duration-base" | "duration-chart" | "stagger";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia(reducedMotionQuery).matches;
}

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

/** Re-renders when the user turns reduced motion on or off. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion);
}

/**
 * A CSS duration in milliseconds. Tokens are written in ms, but the production
 * CSS minifier rewrites them in seconds when shorter (240ms becomes .24s).
 */
export function durationMs(value: string): number {
  const text = value.trim();
  const amount = Number.parseFloat(text) || 0;
  return text.endsWith("ms") || !text.endsWith("s") ? amount : amount * 1000;
}

function token(name: DurationToken): number {
  return durationMs(
    getComputedStyle(document.documentElement).getPropertyValue(`--kw-${name}`),
  );
}

/** How long a chart takes to draw, for sequencing things after it. */
export function chartDuration(): number {
  return prefersReducedMotion() ? 0 : token("duration-chart");
}

/**
 * Runs `onFrame` from 0 to 1 on the chart curve. Driving attributes and styles
 * ourselves keeps every write explicit (SVG attributes, CSSOM), which the CSP allows.
 */
function tween(onFrame: (progress: number) => void, delay: number): Cleanup {
  const state = { progress: 0 };
  onFrame(0);
  const animation = animate(state, {
    progress: 1,
    duration: token("duration-chart"),
    delay,
    ease: easeChart,
    onUpdate: () => {
      onFrame(state.progress);
    },
    onComplete: () => {
      onFrame(1);
    },
  });
  return () => {
    animation.cancel();
    onFrame(1);
  };
}

/**
 * Draws a chart line like a pen and opens its fill exactly up to the pen tip, both
 * from one timer so they never drift apart. Writes SVG attributes only.
 */
export function drawLineWithFill(
  path: SVGPathElement | null,
  clip: SVGRectElement | null,
  fullWidth: number,
): Cleanup {
  if (!path || !clip || prefersReducedMotion()) return noop;
  const length = path.getTotalLength();
  return tween((progress) => {
    if (progress >= 1) {
      path.removeAttribute("stroke-dasharray");
      path.removeAttribute("stroke-dashoffset");
      clip.setAttribute("width", String(fullWidth));
      return;
    }
    path.setAttribute(
      "stroke-dasharray",
      `${length.toFixed(1)} ${length.toFixed(1)}`,
    );
    path.setAttribute(
      "stroke-dashoffset",
      (length * (1 - progress)).toFixed(1),
    );
    clip.setAttribute(
      "width",
      path.getPointAtLength(length * progress).x.toFixed(1),
    );
  }, 0);
}

/** Reveals an element left to right in one continuous movement. */
export function wipeFromLeft(element: HTMLElement | null, delay = 0): Cleanup {
  if (!element || prefersReducedMotion()) return noop;
  return tween((progress) => {
    element.style.clipPath =
      progress >= 1 ? "" : `inset(0 ${((1 - progress) * 100).toFixed(2)}% 0 0)`;
  }, delay);
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
