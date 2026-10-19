import { useLayoutEffect, useState } from "react";
import { AppShell } from "./components/AppShell.tsx";
import { PrototypeToolbar } from "./components/PrototypeToolbar.tsx";
import { ConversationScreen } from "./screens/ConversationScreen.tsx";
import { EmptyChatScreen } from "./screens/EmptyChatScreen.tsx";
import { PortfolioScreen } from "./screens/PortfolioScreen.tsx";
import { UnlockScreen } from "./screens/UnlockScreen.tsx";
import type { Screen, ShellScreen, Theme } from "./types.ts";

const titles: Record<ShellScreen, string> = {
  empty: "New chat",
  chat: "October performance",
  portfolio: "Portfolio",
};

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((option) => option === value) ?? fallback;
}

// The URL is the state, so every combination can be linked and screenshotted:
// /design/?theme=dark&screen=portfolio&chrome=0
function readUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    theme: pick(params.get("theme"), ["light", "dark"] as const, "light"),
    screen: pick(
      params.get("screen"),
      ["empty", "chat", "portfolio", "unlock"] as const,
      "chat",
    ),
    chrome: params.get("chrome") !== "0",
  };
}

export function App() {
  const [initial] = useState(readUrl);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [replay, setReplay] = useState(0);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const url = new URL(window.location.href);
    url.searchParams.set("theme", theme);
    url.searchParams.set("screen", screen);
    window.history.replaceState(null, "", url);
  }, [theme, screen]);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <>
      {screen === "unlock" ? (
        <UnlockScreen key={replay} />
      ) : (
        <AppShell
          screen={screen}
          title={titles[screen]}
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigate={setScreen}
        >
          {screen === "empty" && <EmptyChatScreen key={replay} />}
          {screen === "chat" && <ConversationScreen key={replay} />}
          {screen === "portfolio" && <PortfolioScreen key={replay} />}
        </AppShell>
      )}

      {initial.chrome && (
        <PrototypeToolbar
          theme={theme}
          screen={screen}
          onTheme={setTheme}
          onScreen={(next) => {
            setScreen(next);
            setReplay((value) => value + 1);
          }}
          onReplay={() => {
            setReplay((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
