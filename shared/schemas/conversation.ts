import { recordIdSchema } from "./vault.ts";
import { z } from "./zod.ts";

/*
 * A kept chat is two encrypted records: this one, `conversation`, which the
 * menu's list reads, and `message` with everything said in it
 * (chat-history.ts). The server sees that they exist, their size buckets and
 * dates; only the browser sees this. A file of its own: the list is in the first
 * load, the messages' schema is not.
 */

export const MAX_TITLE = 60;

/** What a `conversation` record holds: the chat in the menu's list. */
export const conversationSchema = z.strictObject({
  v: z.literal(1),
  title: z.string().min(1).max(MAX_TITLE),
  createdAt: z.iso.datetime(),
  /** When its last message was written. */
  updatedAt: z.iso.datetime(),
  /** The `message` record with this chat's messages. */
  bodyId: recordIdSchema,
});

export type Conversation = z.infer<typeof conversationSchema>;
