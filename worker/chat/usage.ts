/*
 * What a step cost, read from the stream the browser receives: Workers AI puts
 * a running `usage` with its `neurons` in its events. The server never parses
 * the stream as it goes to the browser (that cost ~40 µs of CPU per event, past
 * the Free plan's 10 ms on a long answer); it reads a copy afterwards, keeping
 * only the last few kilobytes, where the final count is.
 */

/** The text kept from the end of the stream: the last events. */
const TAIL_CHARS = 8 * 1024;

/**
 * The step's neurons, from the end of the stream: the largest count among the
 * last events (the final one; an all-zero count can come just before it), in
 * whole neurons, rounded up. Null when no event says.
 */
export function neuronsInTail(tail: string): number | null {
  let most: number | null = null;
  for (const line of tail.split("\n")) {
    if (!line.startsWith("data: {") || !line.includes('"neurons"')) continue;
    try {
      const event = JSON.parse(line.slice(6)) as {
        usage?: { neurons?: unknown };
      };
      const neurons = event.usage?.neurons;
      if (typeof neurons === "number" && Number.isFinite(neurons)) {
        most = Math.max(most ?? 0, neurons);
      }
    } catch {
      // A line cut by the tail's start; the later events have the count.
    }
  }
  return most === null ? null : Math.ceil(most);
}

/** Reads a copy of the stream to its end and returns what the step cost. */
export async function neuronsOf(
  stream: ReadableStream<Uint8Array>,
): Promise<number | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tail = (tail + decoder.decode(value, { stream: true })).slice(-TAIL_CHARS);
  }
  return neuronsInTail(tail + decoder.decode());
}
