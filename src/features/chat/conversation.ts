import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Chat } from "@ai-sdk/react";
import {
  DirectChatTransport,
  type InferUITools,
  isStepCount,
  ToolLoopAgent,
  type UIMessage,
} from "ai";
import { CHAT_LIMITS } from "../../../shared/schemas/chat.ts";
import type { ChatData } from "./chat-data.ts";
import { chatSession } from "./chat-session.ts";
import { latestMessages } from "./history.ts";
import { failureCode } from "./refusals.ts";
import { type ChatTools, chatTools } from "./tools.ts";

/*
 * The conversation: the agent's loop runs here in the browser, where the tools
 * read the decrypted data; each model step is one request to Keyworth's own
 * /api/chat/completions, which adds the model, the instructions and the limits
 * and passes the model's stream back untouched (worker/chat). One conversation
 * per tab, kept in memory until New chat or the vault locking (until the
 * encrypted history of phase 5.3).
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

let current: {
  generation: number;
  userId: string;
  chat: Chat<ChatUIMessage>;
} | null = null;

// New chat, or the data key closing: the conversation goes.
chatSession.subscribe(() => {
  void current?.chat.stop();
  current = null;
});

export function conversation(
  userId: string,
  load: () => Promise<ChatData>,
): Chat<ChatUIMessage> {
  const generation = chatSession.generation();
  if (current?.generation === generation && current.userId === userId) {
    return current.chat;
  }
  const agent = new ToolLoopAgent({
    model,
    tools: chatTools(load),
    stopWhen: isStepCount(CHAT_LIMITS.maxSteps),
    // A refused or failed call is not asked again on its own: each try spends
    // the day's budget and the minute's limit.
    maxRetries: 0,
    prepareStep: ({ messages }) => ({ messages: latestMessages(messages) }),
  });
  const chat = new Chat<ChatUIMessage>({
    transport: new DirectChatTransport({ agent, onError: failureCode }),
  });
  current = { generation, userId, chat };
  return chat;
}
