import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { showToast } from "../../ui/index.ts";
import { chatSession } from "./chat-session.ts";
import type { ChatSummary } from "./chat-list.ts";
import { chatDeletes } from "./deleting.ts";
import { access, chatsQuery, dropChats } from "./queries.ts";

/** A chat whose record does not decrypt: shown so it can be deleted. */
const UNREADABLE = "Can't be opened";
/** Where unreadable chats sort: last. */
const LONG_AGO = "1970-01-01T00:00:00.000Z";

/** The kept chats, without those on their way out; undefined while loading. */
export function useChats(userId: string): readonly ChatSummary[] | undefined {
  const { data } = useQuery(chatsQuery(userId));
  const hidden = useSyncExternalStore(
    chatDeletes.subscribe,
    chatDeletes.hidden,
  );
  return useMemo(() => {
    if (!data) return undefined;
    const all: ChatSummary[] = [
      ...data.chats,
      ...data.damaged.map((id) => ({
        id,
        title: UNREADABLE,
        updatedAt: LONG_AGO,
      })),
    ];
    return all.filter(({ id }) => !hidden.all && !hidden.ids.has(id));
  }, [data, hidden]);
}

/** Deleting one chat or all of them: hidden at once, Undo in the toast. */
export function useDeleteChats(userId: string) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const start = (
    chats: readonly string[] | "all",
    title: string,
    remove: (leaving: boolean) => Promise<unknown>,
  ) => {
    const open = pathname.startsWith("/chat/");
    if (
      open &&
      (chats === "all" || chats.includes(pathname.slice("/chat/".length)))
    ) {
      chatSession.startOver();
      void navigate({ to: "/chat/{-$chatId}", params: {} });
    }
    const { undo, commit } = chatDeletes.start({
      chats,
      run: async ({ leaving }) => {
        await remove(leaving);
        dropChats(client, userId, chats);
      },
      onFail: () => {
        showToast("Couldn't delete", {
          tone: "error",
          description: "It is back in the list. Try again in a moment.",
        });
      },
    });
    showToast(title, {
      action: { label: "Undo", onAction: undo },
      // Undo leaves nothing to commit.
      onClose: () => void commit(),
    });
  };

  return {
    /** One chat, or one that cannot be read (then its only record). */
    remove: (id: string) => {
      const bodyId = client
        .getQueryData(chatsQuery(userId).queryKey)
        ?.chats.find((chat) => chat.id === id)?.bodyId;
      start([id], "Chat deleted", (leaving) =>
        access.api.deleteRecords(bodyId ? [id, bodyId] : [id], {
          of: "chats",
          leaving,
        }),
      );
    },
    removeAll: () => {
      start("all", "All chats deleted", (leaving) =>
        access.api.deleteAllChats({ leaving }),
      );
    },
  };
}
