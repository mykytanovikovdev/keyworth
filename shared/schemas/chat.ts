import { CHAT_TOOL_NAMES } from "./chat-tools.ts";
import { z } from "./zod.ts";

/*
 * A request to POST /api/chat/completions: the conversation so far, in the
 * OpenAI chat format the browser's model client sends (the AI SDK runs in the
 * browser; the server passes the model's stream back untouched). The server
 * keeps no history: the browser sends it every time and keeps its own
 * encrypted copy (CLAUDE.md, rule 4). Only `messages` is read: the model, the
 * instructions, the tools and the limits are the server's own
 * (worker/chat/route.ts), whatever else the body says.
 */

export const CHAT_LIMITS = Object.freeze({
  /** The request body: a conversation with the results of its tools. */
  maxBodyBytes: 128 * 1024,
  /** Messages a request may carry. */
  maxMessages: 40,
  /** The latest messages the model receives; earlier ones stay on the device. */
  modelMessages: 20,
  /** A question as typed: long enough for a pasted list of trades. */
  maxQuestionLength: 2000,
  /** An answer's text, as it comes back with the conversation. */
  maxAnswerLength: 20_000,
  /** A tool's result, as the browser sends it to the model. */
  maxToolResultLength: 32 * 1024,
  /** Tool calls in one model step. */
  maxToolCalls: 8,
  /** Model steps for one question; on the last it must answer without tools. */
  maxSteps: 6,
});

/** Line breaks are a question's own; nothing else that cannot be seen. */
const HIDDEN_BUT_LINE_BREAKS = /\p{Cf}|(?!\n)\p{Cc}/u;

export const questionSchema = z
  .string()
  .min(1)
  .max(CHAT_LIMITS.maxQuestionLength)
  .refine((text) => text.trim() !== "", "A question cannot be empty.")
  .refine(
    (text) => !HIDDEN_BUT_LINE_BREAKS.test(text),
    "A question cannot hold hidden characters.",
  );

const callId = z.string().min(1).max(100);

const toolCallSchema = z.object({
  id: callId,
  type: z.literal("function"),
  function: z.object({
    name: z.enum(CHAT_TOOL_NAMES),
    /** JSON, as the model wrote it; checked against the tool's schema. */
    arguments: z.string().max(4096),
  }),
});

const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: questionSchema }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().max(CHAT_LIMITS.maxAnswerLength).nullable(),
    tool_calls: z
      .array(toolCallSchema)
      .max(CHAT_LIMITS.maxToolCalls)
      .optional(),
  }),
  z.object({
    role: z.literal("tool"),
    tool_call_id: callId,
    content: z.string().max(CHAT_LIMITS.maxToolResultLength),
  }),
]);

export type ChatMessage = z.infer<typeof messageSchema>;

/**
 * Only `messages` is kept (other fields are dropped): a `system` message is
 * not a role this schema knows, so the browser cannot instruct the model.
 */
export const chatRequestSchema = z.object({
  messages: z
    .array(messageSchema)
    .min(1)
    .max(CHAT_LIMITS.maxMessages)
    .refine(
      (messages) => messages[0]?.role === "user",
      "A conversation starts with a question.",
    ),
});

/** The answer when the chat cannot answer now: why, and when to try again. */
export interface ChatRefusalJson {
  error: "budget" | "invalid_request" | "model_unavailable" | "rate_limited";
  /** For "budget": when today's limit resets (ISO, UTC). */
  resetsAt?: string;
}
