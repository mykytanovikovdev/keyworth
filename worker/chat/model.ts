/*
 * The chat's model while the app is being built: GLM-4.7-Flash on Cloudflare
 * Workers AI, through its OpenAI-compatible REST endpoint (the AI binding
 * always reaches Cloudflare, even in tests and local development). Claude
 * Haiku replaces it before the chat opens to everyone (PLAN, phase 5): the
 * endpoint, the request's extras and the budget's numbers change then.
 */

export const CHAT_MODEL = Object.freeze({
  id: "@cf/zai-org/glm-4.7-flash",
  /** The longest step: an answer, or the calls to tools. */
  maxOutputTokens: 1_500,
  /** Workers AI's price in neurons per million tokens (checked 2026-11-12). */
  inputNeuronsPerMillion: 5_500,
  outputNeuronsPerMillion: 36_400,
  /**
   * Off: GLM thinks before answering by default, which took a short answer
   * from 1 to 7 seconds and from 2 to 18 neurons (measured 2026-11-15), for
   * explanations of numbers the tools already computed.
   */
  thinking: false,
  /**
   * The likeliest word each time: left to its default, the model invented
   * figures without calling a tool, and now and then wrote nonsense
   * (compared 2026-11-25).
   */
  temperature: 0,
});

/** Where the model answers: the account's OpenAI-compatible chat endpoint. */
export const completionsUrl = (env: Env) =>
  `https://api.cloudflare.com/client/v4/accounts/${env.WORKERS_AI_ACCOUNT_ID}/ai/v1/chat/completions`;

/**
 * The most a step can cost when it ended before Workers AI said what it used
 * (the user stopped it, the connection dropped): a token for every byte of
 * the request, and the longest answer. In whole neurons, rounded up.
 */
export function mostNeuronsFor(requestBytes: number): number {
  return Math.ceil(
    (requestBytes * CHAT_MODEL.inputNeuronsPerMillion +
      CHAT_MODEL.maxOutputTokens * CHAT_MODEL.outputNeuronsPerMillion) /
      1_000_000,
  );
}
