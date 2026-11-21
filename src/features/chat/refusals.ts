import type { ChatRefusalJson } from "../../../shared/schemas/chat.ts";

/*
 * Why an answer did not come, in words. The model client's error reaches the
 * page only as text (the transport passes `onError`'s string along), so the
 * refusal is first written as a short code, then read back here.
 */

export type Failure =
  | { kind: "budget"; resetsAt: Date }
  | { kind: "rate_limited" }
  | { kind: "model_unavailable" }
  | { kind: "invalid_request" }
  | { kind: "signed_out" }
  | { kind: "connection" };

const KINDS = new Set([
  "rate_limited",
  "model_unavailable",
  "invalid_request",
  "signed_out",
  "connection",
]);

interface CallError {
  statusCode?: number | undefined;
  responseBody?: string | undefined;
}

/** The server's refusal, or how the call failed, as one line of text. */
export function failureCode(error: unknown): string {
  const call = (error && typeof error === "object" ? error : {}) as CallError;
  const status = call.statusCode;
  if (status === undefined) return "connection";
  if (status === 401) return "signed_out";
  let body: Partial<ChatRefusalJson> = {};
  try {
    body = JSON.parse(call.responseBody ?? "{}") as Partial<ChatRefusalJson>;
  } catch {
    // Not the server's JSON: the status alone tells.
  }
  if (body.error === "budget" && body.resetsAt) {
    return `budget ${body.resetsAt}`;
  }
  if (body.error === "rate_limited" || status === 429) return "rate_limited";
  if (body.error === "invalid_request" || status === 400) {
    return "invalid_request";
  }
  return "model_unavailable";
}

/** The code back as a failure: anything unknown reads as the model being down. */
export function failureOf(code: string): Failure {
  const [kind = "", resetsAt] = code.split(" ");
  if (kind === "budget" && resetsAt && !Number.isNaN(Date.parse(resetsAt))) {
    return { kind: "budget", resetsAt: new Date(resetsAt) };
  }
  return KINDS.has(kind)
    ? ({ kind } as Failure)
    : { kind: "model_unavailable" };
}

const TIME = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });

/** What the person reads, and whether asking again could help. */
export function failureWords(failure: Failure): string {
  switch (failure.kind) {
    case "budget":
      return `The chat has reached today's limit. It's back at ${TIME.format(failure.resetsAt)}.`;
    case "rate_limited":
      return "That's a lot of questions in a minute. Wait a moment, then try again.";
    case "model_unavailable":
      return "The AI isn't answering right now. Try again in a moment.";
    case "invalid_request":
      return "This question can't be sent as it is. Try asking it in other words.";
    case "signed_out":
      return "You've been signed out. Sign in again to keep asking.";
    case "connection":
      return "The answer broke off: the connection was lost.";
  }
}
