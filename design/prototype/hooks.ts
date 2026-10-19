import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
  );
}

/**
 * Steps through phases of a scripted scene, one timer per phase. Returns the
 * index of the current phase; `durations.length` means the scene is finished.
 * With reduced motion the scene starts finished.
 */
export function useSequence(durations: readonly number[]): number {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState(() =>
    reducedMotion ? durations.length : 0,
  );
  const current = reducedMotion ? durations.length : phase;

  useEffect(() => {
    if (current >= durations.length) return;
    const timer = window.setTimeout(() => {
      setPhase((value) => value + 1);
    }, durations[current] ?? 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [current, durations]);

  return current;
}

/** Splits text into words and whitespace, keeping both so spacing survives. */
export function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part.length > 0);
}

/**
 * Reveals a text token by token while `active`, imitating a streamed answer.
 * Returns how many tokens are visible.
 */
export function useStreamedTokens(
  tokenCount: number,
  active: boolean,
  msPerToken = 28,
): number {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!active || reducedMotion) return;
    const timer = window.setInterval(() => {
      setVisible((value) => {
        if (value >= tokenCount) window.clearInterval(timer);
        return Math.min(value + 1, tokenCount);
      });
    }, msPerToken);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, reducedMotion, tokenCount, msPerToken]);

  return reducedMotion ? tokenCount : visible;
}

/** Tracks an element's content width, for charts drawn in real pixels. */
export function useElementWidth(): [
  (node: Element | null) => (() => void) | undefined,
  number,
] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: Element | null) => {
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}
