import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { chatSession } from "../features/chat/chat-session.ts";
import { VaultGate } from "../features/unlock/VaultGate.tsx";
import {
  AppFrame,
  type AppLinks,
  type AppSection,
  type FrameChats,
} from "./AppFrame.tsx";
import { preloadSections } from "./pages.ts";

const LINKS: AppLinks = {
  portfolio: "/",
  transactions: "/transactions",
  settings: "/settings",
};

// One conversation at a time until chats are kept (phase 5.3): no list yet.
const CHAT: FrameChats = {
  newChat: "/chat",
  onNewChat: chatSession.startOver,
};

/** Which item of the menu the address belongs to. */
function sectionOf(pathname: string): AppSection {
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/transactions")) return "transactions";
  if (pathname.startsWith("/settings")) return "settings";
  return "portfolio";
}

/** The frame around every signed-in page, once the data key is open. */
export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // While the passphrase is typed, or the first page draws: the sections'
  // code holds no data, and the first switch to one is then instant.
  useEffect(preloadSections, []);
  return (
    <VaultGate>
      <AppFrame section={sectionOf(pathname)} links={LINKS} chat={CHAT}>
        <Outlet />
      </AppFrame>
    </VaultGate>
  );
}
