import type { ChatToolName } from "../../../shared/schemas/chat-tools.ts";
import type { ToolStep } from "./Messages.tsx";

/*
 * What each tool call says in the steps line: what it does, what it did, and
 * what the AI received from it. The last part makes the minimization rule
 * visible at every step: amounts reach the model only when asked for.
 */

const PERIOD_WORDS: Record<string, string> = {
  "1W": "the week",
  "1M": "the month",
  "3M": "3 months",
  "1Y": "the year",
  All: "all time",
};

const MARKET_ONLY = "Market prices only. Nothing about your portfolio.";

/** The input as the model has typed it so far: any field may be missing. */
type PartialInput = Partial<Record<string, unknown>> | undefined;

const asked = (input: PartialInput, key: string) => input?.[key] === true;

const words = (label: string, running: string, detail: string): ToolStep => ({
  label,
  running,
  detail,
});

export function stepWords(name: ChatToolName, input: PartialInput): ToolStep {
  switch (name) {
    case "search_asset":
      return words(
        "Looked up a coin",
        "Looking up a coin",
        "A search by name. Nothing about your portfolio.",
      );
    case "get_portfolio":
      return asked(input, "includeAmounts")
        ? words(
            "Looked at your portfolio, with amounts",
            "Looking at your portfolio",
            "Amounts included, as you asked.",
          )
        : words(
            "Looked at your portfolio",
            "Looking at your portfolio",
            "Shares and changes. Amounts stayed on this device.",
          );
    case "list_transactions":
      return asked(input, "includeAmounts")
        ? words(
            "Looked at your transactions, with amounts",
            "Looking at your transactions",
            "Quantities included, as you asked. Notes stayed on this device.",
          )
        : words(
            "Looked at your transactions",
            "Looking at your transactions",
            "Days, kinds and prices. Quantities and notes stayed on this device.",
          );
    case "get_prices":
      return words(
        "Looked up today's prices",
        "Looking up today's prices",
        MARKET_ONLY,
      );
    case "get_price_history":
      return words(
        "Looked up price history",
        "Looking up price history",
        MARKET_ONLY,
      );
    case "calc_portfolio_metrics": {
      const period =
        PERIOD_WORDS[typeof input?.period === "string" ? input.period : ""] ??
        "the period";
      return words(
        `Calculated ${period}`,
        `Calculating ${period}`,
        "Change, the largest drop, and how each coin moved. No amounts.",
      );
    }
    case "compare_assets":
      return words(
        "Compared the coins",
        "Comparing the coins",
        "Change, volatility, the largest drop and correlation. Nothing about your portfolio.",
      );
  }
}
