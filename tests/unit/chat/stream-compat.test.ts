import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isStepCount, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { CHAT_TOOLS } from "../../../shared/schemas/chat-tools.ts";
import {
  WORKERS_AI_TEXT,
  WORKERS_AI_TOOL_CALL,
} from "../../support/workers-ai.ts";

/*
 * The server passes Workers AI's stream to the browser untouched, so the
 * browser's model client must read it as it is. Here the client the chat uses
 * (@ai-sdk/openai-compatible in the AI SDK) reads the recorded streams, as it
 * will from /api/chat/completions.
 */

function modelAnswering(recorded: string) {
  const requests: Request[] = [];
  const provider = createOpenAICompatible({
    name: "keyworth",
    baseURL: "https://keyworth.test/api",
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        new Response(recorded, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    },
  });
  return { model: provider.chatModel("keyworth-chat"), requests };
}

describe("the browser's model client on Workers AI's stream", () => {
  it("reads a streamed answer and its usage", async () => {
    const { model, requests } = modelAnswering(WORKERS_AI_TEXT);

    const result = streamText({ model, prompt: "What is a drawdown?" });

    const text = await result.text;
    expect(text).toMatch(/^A drawdown is/);
    expect((await result.usage).outputTokens).toBe(42);
    expect(await result.finishReason).toBe("stop");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(
      "/api/chat/completions",
    );
  });

  it("reads a tool call, with the input the tool's schema accepts", async () => {
    const { model } = modelAnswering(WORKERS_AI_TOOL_CALL);

    const result = streamText({
      model,
      prompt: "How did my portfolio do this month?",
      tools: {
        get_portfolio: {
          description: CHAT_TOOLS.get_portfolio.description,
          inputSchema: CHAT_TOOLS.get_portfolio.inputSchema,
        },
      },
      stopWhen: isStepCount(1),
    });

    const calls = await result.toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      toolName: "get_portfolio",
      input: { period: "1M" },
    });
    expect(await result.finishReason).toBe("tool-calls");
  });
});
