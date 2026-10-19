// Sets the color theme before the first paint, so the page never flashes the
// wrong theme. It is an external, render-blocking script because the CSP forbids
// inline scripts. src/ui/theme.ts uses the same storage key and values.
//
// <html data-theme> always holds the resolved theme, "light" or "dark":
// the user's choice if they made one, otherwise the system setting.
(() => {
  const storageKey = "keyworth-theme";
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  const storedChoice = () => {
    try {
      const value = window.localStorage.getItem(storageKey);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      // Storage can be blocked; the system theme still works.
      return null;
    }
  };

  const apply = () => {
    document.documentElement.dataset.theme =
      storedChoice() ?? (systemDark.matches ? "dark" : "light");
  };

  apply();
  // Follow the system while no choice is stored, and choices made in other tabs.
  systemDark.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) apply();
  });
})();
