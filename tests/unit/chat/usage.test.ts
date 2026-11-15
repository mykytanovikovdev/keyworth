import { describe, expect, it } from "vitest";
import { neuronsInTail, neuronsOf } from "../../../worker/chat/usage.ts";
import {
  WORKERS_AI_TEXT,
  WORKERS_AI_TOOL_CALL,
} from "../../support/workers-ai.ts";

/*
 * A step's cost, read from the end of the stream the browser gets: Workers AI
 * reports a running count of neurons in its events.
 */

const event = (usage: object) =>
  `data: ${JSON.stringify({ choices: [], usage })}\n\n`;

describe("neuronsInTail", () => {
  it("reads the recorded streams' final counts, rounded up", () => {
    expect(neuronsInTail(WORKERS_AI_TEXT)).toBe(2); // 1.6333
    expect(neuronsInTail(WORKERS_AI_TOOL_CALL)).toBe(3); // 2.0692
  });

  it("takes the largest count: an all-zero one can come just before the last", () => {
    const tail =
      event({ neurons: 0.4 }) +
      event({ neurons: 0 }) +
      event({ neurons: 7.01 });

    expect(neuronsInTail(tail)).toBe(8);
  });

  it("skips a line cut at the tail's start, and anything that is not a count", () => {
    const tail = `ons": 99}}\n\n${event({ neurons: "12" })}${event({ neurons: 3.2 })}data: [DONE]\n\n`;

    expect(neuronsInTail(tail)).toBe(4);
  });

  it("is null when no event says", () => {
    expect(neuronsInTail("data: {}\n\ndata: [DONE]\n\n")).toBeNull();
  });
});

describe("neuronsOf", () => {
  it("reads a stream to its end, in pieces", async () => {
    const bytes = new TextEncoder().encode(WORKERS_AI_TOOL_CALL);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 100) {
          controller.enqueue(bytes.slice(at, at + 100));
        }
        controller.close();
      },
    });

    expect(await neuronsOf(stream)).toBe(3);
  });
});
