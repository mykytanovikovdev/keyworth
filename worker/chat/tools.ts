import { CHAT_TOOLS } from "../../shared/schemas/chat-tools.ts";
import type { ChatMessage } from "../../shared/schemas/chat.ts";
import { z } from "../../shared/schemas/zod.ts";

/*
 * The tools as the server gives them to the model: definitions only, in the
 * OpenAI format, built once when the Worker starts. The model's call goes to
 * the browser, which runs it on the decrypted data and sends the result back
 * with the next request (CLAUDE.md, rule 9). Whatever tools the browser's
 * request lists, the model gets these.
 */

type JsonSchema = Record<string, unknown>;

/**
 * A tool's input as JSON Schema, lighter for the model: no `$schema`, and no
 * date patterns (zod spells a calendar into a long regular expression; the
 * `date` format says the same in a word, and the server checks the input).
 */
function parametersOf(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  delete json.$schema;
  const lighten = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    const record = node as JsonSchema;
    if (record.format === "date") delete record.pattern;
    for (const value of Object.values(record)) lighten(value);
  };
  lighten(json);
  return json;
}

export const TOOL_DEFINITIONS = Object.entries(CHAT_TOOLS).map(
  ([name, { description, inputSchema }]) => ({
    type: "function" as const,
    function: { name, description, parameters: parametersOf(inputSchema) },
  }),
);

/**
 * Whether the conversation's tool calls could have come from the model: each
 * call's input is one its tool accepts, and each result answers a call made
 * before it. They are the model's own past calls, sent back with the
 * conversation; anything else is refused rather than passed on.
 */
export function toolCallsValid(messages: readonly ChatMessage[]): boolean {
  const called = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool") {
      if (!called.has(message.tool_call_id)) return false;
      continue;
    }
    if (message.role !== "assistant") continue;
    for (const { id, function: call } of message.tool_calls ?? []) {
      let input: unknown;
      try {
        input = JSON.parse(call.arguments);
      } catch {
        return false;
      }
      const tool = CHAT_TOOLS[call.name];
      if (!tool.inputSchema.safeParse(input).success) return false;
      called.add(id);
    }
  }
  return true;
}
