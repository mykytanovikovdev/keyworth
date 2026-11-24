import { convertToModelMessages } from "ai";
import { describe, expect, it } from "vitest";
import {
  CHAT_SAVE,
  chatMessagesSchema,
  type SavedMessage,
} from "../../../shared/schemas/chat-history.ts";
import {
  conversationSchema,
  MAX_TITLE,
} from "../../../shared/schemas/conversation.ts";
import type { ChatUIMessage } from "../../../src/features/chat/conversation.ts";
import { fits, mergeSaved, titleOf } from "../../../src/features/chat/kept.ts";
import { fromSaved, toSaved } from "../../../src/features/chat/saved.ts";

/*
 * A chat as it is kept: no tool result, only what is finished, and a form the
 * AI SDK takes back when the chat goes on.
 */

const question = (id: string, text: string): ChatUIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

/** An answer with one tool call, whose result holds figures. */
const answer = (id: string, text: string): ChatUIMessage =>
  ({
    id,
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-get_portfolio",
        toolCallId: "call-1",
        state: "output-available",
        input: { period: "1M", includeAmounts: true },
        output: { total: "48213.77", holdings: [{ share: 0.61 }] },
      },
      { type: "step-start" },
      { type: "text", text, state: "done" },
    ],
  }) as unknown as ChatUIMessage;

describe("titleOf", () => {
  it("is the first question, on one line", () => {
    expect(titleOf("How did my\n portfolio do?")).toBe(
      "How did my portfolio do?",
    );
  });

  it("is cut between words, and is never longer than the list shows", () => {
    const long =
      "What happened to my biggest holding over the last twelve months and why";
    const title = titleOf(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(title).toMatch(/…$/);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
    expect(title).not.toMatch(/\s…$/);
    expect(titleOf("x".repeat(200)).length).toBe(MAX_TITLE);
  });

  it("gives a title the schema takes", () => {
    expect(
      conversationSchema.safeParse({
        v: 1,
        title: titleOf("я ".repeat(100)),
        createdAt: "2026-11-24T10:00:00.000Z",
        updatedAt: "2026-11-24T10:00:00.000Z",
        bodyId: "0b8f6c1e-7d2a-4c3b-9e5f-1a2b3c4d5e6f",
      }).success,
    ).toBe(true);
  });
});

describe("keeping and reading back", () => {
  const messages = [question("q1", "How am I doing?"), answer("a1", "Well.")];

  it("keeps no tool result: only its name and what it was asked", () => {
    const saved = toSaved(messages);

    expect(JSON.stringify(saved)).not.toMatch(/48213|0\.61|output|holdings/);
    expect(saved).toEqual([
      { id: "q1", role: "user", text: "How am I doing?" },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step" },
          {
            type: "tool",
            name: "get_portfolio",
            input: { period: "1M", includeAmounts: true },
          },
          { type: "step" },
          { type: "text", text: "Well." },
        ],
      },
    ]);
    expect(
      chatMessagesSchema.safeParse({ v: 1, messages: saved }).success,
    ).toBe(true);
  });

  it("leaves out a call without a result, and an answer with nothing in it", () => {
    const running = {
      id: "a2",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-get_prices",
          toolCallId: "c",
          state: "input-available",
          input: { assetIds: ["crypto:bitcoin"] },
        },
      ],
    } as unknown as ChatUIMessage;
    expect(toSaved([question("q", "Prices?"), running])).toEqual([
      { id: "q", role: "user", text: "Prices?" },
    ]);
  });

  it("marks an answer the person stopped", () => {
    const [, saved] = toSaved(messages, new Set(["a1"]));
    expect(saved).toMatchObject({ id: "a1", stopped: true });
    expect(fromSaved(toSaved(messages, new Set(["a1"]))).stopped).toEqual(
      new Set(["a1"]),
    );
    expect(fromSaved(toSaved(messages)).stopped.size).toBe(0);
  });

  it("gives back messages the AI SDK sends to the model, with no old figures", async () => {
    const { messages: back } = fromSaved(toSaved(messages));

    const model = await convertToModelMessages(back);

    expect(model.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const text = JSON.stringify(model);
    expect(text).not.toMatch(/48213|0\.61/);
    expect(text).toMatch(/Call the tool again/);
  });

  it("drops a kept call whose input the tool would refuse now", () => {
    const { messages: back } = fromSaved([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: "tool",
            name: "get_prices",
            input: { assetIds: "not-a-list" },
          },
          { type: "text", text: "Hello" },
        ],
      },
    ]);
    expect(back[0]?.parts.map(({ type }) => type)).toEqual(["text"]);
  });

  it("survives saving again after reading, so a chat opened twice does not change", () => {
    const saved = toSaved(messages);
    expect(toSaved(fromSaved(saved).messages)).toEqual(saved);
  });
});

describe("fits", () => {
  it("holds a chat to what one record takes", () => {
    const small: SavedMessage[] = [{ id: "q", role: "user", text: "Hi" }];
    expect(fits(small)).toBe(true);
    const big = Array.from({ length: 60 }, (_, index): SavedMessage => ({
      id: `q${String(index)}`,
      role: "user",
      text: "x".repeat(1100),
    }));
    expect(fits(big)).toBe(false);
  });

  it("counts bytes, not characters", () => {
    // 1,900 Cyrillic letters are 3,800 bytes.
    const messages = Array.from({ length: 18 }, (_, index): SavedMessage => ({
      id: `q${String(index)}`,
      role: "user",
      text: "я".repeat(1900),
    }));
    expect(JSON.stringify(messages).length).toBeLessThan(CHAT_SAVE.maxBytes);
    expect(fits(messages)).toBe(false);
  });
});

describe("mergeSaved", () => {
  const user = (id: string, text = id): SavedMessage => ({
    id,
    role: "user",
    text,
  });
  const reply = (id: string, text: string): SavedMessage => ({
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  });

  it("puts what only this device has after what is there", () => {
    expect(
      mergeSaved(
        [user("1"), reply("2", "two"), user("3")],
        [user("1"), reply("2", "two"), user("4")],
      ).map(({ id }) => id),
    ).toEqual(["1", "2", "3", "4"]);
  });

  it("takes this device's version of a message both have: it may have grown", () => {
    const [merged] = mergeSaved(
      [reply("2", "par")],
      [reply("2", "partly done")],
    );
    expect(merged).toEqual(reply("2", "partly done"));
  });

  it("changes nothing when both are the same", () => {
    const list = [user("1"), reply("2", "two")];
    expect(mergeSaved(list, list)).toEqual(list);
  });
});
