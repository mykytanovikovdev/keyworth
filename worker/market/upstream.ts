import { decimal } from "../../shared/money/decimal.ts";

/*
 * Calls to market data sources: a time limit, a size limit, and errors that
 * never name what was asked for. A request's URL holds asset ids or a search,
 * which say what someone owns or looks at, so it never reaches the logs.
 */

const TIMEOUT_MS = 8000;

/**
 * A JSON number as plain digits: JavaScript writes 3.55e-7 for small ones.
 * Only those go through the decimal library, which costs CPU on long series.
 */
export function plainDigits(value: number): string {
  const text = String(value);
  return /e/i.test(text) ? decimal(text).toString() : text;
}

/**
 * Whether a price or a rate from a source can be real: 0, or between 1e-18
 * (the decimals a transaction takes) and 1e15. Anything else, such as 1e308
 * from a broken or hostile source, would be kept as hundreds of digits and
 * cost every user CPU and storage.
 */
export function plausible(value: number): boolean {
  return value === 0 || (value >= 1e-18 && value <= 1e15);
}

/** A source failed. The message names the source and the kind of failure only. */
export class MarketError extends Error {
  /** The source's HTTP status, when it answered with an error. */
  readonly status: number | undefined;

  constructor(source: string, reason: string, status?: number) {
    super(`${source}: ${reason}`);
    this.name = "MarketError";
    this.status = status;
  }
}

async function request(
  source: string,
  url: URL,
  headers: Record<string, string>,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      // A redirect is a failure, not followed: fetch would send the API key's
      // header to wherever it points, and an image could leave the allowed host.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new MarketError(source, "unreachable");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MarketError(
      source,
      `status ${String(response.status)}`,
      response.status,
    );
  }
  return response;
}

/** The body, or an error as soon as it grows past `maxBytes`. */
async function readCapped(
  source: string,
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw new MarketError(source, "response too large");
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
    response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let next: ReadableStreamReadResult<Uint8Array>;
    try {
      // The time limit covers the body too: a slow answer is cut off here.
      next = await reader.read();
    } catch {
      throw new MarketError(source, "answer cut off");
    }
    const { done, value } = next;
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new MarketError(source, "response too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function fetchJson(
  source: string,
  url: URL,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<unknown> {
  const response = await request(source, url, {
    ...headers,
    accept: "application/json",
  });
  const body = await readCapped(source, response, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new MarketError(source, "not JSON");
  }
}

/** Raster only: an SVG is a document that can carry script. */
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function fetchImage(
  source: string,
  url: URL,
  maxBytes: number,
): Promise<{ body: Uint8Array; type: string }> {
  const response = await request(source, url, {});
  const type = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (!type || !IMAGE_TYPES.has(type)) {
    await response.body?.cancel();
    throw new MarketError(source, "not a raster image");
  }
  return { body: await readCapped(source, response, maxBytes), type };
}
