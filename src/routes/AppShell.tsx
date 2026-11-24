import { useSuspenseQuery } from "@tanstack/react-query";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { sessionQuery } from "../features/auth/client.ts";
import { chatSession } from "../features/chat/chat-session.ts";
import { useChats, useDeleteChats } from "../features/chat/useChats.ts";
import { VaultGate } from "../features/unlock/VaultGate.tsx";
import { AppFrame, type AppLinks, type AppSection } from "./AppFrame.tsx";
import { preloadSections } from "./pages.ts";

const LINKS: AppLinks = {
  portfolio: "/",
  transactions: "/transactions",
  settings: "/settings",
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
      <Frame pathname={pathname}>
        <Outlet />
      </Frame>
    </VaultGate>
  );
}

/** Inside the gate: the kept chats need the data key. */
function Frame({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const userId = session?.user.id ?? "";
  const chats = useChats(userId);
  const { remove } = useDeleteChats(userId);
  const section = sectionOf(pathname);
  const openId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : undefined;
  return (
    <AppFrame
      section={section}
      links={LINKS}
      title={chats?.find(({ id }) => id === openId)?.title}
      chat={{
        newChat: "/chat",
        onNewChat: chatSession.startOver,
        list: chats && {
          chats,
          currentId: openId,
          hrefOf: (id) => `/chat/${id}`,
          onDelete: remove,
        },
      }}
    >
      {children}
    </AppFrame>
  );
}
