import { tool } from "ai";
import { CHAT_TOOLS } from "../../shared/schemas/chat-tools.ts";
import { z } from "../../shared/schemas/zod.ts";

/*
 * The tools as the server gives them to the model: definitions only, without
 * `execute`. The model's call goes to the browser, which runs it on the
 * decrypted data and sends the result back with the next request (CLAUDE.md,
 * rule 9). The server never sees a tool's work, only its result on its way
 * to the model.
 */

/**
 * A result as the browser sends it: any JSON, within the request's size. Each
 * tool's own result schema comes with the tools themselves (phase 5.2).
 */
const result = z.json();

const define = <INPUT>(definition: {
  description: string;
  inputSchema: z.ZodType<INPUT>;
}) => tool({ ...definition, outputSchema: result });

export const chatTools = {
  search_asset: define(CHAT_TOOLS.search_asset),
  get_portfolio: define(CHAT_TOOLS.get_portfolio),
  list_transactions: define(CHAT_TOOLS.list_transactions),
  get_prices: define(CHAT_TOOLS.get_prices),
  get_price_history: define(CHAT_TOOLS.get_price_history),
  calc_portfolio_metrics: define(CHAT_TOOLS.calc_portfolio_metrics),
  compare_assets: define(CHAT_TOOLS.compare_assets),
};
