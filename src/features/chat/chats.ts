import {
  type Conversation,
  conversationSchema,
} from "../../../shared/schemas/conversation.ts";
import type { VaultApi } from "../../vault/api.ts";
import { readRecords } from "../../vault/records.ts";
import type { Vault } from "../../vault/vault.ts";
import type { ChatSummary } from "./chat-list.ts";

/*
 * Kept chats: encrypted records, two to a chat (shared/schemas/chat-history.ts).
 * The vault and the API come in as arguments, so tests run it against a fake
 * server.
 */

export interface VaultAccess {
  vault: Vault;
  api: VaultApi;
}

/** A chat in the list. */
export interface ChatEntry extends ChatSummary {
  /** The `message` record with its messages. */
  bodyId: string;
  createdAt: string;
  /** The revision its `conversation` record was read with. */
  revision: number;
}

export interface ChatList {
  /** Newest first. */
  chats: ChatEntry[];
  /** Conversation records that do not decrypt or fit the schema. */
  damaged: string[];
}

export const entryOf = (
  id: string,
  revision: number,
  { title, createdAt, updatedAt, bodyId }: Conversation,
): ChatEntry => ({ id, revision, title, createdAt, updatedAt, bodyId });

export async function loadChats({
  vault,
  api,
}: VaultAccess): Promise<ChatList> {
  const records = await readRecords(
    vault,
    api,
    "conversation",
    conversationSchema,
  );
  return {
    chats: records
      .flatMap(({ id, revision, value }) =>
        value ? [entryOf(id, revision, value)] : [],
      )
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    damaged: records.flatMap(({ id, value }) => (value ? [] : [id])),
  };
}
