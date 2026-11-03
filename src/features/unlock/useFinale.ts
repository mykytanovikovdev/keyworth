import { useEffect, useState } from "react";
import { baseDuration } from "../../ui/index.ts";

/**
 * Keeps a key screen up for the lock's finale once the data opens. The vault
 * turns unlocked before the call that opened it returns, so the screen says
 * beforehand what to hold (`hold(screen)` when it starts work that may open
 * the data, `hold(null)` when that failed); once the vault is unlocked, the
 * hold ends after the keyhole has turned.
 */
export function useFinale<Screen>(unlocked: boolean) {
  const [holding, hold] = useState<Screen | null>(null);
  const opening = unlocked && holding !== null;
  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(() => {
      hold(null);
    }, baseDuration());
    return () => {
      window.clearTimeout(timer);
    };
  }, [opening]);
  return { opening: opening ? holding : null, hold };
}
