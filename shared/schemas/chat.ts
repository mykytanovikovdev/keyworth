import { CHAT_TOOL_NAMES } from "./chat-tools.ts";
import { z } from "./zod.ts";

/*
 * A request to POST /api/chat: the conversation so far, as the browser's chat
 * keeps it. The server holds no history: the browser sends it every time, and
 * keeps its own encrypted copy (CLAUDE.md, rule 4). These checks bound what
 * reaches the model; the AI SDK then checks each part's shape and each tool
 * call's input against the tools' schemas (worker/chat/route.ts).
 */

export const CHAT_LIMITS = Object.freeze({
  /** The request body: a conversation with the results of its tools. */
  maxBodyBytes: 128 * 1024,
  /** Messages a request may carry. */
  maxMessages: 40,
  /** The latest messages the model receives; earlier ones stay on the device. */
  modelMessages: 20,
  /** Parts of one message: text, steps and tool calls. */
  maxParts: 60,
  /** A question as typed: long enough for a pasted list of trades. */
  maxQuestionLength: 2000,
  /** An answer's text, as it comes back with the conversation. */
  maxAnswerLength: 20_000,
  /** Model steps for one question; past them it must answer without tools. */
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

const PART_TYPES = new Set<string>([
  "text",
  "step-start",
  ...CHAT_TOOL_NAMES.map((name) => `tool-${name}`),
]);

/** A part's own fields are checked by the AI SDK; here only its kind. */
const partSchema = z.looseObject({
  type: z
    .string()
    .refine((type) => PART_TYPES.has(type), "Not a part the chat uses."),
});

const messageSchema = z
  .object({
    id: z.string().min(1).max(100),
    role: z.enum(["user", "assistant"]),
    parts: z.array(partSchema).min(1).max(CHAT_LIMITS.maxParts),
  })
  .superRefine(({ role, parts }, context) => {
    for (const part of parts) {
      if (part.type !== "text") continue;
      if (role === "assistant") {
        const text = (part as { text?: unknown }).text;
        if (
          typeof text !== "string" ||
          text.length > CHAT_LIMITS.maxAnswerLength
        ) {
          context.addIssue({ code: "custom", message: "An answer too long." });
        }
        continue;
      }
      const question = questionSchema.safeParse(
        (part as { text?: unknown }).text,
      );
      if (!question.success) {
        context.addIssue({ code: "custom", message: "Not a question." });
      }
    }
    if (role === "user" && parts.some((part) => part.type !== "text")) {
      context.addIssue({ code: "custom", message: "A question is text only." });
    }
  });

export const chatRequestSchema = z.object({
  /** The chat's id in the browser; the server does not keep it. */
  id: z.string().min(1).max(100),
  messages: z
    .array(messageSchema)
    .min(1)
    .max(CHAT_LIMITS.maxMessages)
    .refine(
      (messages) => messages[0]?.role === "user",
      "A conversation starts with a question.",
    ),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** The answer when the chat cannot answer now: why, and when to try again. */
export interface ChatRefusalJson {
  error: "budget" | "busy" | "invalid_request" | "rate_limited";
  /** For "budget": when today's limit resets (ISO, UTC). */
  resetsAt?: string;
}
