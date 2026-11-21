import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { latestMessages } from "../../../src/features/chat/history.ts";

/*
 * Which messages go to the model: the latest, within the server's limit, cut
 * only before a question, so no tool result loses the call it answers.
 */

const question = (text: string): ModelMessage => ({
  role: "user",
  content: text,
});
const answer = (text: string): ModelMessage => ({
  role: "assistant",
  content: text,
});
const call = (id: string): ModelMessage => ({
  role: "assistant",
  content: [
    { type: "tool-call", toolCallId: id, toolName: "get_portfolio", input: {} },
  ],
});
/** One tool message holding `count` results: as many messages in the request. */
const results = (id: string, count: number): ModelMessage => ({
  role: "tool",
  content: Array.from({ length: count }, (_, index) => ({
    type: "tool-result",
    toolCallId: `${id}-${String(index)}`,
    toolName: "get_portfolio",
    output: { type: "json", value: {} },
  })),
});

/** A question with one tool call and its answer: four messages in the request. */
const turn = (n: number): ModelMessage[] => [
  question(`q${String(n)}`),
  call(`c${String(n)}`),
  results(`c${String(n)}`, 1),
  answer(`a${String(n)}`),
];

describe("the messages the model gets", () => {
  it("are all of them within the limit", () => {
    const messages = [...turn(1), ...turn(2)];

    expect(latestMessages(messages, 8)).toEqual(messages);
  });

  it("drop the oldest questions whole until they fit", () => {
    const messages = [...turn(1), ...turn(2), ...turn(3)];

    expect(latestMessages(messages, 9)).toEqual([...turn(2), ...turn(3)]);
    expect(latestMessages(messages, 7)).toEqual(turn(3));
  });

  it("count each tool result as a message", () => {
    const heavy: ModelMessage[] = [
      question("q1"),
      call("c1"),
      results("c1", 5),
      answer("a1"),
    ];
    const messages = [...heavy, ...turn(2)];

    // 8 + 4 = 12 in the request: over 10, so the first question goes.
    expect(latestMessages(messages, 10)).toEqual(turn(2));
  });

  it("keep the question being asked, even over the limit", () => {
    const messages = [...turn(1), question("q2"), call("c2"), results("c2", 8)];

    expect(latestMessages(messages, 5)).toEqual(messages.slice(4));
  });
});
