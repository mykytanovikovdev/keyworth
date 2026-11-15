import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import {
  CHAT_LIMITS,
  type ChatRefusalJson,
  chatRequestSchema,
} from "../../shared/schemas/chat.ts";
import { describeError } from "../describe-error.ts";
import type { AppEnv } from "../env.ts";
import { maxBody, rateLimit, readJson } from "../limits.ts";
import { budgetLeft, budgetResetsAt, spend } from "./budget.ts";
import { chatModel, CHAT_MODEL, mostNeuronsFor, neuronsFor } from "./model.ts";
import { systemPrompt } from "./prompt.ts";
import { chatTools } from "./tools.ts";

/*
 * POST /api/chat: the one place where plaintext passes through the server
 * (CLAUDE.md, rule 4). The browser sends the conversation; the server checks
 * it, asks the model for one step and streams that step back. Nothing of the
 * request or the answer is stored or logged: only the step's cost, a number.
 */

/** Requests per user per minute: each tool round is a request. */
const CHAT_RATE = 20;

/** The longest one step may take, start to end. */
const STEP_TIMEOUT_MS = 60_000;

/** What the browser shows when a step fails; never the error itself. */
const ANSWER_FAILED = "The answer stopped: the AI is not available right now.";

export const chat = new Hono<AppEnv>();

chat.post(
  "/",
  maxBody(CHAT_LIMITS.maxBodyBytes),
  rateLimit("chat", CHAT_RATE),
  async (c) => {
    const body = chatRequestSchema.safeParse(await readJson(c));
    if (!body.success) {
      return c.json<ChatRefusalJson>({ error: "invalid_request" }, 400);
    }
    // Each part's shape, and each tool call's input against its schema.
    const checked = await safeValidateUIMessages({
      messages: body.data.messages,
      tools: chatTools,
    });
    if (!checked.success) {
      return c.json<ChatRefusalJson>({ error: "invalid_request" }, 400);
    }

    const db = c.get("db");
    if (!(await budgetLeft(db))) {
      return c.json<ChatRefusalJson>(
        { error: "budget", resetsAt: budgetResetsAt() },
        429,
      );
    }

    const messages = recent(checked.data);
    const steps = stepsSinceQuestion(messages);
    const requestBytes = Number(c.req.header("content-length") ?? 0);
    const background = c.executionCtx;
    let charged = false;
    const charge = (neurons: number) => {
      if (charged) return;
      charged = true;
      background.waitUntil(
        spend(db, neurons).catch((error: unknown) => {
          console.error(`Chat budget not updated\n${describeError(error)}`);
        }),
      );
    };

    const result = streamText({
      model: chatModel(c.env),
      instructions: systemPrompt(new Date().toISOString().slice(0, 10)),
      messages: await convertToModelMessages(messages, {
        tools: chatTools,
        ignoreIncompleteToolCalls: true,
      }),
      tools: chatTools,
      // Past the last step, the model must answer with what it has.
      toolChoice: steps >= CHAT_LIMITS.maxSteps - 1 ? "none" : "auto",
      // One step per request: the browser runs the tools and asks again.
      stopWhen: isStepCount(1),
      maxOutputTokens: CHAT_MODEL.maxOutputTokens,
      maxRetries: 1,
      abortSignal: AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(STEP_TIMEOUT_MS),
      ]),
      // The default prints the error, and a provider's error holds the whole
      // request: the conversation. Only its type and code locations.
      onError: ({ error }) => {
        console.error(`Chat step failed\n${describeError(error)}`);
      },
      onEnd: ({ usage }) => {
        charge(neuronsFor(usage));
      },
      onAbort: () => {
        charge(mostNeuronsFor(requestBytes));
      },
    });

    return createUIMessageStreamResponse({
      // The stream's own default is no-cache; the API's rule is no-store.
      headers: { "cache-control": "no-store" },
      stream: toUIMessageStream({
        stream: result.stream,
        tools: chatTools,
        // The model's reasoning stays on the server: it is not the answer.
        sendReasoning: false,
        onError: () => ANSWER_FAILED,
      }),
    });
  },
);

/**
 * The latest messages, starting at a question: the model gets the last
 * `modelMessages`, the browser keeps the rest. Assistant messages cut from
 * the front would answer a question the model no longer sees.
 */
function recent(messages: UIMessage[]): UIMessage[] {
  const latest = messages.slice(-CHAT_LIMITS.modelMessages);
  const first = latest.findIndex(({ role }) => role === "user");
  return first === -1 ? latest : latest.slice(first);
}

/** Model steps already taken for the latest question. */
function stepsSinceQuestion(messages: UIMessage[]): number {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return 0;
  return last.parts.filter(({ type }) => type === "step-start").length;
}
