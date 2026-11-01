import { useSyncExternalStore } from "react";

/*
 * Where the visible part of the page starts within the layout. iOS Safari
 * shows the on-screen keyboard by shrinking the visible part and, at times,
 * moving it down the page (`visualViewport.offsetTop`), while fixed elements
 * stay put relative to the layout. Overlays use this to cover what is
 * actually on screen.
 */

const viewport = typeof window === "undefined" ? null : window.visualViewport;

function subscribe(onChange: () => void): () => void {
  if (!viewport) return () => undefined;
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}

/** The visible part's offset from the top of the layout, in CSS pixels; 0 when zoomed in. */
function offsetTop(): number {
  // Pinch zoom moves the visible part on purpose; React Aria ignores it too.
  if (!viewport || viewport.scale > 1) return 0;
  return Math.max(0, Math.round(viewport.offsetTop));
}

export function useVisualViewportTop(): number {
  return useSyncExternalStore(subscribe, offsetTop, () => 0);
}

/**
 * True with a mouse or trackpad. On a touch screen, focusing a field in code
 * does not open the keyboard, and a later tap on that already focused field
 * lets iOS Safari scroll the page under an open dialog: fields in dialogs
 * focus themselves only with a fine pointer.
 */
export function hasFinePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: fine)").matches
  );
}
