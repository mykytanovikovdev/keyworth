import { cryptoAssetIdSchema, daySchema } from "./market.ts";
import { z } from "./zod.ts";

/*
 * The tools the chat's model may call, as the model sees them: a name, what
 * the tool does and the input it takes. They run in the browser, where the
 * decrypted data is (phase 5: read only); the server passes their definitions
 * to the model and checks the input the model gives them. The same schemas
 * validate a tool call that comes back with the conversation.
 *
 * Minimization (CLAUDE.md, rule 5): by default a tool gives shares, percentages
 * and changes. Amounts (money values, quantities) only when `includeAmounts` is
 * set, which the model is told to do only when the user asks about them.
 */

export const CHAT_PERIODS = ["1W", "1M", "3M", "1Y", "All"] as const;

const period = z
  .enum(CHAT_PERIODS)
  .describe(
    "1W, 1M, 3M or 1Y: the last week, month, 3 months or year up to today. All: since the first transaction.",
  );

const includeAmounts = z
  .boolean()
  .optional()
  .describe(
    "True only when the user asks about amounts: money values or quantities. Otherwise leave it out.",
  );

const assetId = cryptoAssetIdSchema.describe(
  'A coin\'s id from search_asset or get_portfolio, such as "crypto:bitcoin".',
);

export const CHAT_TOOLS = {
  search_asset: {
    description:
      "Find a coin by its name or ticker. Returns matching coins with their ids. Use it before any tool that takes a coin the portfolio does not hold.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(50)
        .describe("A name or ticker, such as LTC."),
    }),
  },
  get_portfolio: {
    description:
      "The user's holdings now: each coin's share of the portfolio and its change over a period, and the whole portfolio's change.",
    inputSchema: z.object({
      period: period.optional(),
      includeAmounts,
    }),
  },
  list_transactions: {
    description:
      "The user's transactions, newest first, optionally of one coin and between two days: type, coin, day and price.",
    inputSchema: z.object({
      assetId: assetId.optional(),
      from: daySchema.optional().describe("First day, YYYY-MM-DD."),
      to: daySchema.optional().describe("Last day, YYYY-MM-DD."),
      limit: z.int().min(1).max(50).optional(),
      includeAmounts,
    }),
  },
  get_prices: {
    description: "Today's prices of coins, in the user's base currency.",
    inputSchema: z.object({
      assetIds: z.array(assetId).min(1).max(20),
    }),
  },
  get_price_history: {
    description: "A coin's daily prices over a period, with its change.",
    inputSchema: z.object({ assetId, period }),
  },
  calc_portfolio_metrics: {
    description:
      "The portfolio's change over a period, its largest drop (drawdown), its volatility (annualized) and each coin's part in the change.",
    inputSchema: z.object({ period }),
  },
  compare_assets: {
    description:
      "Compare 2 to 5 coins over a period: change, volatility, largest drop and how closely their daily moves follow each other (correlation).",
    inputSchema: z.object({
      assetIds: z.array(assetId).min(2).max(5),
      period,
    }),
  },
} as const;

export type ChatToolName = keyof typeof CHAT_TOOLS;

export const CHAT_TOOL_NAMES = Object.keys(CHAT_TOOLS) as ChatToolName[];
