import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import type {
  SavedMessage,
  SavedPart,
} from "../../../shared/schemas/chat-history.ts";
import { CHAT_TOOLS } from "../../../shared/schemas/chat-tools.ts";
import type { ChatToolName } from "../../../shared/schemas/chat-tools.ts";
import type { ChatUIMessage } from "./conversation.ts";

/*
 * A conversation between its two forms: the AI SDK's messages the page works
 * with, and the kept ones (shared/schemas/chat-history.ts). Kept messages hold
 * the question, the answer's text and which tools were called with what, never
 * what they returned. Reading them back, each call has the result OMITTED: the
 * model asks again when it needs the numbers.
 */

const OMITTED = {
  note: "Not kept. Call the tool again for the current numbers.",
};

const inputOf = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

/** The page's messages as they are kept; what was not finished is left out. */
export function toSaved(
  messages: readonly ChatUIMessage[],
  stopped: ReadonlySet<string> = new Set(),
): SavedMessage[] {
  return messages.flatMap((message): SavedMessage[] => {
    const text = message.parts.filter(isTextUIPart).map((part) => part.text);
    if (message.role === "user") {
      return [{ id: message.id, role: "user", text: text.join("\n\n") }];
    }
    if (message.role !== "assistant") return [];
    const parts = message.parts.flatMap((part): SavedPart[] => {
      if (part.type === "step-start") return [{ type: "step" }];
      if (isTextUIPart(part)) {
        return part.text === "" ? [] : [{ type: "text", text: part.text }];
      }
      if (!isToolUIPart(part)) return [];
      if (part.state !== "output-available" && part.state !== "output-error") {
        return [];
      }
      return [
        {
          type: "tool",
          name: getToolName(part) as ChatToolName,
          input: inputOf(part.input),
          ...(part.state === "output-error" && { failed: true as const }),
        },
      ];
    });
    // An answer stopped before its first word: the AI SDK takes no message
    // without parts, and there is nothing to show.
    if (!parts.some(({ type }) => type !== "step")) return [];
    return [
      {
        id: message.id,
        role: "assistant",
        parts,
        ...(stopped.has(message.id) && { stopped: true as const }),
      },
    ];
  });
}

/** Kept messages as the page works with them, and which answers were stopped. */
export function fromSaved(messages: readonly SavedMessage[]): {
  messages: ChatUIMessage[];
  stopped: Set<string>;
} {
  const stopped = new Set<string>();
  const ui = messages.map((message): ChatUIMessage => {
    if (message.role === "user") {
      return {
        id: message.id,
        role: "user",
        parts: [{ type: "text", text: message.text }],
      };
    }
    if (message.stopped) stopped.add(message.id);
    const parts = message.parts.flatMap((part, index): unknown[] => {
      if (part.type === "step") return [{ type: "step-start" as const }];
      if (part.type === "text") {
        return [{ type: "text" as const, text: part.text, state: "done" }];
      }
      // A call the tool would refuse now (its input changed) is left out: the
      // AI SDK refuses the whole conversation over one.
      const input = CHAT_TOOLS[part.name].inputSchema.safeParse(part.input);
      if (!input.success) return [];
      const call = {
        type: `tool-${part.name}`,
        toolCallId: `${message.id}-${String(index)}`,
        input: input.data,
      };
      return part.failed
        ? [{ ...call, state: "output-error", errorText: OMITTED.note }]
        : [{ ...call, state: "output-available", output: OMITTED }];
    });
    return {
      id: message.id,
      role: "assistant",
      parts: parts as ChatUIMessage["parts"],
    };
  });
  return { messages: ui, stopped };
}
