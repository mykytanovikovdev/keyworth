import { Hono } from "hono";
import {
  CHAT_LIMITS,
  type ChatMessage,
  type ChatRefusalJson,
  chatRequestSchema,
} from "../../shared/schemas/chat.ts";
import { describeError } from "../describe-error.ts";
import type { AppEnv } from "../env.ts";
import { maxBody, readJson } from "../limits.ts";
import { admit, budgetResetsAt, spend } from "./budget.ts";
import { CHAT_MODEL, completionsUrl, mostNeuronsFor } from "./model.ts";
import { systemPrompt } from "./prompt.ts";
import { TOOL_DEFINITIONS, toolCallsValid } from "./tools.ts";
import { neuronsOf } from "./usage.ts";

/*
 * POST /api/chat/completions: the one place where plaintext passes through
 * the server (CLAUDE.md, rule 4). The browser's model client sends the
 * conversation in the OpenAI format; the server checks it, writes the request
 * to the model itself (its model, its instructions, its tools, its limits)
 * and passes the model's stream back untouched: no parsing on the way, so the
 * Worker spends about a millisecond of CPU on a step. Nothing of a request or
 * an answer is stored or logged; only the step's cost, a number.
 */

/** The longest one step may take, start to end. */
const STEP_TIMEOUT_MS = 60_000;

export const chat = new Hono<AppEnv>();

chat.post("/completions", maxBody(CHAT_LIMITS.maxBodyBytes), async (c) => {
  const body = chatRequestSchema.safeParse(await readJson(c));
  if (!body.success || !toolCallsValid(body.data.messages)) {
    return c.json<ChatRefusalJson>({ error: "invalid_request" }, 400);
  }

  const admission = await admit(c);
  if (!admission.allowed) {
    if (admission.reason === "budget") {
      return c.json<ChatRefusalJson>(
        { error: "budget", resetsAt: budgetResetsAt() },
        429,
      );
    }
    c.header("Retry-After", String(admission.retryAfter));
    return c.json<ChatRefusalJson>({ error: "rate_limited" }, 429);
  }

  const messages = recent(body.data.messages);
  const lastStep = stepsSinceQuestion(messages) >= CHAT_LIMITS.maxSteps - 1;
  const upstream = await fetch(completionsUrl(c.env), {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.env.WORKERS_AI_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL.id,
      messages: [
        {
          role: "system",
          content: systemPrompt(new Date().toISOString().slice(0, 10)),
        },
        ...messages,
      ],
      tools: TOOL_DEFINITIONS,
      // On the last step the model must answer with what it has.
      tool_choice: lastStep ? "none" : "auto",
      max_tokens: CHAT_MODEL.maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
      chat_template_kwargs: { enable_thinking: CHAT_MODEL.thinking },
    }),
    // Stopping the answer in the browser stops the model too.
    signal: AbortSignal.any([
      c.req.raw.signal,
      AbortSignal.timeout(STEP_TIMEOUT_MS),
    ]),
    redirect: "manual",
  }).catch((error: unknown) => {
    // Never the error itself: it can hold the request (the conversation).
    console.error(`Chat model unreachable\n${describeError(error)}`);
    return null;
  });
  if (!upstream?.ok || !upstream.body) {
    if (upstream) {
      console.error(`Chat model refused: status ${String(upstream.status)}`);
      // Its body may echo the request: dropped unread.
      await upstream.body?.cancel();
    }
    return c.json<ChatRefusalJson>({ error: "model_unavailable" }, 502);
  }

  // One copy streams to the browser as it comes; the other is read after,
  // only for the step's cost.
  const [toBrowser, toCount] = (
    upstream.body as ReadableStream<Uint8Array>
  ).tee();
  const db = c.get("db");
  const requestBytes = Number(c.req.header("content-length") ?? 0);
  c.executionCtx.waitUntil(
    neuronsOf(toCount)
      .catch(() => null)
      .then((neurons) => spend(db, neurons ?? mostNeuronsFor(requestBytes)))
      .catch((error: unknown) => {
        console.error(`Chat budget not updated\n${describeError(error)}`);
      }),
  );
  return new Response(toBrowser, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    },
  });
});

/**
 * The latest messages, starting at a question: the model gets the last
 * `modelMessages`, the browser keeps the rest. A cut that started inside a
 * step would hand the model a tool result without its call.
 */
function recent(messages: ChatMessage[]): ChatMessage[] {
  const latest = messages.slice(-CHAT_LIMITS.modelMessages);
  const first = latest.findIndex(({ role }) => role === "user");
  return first === -1 ? latest : latest.slice(first);
}

/** Model steps already taken for the latest question: its answers so far. */
function stepsSinceQuestion(messages: ChatMessage[]): number {
  const question = messages.findLastIndex(({ role }) => role === "user");
  return messages.slice(question + 1).filter(({ role }) => role === "assistant")
    .length;
}
