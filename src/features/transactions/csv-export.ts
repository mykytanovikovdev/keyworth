import type { Transaction } from "../../../shared/schemas/transaction.ts";
import { CSV_COLUMNS, TYPE_WORDS } from "./csv-import.ts";
import { safeCell, toCsv } from "./csv.ts";
import type { AssetChoice } from "./form-values.ts";

/*
 * The transactions as a CSV file in Keyworth's format: what the import reads
 * back, and what a spreadsheet opens. Decrypted in the browser and written
 * here; nothing goes to the server. Every cell goes through `safeCell`, so a
 * note such as `=HYPERLINK(…)` stays text in a spreadsheet.
 */

/** Opens as UTF-8 in Excel, which otherwise guesses the system's code page. */
const BYTE_ORDER_MARK = "\uFEFF";

/** One row per transaction, oldest first; a kind the format lacks is counted. */
export function transactionsCsv(
  transactions: readonly Transaction[],
  assetOf: (assetId: string) => AssetChoice,
): { text: string; rows: number; left: number } {
  const ordered = [...transactions].sort(
    (a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt),
  );
  const rows: string[][] = [];
  for (const value of ordered) {
    if (value.type === "split") continue;
    const priced =
      value.type === "transfer_out"
        ? { price: "", currency: "", fee: "", feeCurrency: "" }
        : {
            price: value.price,
            currency: value.priceCurrency,
            fee:
              (value.type === "buy" || value.type === "sell") && value.fee
                ? value.fee
                : "",
            feeCurrency:
              (value.type === "buy" || value.type === "sell") && value.fee
                ? (value.feeCurrency ?? value.priceCurrency)
                : "",
          };
    rows.push([
      value.executedAt,
      TYPE_WORDS[value.type],
      value.assetId,
      assetOf(value.assetId).symbol,
      value.quantity,
      priced.price,
      priced.currency,
      priced.fee,
      priced.feeCurrency,
      value.note ?? "",
    ]);
  }
  return {
    text:
      BYTE_ORDER_MARK +
      toCsv([[...CSV_COLUMNS], ...rows.map((row) => row.map(safeCell))]),
    rows: rows.length,
    left: transactions.length - rows.length,
  };
}

/** A file to start from by hand: the header and one row of each kind. */
export const CSV_TEMPLATE =
  BYTE_ORDER_MARK +
  toCsv([
    [...CSV_COLUMNS],
    [
      "2025-03-14",
      "Buy",
      "",
      "BTC",
      "0.25",
      "81240.50",
      "USD",
      "2.5",
      "USD",
      "",
    ],
    ["2025-06-02", "Receive", "", "ETH", "1.5", "2500", "EUR", "", "", ""],
    ["2025-08-19", "Income", "", "ETH", "0.012", "2650", "EUR", "", "", ""],
    ["2025-10-01", "Send", "", "ETH", "0.5", "", "", "", "", "To cold wallet"],
    [
      "2025-11-20T09:15:00Z",
      "Sell",
      "",
      "BTC",
      "0.1",
      "91870",
      "USDT",
      "",
      "",
      "",
    ],
  ]);

/** "keyworth-transactions-2026-11-09.csv", for the day it was made. */
export const exportFileName = (day: string) =>
  `keyworth-transactions-${day}.csv`;
