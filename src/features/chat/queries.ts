import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { httpApi, vault } from "../../vault/index.ts";
import {
  type ChatEntry,
  type ChatList,
  loadChats,
  type VaultAccess,
} from "./chats.ts";

/*
 * The kept chats as the menu and the pages read them. Under ["vault", …], like
 * every decrypted query, so they go when the vault locks (src/App.tsx). Light:
 * no AI SDK, since the menu is in the first load.
 */

/** This page's vault and API: the services take them as arguments. */
export const access: VaultAccess = { vault, api: httpApi };

export const chatsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["vault", userId, "chats"],
    queryFn: () => loadChats(access),
    // Another device may have added some: read again on coming back.
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

const isUnlocked = () => vault.getState().status === "unlocked";

/** Puts a chat just saved into the list, newest first. */
export function putChat(client: QueryClient, userId: string, chat: ChatEntry) {
  if (!isUnlocked()) return;
  client.setQueryData<ChatList>(chatsQuery(userId).queryKey, (list) => ({
    chats: [
      chat,
      ...(list?.chats ?? []).filter(({ id }) => id !== chat.id),
    ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    damaged: list?.damaged ?? [],
  }));
}

/** Leaves deleted chats out of the list. */
export function dropChats(
  client: QueryClient,
  userId: string,
  ids: readonly string[] | "all",
) {
  if (!isUnlocked()) return;
  const gone = (id: string) => ids === "all" || ids.includes(id);
  client.setQueryData<ChatList>(
    chatsQuery(userId).queryKey,
    (list) =>
      list && {
        chats: list.chats.filter(({ id }) => !gone(id)),
        damaged: list.damaged.filter((id) => !gone(id)),
      },
  );
}
