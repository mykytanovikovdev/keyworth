import { CHAT_LIMITS } from "./chat.ts";
import { CHAT_TOOL_NAMES } from "./chat-tools.ts";
import { z } from "./zod.ts";

/*
 * A kept chat's `message` record: every message of that chat, read only when it
 * is opened (its place in the menu's list is the `conversation` record,
 * conversation.ts). Tool results are not kept: they are numbers of one day, some
 * of them amounts, and a chat continued later looks them up again.
 */

export const CHAT_SAVE = Object.freeze({
  /**
   * Bytes of a chat's messages as JSON. An envelope holds 64 KiB with its
   * padding; this leaves room for it.
   */
  maxBytes: 60 * 1024,
  maxMessages: 1000,
});

const messageId = z.string().min(1).max(64);

const savedPartSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("step") }),
  z.strictObject({
    type: z.literal("text"),
    text: z.string().max(CHAT_LIMITS.maxAnswerLength),
  }),
  z.strictObject({
    type: z.literal("tool"),
    name: z.enum(CHAT_TOOL_NAMES),
    /** As the model wrote it; checked against the tool's schema when read. */
    input: z.record(z.string(), z.unknown()),
    failed: z.literal(true).optional(),
  }),
]);

const savedMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({
    id: messageId,
    role: z.literal("user"),
    text: z.string().min(1).max(CHAT_LIMITS.maxQuestionLength),
  }),
  z.strictObject({
    id: messageId,
    role: z.literal("assistant"),
    parts: z.array(savedPartSchema).max(200),
    /** The person pressed Stop. */
    stopped: z.literal(true).optional(),
  }),
]);

export type SavedPart = z.infer<typeof savedPartSchema>;
export type SavedMessage = z.infer<typeof savedMessageSchema>;

/** What a `message` record holds: one chat's messages, oldest first. */
export const chatMessagesSchema = z.strictObject({
  v: z.literal(1),
  messages: z.array(savedMessageSchema).max(CHAT_SAVE.maxMessages),
});

export type ChatMessages = z.infer<typeof chatMessagesSchema>;
