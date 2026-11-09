import { useState } from "react";
import { type Period, PERIODS } from "./summary.ts";

/*
 * How the portfolio page was left on this device: the period and whether
 * amounts are hidden. Neither says anything about the portfolio, so they may
 * live in localStorage, like the theme. Hidden amounts stay hidden after a
 * reload, which is the point of hiding them.
 */

const PERIOD_KEY = "keyworth-portfolio-period";
const HIDDEN_KEY = "keyworth-hide-amounts";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts until reload, which is acceptable.
  }
}

const isPeriod = (value: string | null): value is Period =>
  PERIODS.some((period) => period === value);

export function usePeriod(): [Period, (period: Period) => void] {
  const [period, setPeriod] = useState<Period>(() => {
    const stored = read(PERIOD_KEY);
    return isPeriod(stored) ? stored : "1M";
  });
  return [
    period,
    (next) => {
      setPeriod(next);
      write(PERIOD_KEY, next);
    },
  ];
}

export function useHiddenAmounts(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => read(HIDDEN_KEY) === "true");
  return [
    hidden,
    (next) => {
      setHidden(next);
      write(HIDDEN_KEY, next ? "true" : null);
    },
  ];
}
