import type { LanguageModelUsage } from "ai";
import { createWorkersAI } from "workers-ai-provider";

/*
 * The chat's model while the app is being built: GLM-4.7-Flash on Cloudflare
 * Workers AI, through its REST API (the AI binding always reaches Cloudflare,
 * even in tests and local development). Claude Haiku replaces it before the
 * chat opens to everyone (PLAN, phase 5); only this file and the budget's
 * numbers change then.
 */

export const CHAT_MODEL = Object.freeze({
  id: "@cf/zai-org/glm-4.7-flash",
  /** Workers AI's price in neurons per million tokens (checked 2026-11-12). */
  inputNeuronsPerMillion: 5_500,
  outputNeuronsPerMillion: 36_400,
  /** The longest step: an answer, or the calls to tools. */
  maxOutputTokens: 1_500,
});

export function chatModel(env: Env) {
  quietProvider();
  // The package is deprecated in favor of the Agents SDK's createAI, a much
  // larger dependency; it still works, and goes with this model (phase 5).
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const workersAi = createWorkersAI({
    accountId: env.WORKERS_AI_ACCOUNT_ID,
    apiKey: env.WORKERS_AI_TOKEN,
  });
  return workersAi(CHAT_MODEL.id);
}

/** What a step cost, in whole neurons, rounded up. */
export function neuronsFor(usage: LanguageModelUsage): number {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return Math.ceil(
    (input * CHAT_MODEL.inputNeuronsPerMillion +
      output * CHAT_MODEL.outputNeuronsPerMillion) /
      1_000_000,
  );
}

/**
 * The most a step can have cost when it ended before the model said what it
 * used (the user stopped it, or the connection dropped): a token for every
 * byte of the request, and the longest answer.
 */
export function mostNeuronsFor(requestBytes: number): number {
  return neuronsFor({
    inputTokens: requestBytes,
    outputTokens: CHAT_MODEL.maxOutputTokens,
  } as LanguageModelUsage);
}

const QUIET = Symbol("keyworth.quiet");

/**
 * The provider prints an SSE event it cannot parse, which is a piece of the
 * model's answer: about the user's portfolio. Workers Logs keep whatever the
 * Worker prints (CLAUDE.md, rule 4), so the provider's own messages, all
 * prefixed, are dropped; the route logs failures itself, without content.
 * Checked on every request: whatever replaced `console.warn` since (a test's
 * spy) is wrapped again.
 */
function quietProvider() {
  const current = console.warn;
  if (QUIET in current) return;
  const quieted = (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === "string" && first.startsWith("[workers-ai-provider]"))
      return;
    current.apply(console, args);
  };
  console.warn = Object.assign(quieted, { [QUIET]: true });
}
