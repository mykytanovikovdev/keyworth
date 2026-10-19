import { useCallback, useSyncExternalStore } from "react";

/*
 * Theme state. public/theme-init.js sets <html data-theme> before the first
 * paint and keeps it in sync with the system and with other tabs; this module
 * lets React read the result and change the user's choice. The attribute is the
 * single source of truth for the resolved theme.
 */

export type Theme = "light" | "dark";
export type ThemePreference = "system" | Theme;

// Must match public/theme-init.js.
const STORAGE_KEY = "keyworth-theme";
const PREFERENCE_EVENT = "keyworth:theme-preference";

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Stores the user's choice and applies it immediately. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Without storage the choice lasts until reload, which is acceptable.
  }
  document.documentElement.dataset.theme =
    preference === "system" ? systemTheme() : preference;
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

function subscribeToPreference(onChange: () => void) {
  // `storage` fires for other tabs only; the custom event covers this one.
  window.addEventListener("storage", onChange);
  window.addEventListener(PREFERENCE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREFERENCE_EVENT, onChange);
  };
}

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    observer.disconnect();
  };
}

/** The user's choice: follow the system, or always light or dark. */
export function useThemePreference(): [
  ThemePreference,
  (preference: ThemePreference) => void,
] {
  const preference = useSyncExternalStore(
    subscribeToPreference,
    readPreference,
  );
  const update = useCallback((next: ThemePreference) => {
    setThemePreference(next);
  }, []);
  return [preference, update];
}

/**
 * The theme on screen right now. Components that cannot read CSS variables by
 * themselves, such as canvas charts, re-render with new colors when it changes.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeToTheme, readTheme);
}
