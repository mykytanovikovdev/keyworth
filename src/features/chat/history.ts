import type { ModelMessage } from "ai";
import { CHAT_LIMITS } from "../../../shared/schemas/chat.ts";

/*
 * The conversation as it goes to the model: the server takes at most
 * `CHAT_LIMITS.maxMessages` messages and refuses more, so the browser sends
 * the latest ones. It cuts only before a question: cut after it, a tool's
 * result could arrive without the call it answers, which the server refuses
 * too. Earlier messages stay on the screen; the model just no longer sees them.
 */

/** Messages one model message becomes in the request: a result each per tool. */
const sizeOf = (message: ModelMessage): number =>
  message.role === "tool" ? message.content.length : 1;

export function latestMessages(
  messages: readonly ModelMessage[],
  limit: number = CHAT_LIMITS.maxMessages,
): ModelMessage[] {
  let size = messages.reduce((sum, message) => sum + sizeOf(message), 0);
  let start = 0;
  while (size > limit && start < messages.length) {
    // Drop the oldest question and everything up to the next one.
    let next = start + 1;
    while (next < messages.length && messages[next]?.role !== "user") next++;
    if (next >= messages.length) break;
    for (const message of messages.slice(start, next)) size -= sizeOf(message);
    start = next;
  }
  return messages.slice(start);
}
