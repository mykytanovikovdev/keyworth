import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Chat } from "@ai-sdk/react";
import {
  DirectChatTransport,
  generateId,
  type InferUITools,
  isStepCount,
  ToolLoopAgent,
  type UIMessage,
} from "ai";
import { CHAT_LIMITS } from "../../../shared/schemas/chat.ts";
import type { SavedMessage } from "../../../shared/schemas/chat-history.ts";
import type { ChatData } from "./chat-data.ts";
import { ChatSaver, type SaveResult } from "./chat-saver.ts";
import { chatSession } from "./chat-session.ts";
import type { ChatEntry, VaultAccess } from "./chats.ts";
import { chatDeletes } from "./deleting.ts";
import { latestMessages } from "./history.ts";
import { failureCode } from "./refusals.ts";
import { fromSaved, toSaved } from "./saved.ts";
import { type ChatTools, chatTools } from "./tools.ts";

/*
 * The conversation: the agent's loop runs here in the browser, where the tools
 * read the decrypted data; each model step is one request to Keyworth's own
 * /api/chat/completions, which adds the model, the instructions and the limits
 * and passes the model's stream back untouched (worker/chat). One conversation
 * at a time is open; it is kept encrypted after each question and each answer
 * (chat-saver.ts), and leaves memory with New chat, opening another one or the
 * vault locking.
 */

/** A message with this chat's tools; no metadata or data parts of its own. */
export type ChatUIMessage = UIMessage<unknown, never, InferUITools<ChatTools>>;

// This site's own API, as an absolute address: the client builds its URLs
// with `new URL`, which takes no relative path.
const provider = createOpenAICompatible({
  name: "keyworth",
  baseURL: `${window.location.origin}/api`,
});
// The server chooses the model; the client needs a name all the same.
const model = provider.chatModel("keyworth");

/** How keeping the chat goes, as the page shows it. */
export interface SaveView {
  /** The kept chat's id, once it has one. */
  chatId: string | null;
  /** Why it is not kept as it is on the screen, if it is not. */
  trouble: Exclude<SaveResult["state"], "saved"> | null;
}

export interface Conversation {
  /** One for each conversation, for React. */
  key: number;
  generation: number;
  userId: string;
  chat: Chat<ChatUIMessage>;
  saver: ChatSaver;
  /** Ids of messages after which the person pressed Stop. */
  stopped: Set<string>;
  /** Whether the address is already this chat's own, and telling it so. */
  isPlaced: () => boolean;
  place: () => void;
  ask: (text: string) => void;
  stop: () => void;
  subscribe: (listener: () => void) => () => void;
  saveView: () => SaveView;
}

interface Start {
  userId: string;
  load: () => Promise<ChatData>;
  access: VaultAccess;
  onSaved: (chat: ChatEntry) => void;
  /** A kept chat to go on with. */
  opened?: {
    entry: ChatEntry;
    bodyRevision: number;
    messages: readonly SavedMessage[];
  };
}

let current: Conversation | null = null;
let keys = 0;

// New chat, or the data key closing: the conversation goes.
chatSession.subscribe(() => {
  void current?.chat.stop();
  current = null;
});

/**
 * The open conversation, when it is the one the address asks for: the chat with
 * this id, or for an address without one a chat that has no address yet.
 */
export function currentConversation(
  userId: string,
  chatId: string | undefined,
): Conversation | null {
  if (
    current?.generation !== chatSession.generation() ||
    current.userId !== userId
  ) {
    return null;
  }
  if (chatId === undefined) return current.isPlaced() ? null : current;
  return current.saver.chat?.id === chatId ? current : null;
}

/** Opens a conversation: a new one, or a kept one to go on with. */
export function startConversation({
  userId,
  load,
  access,
  onSaved,
  opened,
}: Start): Conversation {
  // Another was open: what it has written so far is kept, the rest is not asked.
  void current?.chat.stop();
  const agent = new ToolLoopAgent({
    model,
    tools: chatTools(load),
    stopWhen: isStepCount(CHAT_LIMITS.maxSteps),
    // A refused or failed call is not asked again on its own: each try spends
    // the day's budget and the minute's limit.
    maxRetries: 0,
    prepareStep: ({ messages }) => ({ messages: latestMessages(messages) }),
  });
  const before = fromSaved(opened?.messages ?? []);
  const { stopped } = before;
  const saver = new ChatSaver(access, opened);
  const listeners = new Set<() => void>();
  let placed = opened !== undefined;
  let view: SaveView = { chatId: saver.chat?.id ?? null, trouble: null };

  const keep = async (messages: readonly ChatUIMessage[]) => {
    // A new chat must not go with "Delete all chats" still waiting.
    if (!saver.chat) await chatDeletes.flush();
    const result = await saver.save(toSaved(messages, stopped));
    if (result.state === "saved") {
      onSaved(result.chat);
      // Another device's turns: shown once nothing is being written here.
      if (result.merged && chat.status === "ready") {
        chat.messages = fromSaved(result.merged).messages;
      }
    }
    view = {
      chatId: saver.chat?.id ?? null,
      trouble: result.state === "saved" ? null : result.state,
    };
    for (const listener of listeners) listener();
  };

  const chat = new Chat<ChatUIMessage>({
    messages: before.messages,
    transport: new DirectChatTransport({ agent, onError: failureCode }),
    onFinish: ({ messages, message, isAbort }) => {
      if (isAbort) stopped.add(message.id);
      void keep(messages);
    },
  });

  const conversation: Conversation = {
    key: ++keys,
    generation: chatSession.generation(),
    userId,
    chat,
    saver,
    stopped,
    isPlaced: () => placed,
    place: () => {
      placed = true;
    },
    ask: (text) => {
      const question: ChatUIMessage = {
        id: generateId(),
        role: "user",
        parts: [{ type: "text", text }],
      };
      // Kept before the answer: a tab closed meanwhile keeps the question.
      void keep([...chat.messages, question]);
      void chat.sendMessage(question);
    },
    stop: () => {
      const last = chat.messages.at(-1);
      if (last) stopped.add(last.id);
      void chat.stop();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    saveView: () => view,
  };
  current = conversation;
  return conversation;
}
