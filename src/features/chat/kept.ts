import {
  CHAT_SAVE,
  type SavedMessage,
} from "../../../shared/schemas/chat-history.ts";
import { MAX_TITLE } from "../../../shared/schemas/conversation.ts";

/*
 * Kept messages on their own: their title, their size, two versions of them.
 */

/** Words, cut between two of them, short enough for the list. */
export function titleOf(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  if (line.length <= MAX_TITLE) return line;
  const cut = line.slice(0, MAX_TITLE - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_TITLE / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Whether the chat still fits one record. */
export const fits = (messages: readonly SavedMessage[]): boolean =>
  new TextEncoder().encode(JSON.stringify({ v: 1, messages })).length <=
  CHAT_SAVE.maxBytes;

/**
 * Two versions of the same chat, from two tabs or devices: what is there, then
 * what only this one has. A message both have is this one's, which may have
 * grown since (an answer that was still being written).
 */
export function mergeSaved(
  theirs: readonly SavedMessage[],
  ours: readonly SavedMessage[],
): SavedMessage[] {
  const own = new Map(ours.map((message) => [message.id, message]));
  const known = new Set(theirs.map(({ id }) => id));
  return [
    ...theirs.map((message) => own.get(message.id) ?? message),
    ...ours.filter(({ id }) => !known.has(id)),
  ];
}
