import {
  CHAT_SAVE,
  chatMessagesSchema,
  type ChatMessages,
  type SavedMessage,
} from "../../../shared/schemas/chat-history.ts";
import {
  type Conversation,
  conversationSchema,
} from "../../../shared/schemas/conversation.ts";
import { ApiError } from "../../vault/api.ts";
import { newRecord, readRecord, writeRecord } from "../../vault/records.ts";
import { type ChatEntry, entryOf, type VaultAccess } from "./chats.ts";
import { fits, mergeSaved, titleOf } from "./kept.ts";

/** A chat's messages. null when it is gone, or its messages cannot be read. */
export async function openChat(
  { vault, api }: VaultAccess,
  { bodyId }: ChatEntry,
): Promise<{ revision: number; messages: SavedMessage[] } | null> {
  const body = await readRecord(
    vault,
    api,
    "message",
    bodyId,
    chatMessagesSchema,
  );
  return body?.value
    ? { revision: body.revision, messages: body.value.messages }
    : null;
}

/** What saving a chat came to. */
export type SaveResult =
  | {
      state: "saved";
      chat: ChatEntry;
      /** The chat as it now is, when another device had written to it. */
      merged?: SavedMessage[];
    }
  /** Not stored (offline, locked, over a limit): the next save tries again. */
  | { state: "failed" }
  /** More than one record holds. */
  | { state: "full" }
  /** Deleted, here or on another device. */
  | { state: "gone" };

function newDraft(messages: readonly SavedMessage[]) {
  const first = messages.find(({ role }) => role === "user");
  const now = new Date().toISOString();
  const conversation: Conversation = {
    v: 1,
    title: (first?.role === "user" && titleOf(first.text)) || "Chat",
    createdAt: now,
    updatedAt: now,
    bodyId: crypto.randomUUID(),
  };
  return { id: crypto.randomUUID() as string, conversation };
}

const codeOf = (error: unknown) =>
  error instanceof ApiError ? error.code : undefined;

/**
 * Keeps one chat stored: creates it at its first message, then rewrites its
 * messages after each change. Saves run one after another, and a newer one
 * replaces those still waiting, so a fast typist's answers never overtake each
 * other. A chat changed on another device meanwhile is merged and written once
 * more.
 */
export class ChatSaver {
  private readonly access: VaultAccess;
  private entry: ChatEntry | null;
  private bodyRevision: number;
  /** A chat being created, kept until the server has answered for it. */
  private draft: { id: string; conversation: Conversation } | null = null;
  private waiting: {
    messages: readonly SavedMessage[];
    done: ((result: SaveResult) => void)[];
  } | null = null;
  private busy = false;
  private gone = false;

  constructor(
    access: VaultAccess,
    opened?: { entry: ChatEntry; bodyRevision: number },
  ) {
    this.access = access;
    this.entry = opened?.entry ?? null;
    this.bodyRevision = opened?.bodyRevision ?? 0;
  }

  get chat(): ChatEntry | null {
    return this.entry;
  }

  save(messages: readonly SavedMessage[]): Promise<SaveResult> {
    return new Promise((resolve) => {
      this.waiting = {
        messages,
        done: [...(this.waiting?.done ?? []), resolve],
      };
      if (!this.busy) void this.drain();
    });
  }

  private async drain(): Promise<void> {
    this.busy = true;
    while (this.waiting) {
      const { messages, done } = this.waiting;
      this.waiting = null;
      const result = await this.write(messages).catch((): SaveResult => ({
        state: "failed",
      }));
      for (const resolve of done) resolve(result);
    }
    // At once, not in a `finally` of its promise: whoever waited for the save
    // may save again in the same turn.
    this.busy = false;
  }

  private async write(messages: readonly SavedMessage[]): Promise<SaveResult> {
    if (this.gone) return { state: "gone" };
    if (messages.length === 0) return { state: "failed" };
    if (!fits(messages) || messages.length > CHAT_SAVE.maxMessages) {
      return { state: "full" };
    }
    if (!this.entry) return this.create(messages);
    return this.update(this.entry, messages);
  }

  private async create(messages: readonly SavedMessage[]): Promise<SaveResult> {
    const { vault, api } = this.access;
    // The same ids on a second try: when the first one's answer was lost, the
    // server says they are taken, and the chat is not created twice.
    this.draft ??= newDraft(messages);
    const { id, conversation } = this.draft;
    const body: ChatMessages = { v: 1, messages: [...messages] };
    const records = await Promise.all([
      newRecord(vault, "conversation", id, conversation),
      newRecord(vault, "message", conversation.bodyId, body),
    ]);
    let stored = false;
    try {
      await api.createRecords({ records });
    } catch (error) {
      if (codeOf(error) !== "conflict") throw error;
      stored = true;
    }
    this.draft = null;
    this.entry = entryOf(id, 1, conversation);
    this.bodyRevision = 1;
    return stored
      ? this.update(this.entry, messages)
      : { state: "saved", chat: this.entry };
  }

  private async update(
    entry: ChatEntry,
    messages: readonly SavedMessage[],
  ): Promise<SaveResult> {
    const { vault, api } = this.access;
    let kept = messages;
    let merged: SavedMessage[] | undefined;
    const put = (revision: number) =>
      writeRecord(vault, api, "message", entry.bodyId, revision, {
        v: 1,
        messages: [...kept],
      } satisfies ChatMessages);
    try {
      this.bodyRevision = await put(this.bodyRevision);
    } catch (error) {
      const code = codeOf(error);
      if (code === "not_found") return this.lost();
      if (code !== "conflict") throw error;
      // Another device wrote to this chat: add ours to what is there, once.
      const theirs = await openChat(this.access, entry);
      if (!theirs) return this.lost();
      kept = mergeSaved(theirs.messages, messages);
      merged = [...kept];
      if (!fits(kept)) return { state: "full" };
      this.bodyRevision = await put(theirs.revision);
    }
    const touched = await this.touch(entry);
    if (!touched) return this.lost();
    this.entry = touched;
    return { state: "saved", chat: touched, ...(merged && { merged }) };
  }

  /** The chat's place in the list: when it was last written. */
  private async touch(entry: ChatEntry): Promise<ChatEntry | null> {
    const { vault, api } = this.access;
    const updated: Conversation = {
      v: 1,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: new Date().toISOString(),
      bodyId: entry.bodyId,
    };
    const put = (revision: number) =>
      writeRecord(vault, api, "conversation", entry.id, revision, updated);
    try {
      return entryOf(entry.id, await put(entry.revision), updated);
    } catch (error) {
      const code = codeOf(error);
      if (code === "not_found") return null;
      if (code !== "conflict") throw error;
      const now = await readRecord(
        vault,
        api,
        "conversation",
        entry.id,
        conversationSchema,
      );
      if (!now) return null;
      return entryOf(entry.id, await put(now.revision), updated);
    }
  }

  private lost(): SaveResult {
    this.gone = true;
    return { state: "gone" };
  }
}
