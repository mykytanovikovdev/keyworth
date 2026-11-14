import { type ReactNode, useSyncExternalStore } from "react";
import { showToast } from "../ui/index.ts";
import { AppFrame, type AppSection } from "./AppFrame.tsx";
import { MOCK_LINKS, mockChats } from "./mock-chats.ts";

/**
 * The app's frame around a mockup (dev and design builds only): the real
 * AppFrame with made-up chats. Deleting one works, with Undo, as in the app.
 */
export function MockFrame({
  section,
  currentChatId,
  title,
  noChats = false,
  children,
}: {
  section: AppSection;
  currentChatId?: string | undefined;
  title?: string | undefined;
  /** A first visit: nothing asked yet. */
  noChats?: boolean;
  children: ReactNode;
}) {
  const chats = useSyncExternalStore(mockChats.subscribe, mockChats.get);
  return (
    <AppFrame
      section={section}
      chats={noChats ? [] : chats}
      currentChatId={currentChatId}
      title={title}
      links={MOCK_LINKS}
      onDeleteChat={(id) => {
        const before = mockChats.get();
        mockChats.set(before.filter((chat) => chat.id !== id));
        showToast("Chat deleted", {
          action: {
            label: "Undo",
            onAction: () => {
              mockChats.set(before);
            },
          },
        });
      }}
    >
      {children}
    </AppFrame>
  );
}
