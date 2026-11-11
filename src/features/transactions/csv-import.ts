import { decimal } from "../../../shared/money/decimal.ts";
import {
  FIAT_CURRENCIES,
  STABLECOINS,
} from "../../../shared/schemas/currencies.ts";
import { cryptoAssetIdSchema } from "../../../shared/schemas/market.ts";
import { cleanText } from "../../../shared/schemas/text.ts";
import {
  TRANSACTION_LIMITS,
  type Transaction,
} from "../../../shared/schemas/transaction.ts";
import { VAULT_LIMITS } from "../../../shared/schemas/vault.ts";
import { ledgerProblems, parseTransaction } from "./check.ts";
import { parseCsv, plainCell } from "./csv.ts";
import { type AssetChoice, executedAt } from "./form-values.ts";
import {
  dateInWords,
  groupDigits,
  quantity as quantityText,
} from "./format.ts";

/*
 * A CSV file of transactions, read in the browser and checked row by row
 * before anything is written (shared/schemas/docs/input-validation.md, Files):
 * the size before reading, strict UTF-8, the columns, then each row through
 * the same rules as the form and the ledger's rule over all of them at once.
 * Rows already recorded are skipped, so importing a file twice adds nothing.
 * Pure but for reading the file: the dialog shows the plan, the service
 * writes it.
 */

/** More than a decade of trades; a larger file is refused unread. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Coins outside the snapshot one import looks up by id: two requests of 50.
 * Each new one costs a call to CoinGecko, whose allowance all users share.
 */
export const IMPORT_MAX_UNKNOWN_COINS = 100;

/** The columns of Keyworth's format, in the order an export writes them. */
export const CSV_COLUMNS = [
  "Date",
  "Type",
  "Coin",
  "Symbol",
  "Quantity",
  "Price",
  "Currency",
  "Fee",
  "Fee currency",
  "Note",
] as const;

type Column = (typeof CSV_COLUMNS)[number];

/** The kinds a file can hold, by the words the form uses. */
export const TYPE_WORDS = {
  buy: "Buy",
  sell: "Sell",
  transfer_in: "Receive",
  transfer_out: "Send",
  income: "Income",
} as const satisfies Partial<Record<Transaction["type"], string>>;

type FileType = keyof typeof TYPE_WORDS;

const TYPE_OF = new Map<string, FileType>(
  Object.entries(TYPE_WORDS).map(([type, word]) => [
    word.toLowerCase(),
    type as FileType,
  ]),
);

export type FileProblem =
  | { kind: "too-large" }
  | { kind: "not-text" }
  | { kind: "unclosed-quote" }
  | { kind: "no-rows" }
  | { kind: "missing-columns"; columns: Column[] }
  /** More new transactions than the account has room for. */
  | { kind: "over-quota"; rows: number; room: number }
  /** The coins couldn't be looked up: not the file's fault. */
  | { kind: "market-unavailable" }
  /** More coins outside the snapshot than one import looks up by id. */
  | { kind: "too-many-coins"; coins: number; limit: number };

const count = (n: number) => groupDigits(String(n));

/** Why a file can't be imported, in words. */
export function fileProblemText(problem: FileProblem): string {
  switch (problem.kind) {
    case "too-large":
      return "This file is larger than 5 MB. Is it the right file?";
    case "not-text":
      return "This isn't a CSV file: it isn't plain text (UTF-8).";
    case "unclosed-quote":
      return "This file isn't valid CSV: a quote opens and never closes.";
    case "no-rows":
      return "This file has no transactions in it.";
    case "missing-columns": {
      const last = problem.columns.at(-1) ?? "";
      const names =
        problem.columns.length > 1
          ? `${problem.columns.slice(0, -1).join(", ")} and ${last}`
          : last;
      return `This file has no ${names} ${problem.columns.length === 1 ? "column" : "columns"}. Start from the template.`;
    }
    case "market-unavailable":
      return "Coin names couldn't load, so the file can't be checked. Try again in a minute.";
    case "over-quota":
      return `This file has ${count(problem.rows)} new ${problem.rows === 1 ? "transaction" : "transactions"}, and your account has room for ${count(problem.room)} more.`;
    case "too-many-coins":
      return `This file names ${count(problem.coins)} coins outside the 250 largest, and one import looks up at most ${count(problem.limit)}. Split it into smaller files.`;
  }
}

/** A file's text, if it is one: the size first, then strict UTF-8, no NUL. */
export async function readText(
  file: Blob,
): Promise<{ text: string } | { problem: FileProblem }> {
  if (file.size > IMPORT_MAX_BYTES) return { problem: { kind: "too-large" } };
  let text: string;
  try {
    // A byte-order mark is dropped (ignoreBOM: false).
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    return { problem: { kind: "not-text" } };
  }
  if (text.includes("\u0000")) return { problem: { kind: "not-text" } };
  return { text };
}

export interface CsvTable {
  /** Where each known column is. */
  columns: ReadonlyMap<Column, number>;
  /** Data rows, numbered as a spreadsheet numbers them (the header is 1). */
  rows: readonly { row: number; cells: readonly string[] }[];
}

const columnOf = (heading: string): Column | undefined => {
  const name = heading
    .trim()
    .replace(/[\s_]+/g, " ")
    .toLowerCase();
  return CSV_COLUMNS.find((column) => column.toLowerCase() === name);
};

const REQUIRED: readonly Column[] = [
  "Date",
  "Type",
  "Quantity",
  "Price",
  "Currency",
];

/** The header and the rows of a file's text, or why it is not one to import. */
export function readTable(
  text: string,
): { table: CsvTable } | { problem: FileProblem } {
  const parsed = parseCsv(text);
  if ("problem" in parsed) return { problem: { kind: "unclosed-quote" } };
  const blank = (record: readonly string[]) =>
    record.every((cell) => cell.trim() === "");
  const headerAt = parsed.records.findIndex((record) => !blank(record));
  const header = parsed.records[headerAt];
  if (!header) return { problem: { kind: "no-rows" } };
  const columns = new Map<Column, number>();
  header.forEach((heading, index) => {
    const column = columnOf(heading);
    if (column && !columns.has(column)) columns.set(column, index);
  });
  const missing = REQUIRED.filter((column) => !columns.has(column));
  if (!columns.has("Coin") && !columns.has("Symbol")) missing.push("Coin");
  if (missing.length > 0) {
    return { problem: { kind: "missing-columns", columns: missing } };
  }
  const rows = parsed.records
    .map((cells, index) => ({ row: index + 1, cells }))
    .slice(headerAt + 1)
    .filter(({ cells }) => !blank(cells));
  if (rows.length === 0) return { problem: { kind: "no-rows" } };
  return { table: { columns, rows } };
}

const cellOf = (
  table: CsvTable,
  cells: readonly string[],
  column: Column,
): string => {
  const index = table.columns.get(column);
  return index === undefined ? "" : plainCell(cells[index] ?? "").trim();
};

/**
 * The coin ids a file names that are to be looked up by id: well formed, not
 * known already (the snapshot), at most IMPORT_MAX_UNKNOWN_COINS. Any other
 * id is a coin nobody knows, and its row says so.
 */
export function coinsToLookUp(
  table: CsvTable,
  known: (id: string) => boolean,
): { ids: string[] } | { problem: FileProblem } {
  const ids = [
    ...new Set(
      table.rows
        .map(({ cells }) => cellOf(table, cells, "Coin"))
        .filter(
          (id) =>
            id !== "" &&
            !known(id) &&
            cryptoAssetIdSchema.safeParse(id).success,
        ),
    ),
  ];
  if (ids.length > IMPORT_MAX_UNKNOWN_COINS) {
    return {
      problem: {
        kind: "too-many-coins",
        coins: ids.length,
        limit: IMPORT_MAX_UNKNOWN_COINS,
      },
    };
  }
  return { ids };
}

export interface ImportContext {
  /** The transactions recorded now. */
  existing: readonly { id: string; value: Transaction }[];
  /** Records the vault holds, damaged ones too: the quota counts them all. */
  stored: number;
  /** A coin by its id, when Keyworth knows it. */
  coinById: (id: string) => AssetChoice | undefined;
  /** The largest coin with this symbol among the snapshot's 250, if any. */
  coinBySymbol: (symbol: string) => AssetChoice | undefined;
  now: number;
}

export interface ImportPlan {
  /** Data rows in the file. */
  rows: number;
  /** What would be written, in the file's order. */
  added: { row: number; value: Transaction; asset: AssetChoice }[];
  /** Rows already recorded, skipped. */
  duplicates: number[];
  /** Rows skipped, and why, in words. */
  problems: { row: number; message: string }[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/;

/** What the form offers as a price currency: the 161 and the two stablecoins. */
const CURRENCIES: ReadonlySet<string> = new Set([
  ...FIAT_CURRENCIES.map(([code]) => code),
  ...STABLECOINS,
]);

const currencyOf = (cell: string): string | undefined => {
  const code = cell.toUpperCase();
  return CURRENCIES.has(code) ? code : undefined;
};

/** A day has begun somewhere on Earth once UTC+14 has reached it. */
const EARLIEST_OFFSET_MS = 14 * 60 * 60 * 1000;

/** The time a day or a moment names, if it is a real one. */
function timeOf(text: string, day: string): number | null {
  const time = Date.parse(text);
  // Date.parse rolls 2025-02-30 over into March: a real day reads back as itself.
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day
    ? null
    : time;
}

/**
 * The moment a Date cell names: a day is kept as the form keeps it (noon UTC,
 * or now when noon is still ahead), a moment in UTC as it is.
 */
function momentOf(cell: string, now: number): string | null {
  if (DAY.test(cell)) {
    const start = timeOf(`${cell}T00:00:00Z`, cell);
    if (start === null) return null;
    // A day still ahead everywhere keeps its noon, which the rules then
    // refuse as the future; executedAt would make it now.
    return start - EARLIEST_OFFSET_MS > now
      ? `${cell}T12:00:00Z`
      : executedAt(cell, now);
  }
  if (!MOMENT.test(cell)) return null;
  const time = timeOf(cell, cell.slice(0, 10));
  return time === null
    ? null
    : new Date(time).toISOString().replace(".000Z", "Z");
}

/** A cell quoted in a message: short, and without characters that hide. */
const quoted = (cell: string) => `"${cleanText(cell, 40)}"`;

/**
 * A number from a file, as plain digits. A point is always the decimal point,
 * as the export and the template write it; a lone comma is one too ("0,5"),
 * as many spreadsheets in Europe save it. Spaces between groups of three
 * digits ("1 234,50") group thousands and nothing else, so they go. Any other
 * grouping is refused rather than guessed at: "1.234,50" or "1,234" read the
 * wrong way would be off by a thousand, and the preview shows only counts. A
 * comma before exactly three digits, after one to three others, is such a
 * guess.
 */
type FileAmount =
  { digits: string } | { problem: "grouped" | "ambiguous" | "not-a-number" };

const SPACE_GROUPED = /^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/;

function fileAmount(text: string): FileAmount {
  const spaced = SPACE_GROUPED.test(text);
  const plain = /^(\d+)(?:([.,])(\d+))?$/.exec(
    spaced ? text.replace(/[ \u00a0\u202f]/g, "") : text,
  );
  if (!plain) {
    return {
      problem:
        /\d/.test(text) && /^[\d\s.,'\u00a0\u202f]+$/.test(text)
          ? "grouped"
          : "not-a-number",
    };
  }
  const [, whole = "", separator, decimals] = plain;
  if (
    !spaced &&
    separator === "," &&
    decimals?.length === 3 &&
    whole.length <= 3 &&
    whole !== "0"
  ) {
    return { problem: "ambiguous" };
  }
  const digits = decimals === undefined ? whole : `${whole}.${decimals}`;
  return { digits: decimal(digits).toString() };
}

/** What to say when a number cannot be taken as it is written. */
function amountMessage(text: string, problem: FileAmount, wanted: string) {
  if ("digits" in problem) return wanted;
  switch (problem.problem) {
    case "grouped":
      return `${quoted(text)} has a thousands separator: write numbers without one, with a point for decimals, such as 1234.5.`;
    case "ambiguous":
      return `${quoted(text)} could mean ${text.replace(",", "")} or ${text.replace(",", ".")}: write it without a thousands separator, with a point for decimals.`;
    case "not-a-number":
      return wanted;
  }
}

/** One row as a transaction, or the first thing wrong with it. */
function rowValue(
  table: CsvTable,
  cells: readonly string[],
  context: ImportContext,
): { value: Transaction; asset: AssetChoice } | { message: string } {
  const cell = (column: Column) => cellOf(table, cells, column);

  const date = cell("Date");
  const moment = momentOf(date, context.now);
  if (!moment) {
    return {
      message: `${quoted(date)} isn't a date: write it as 2025-12-31.`,
    };
  }
  const type = TYPE_OF.get(cell("Type").toLowerCase());
  if (!type) {
    return {
      message: `${quoted(cell("Type"))} isn't a type: use Buy, Sell, Receive, Send or Income.`,
    };
  }

  const id = cell("Coin");
  const symbol = cell("Symbol");
  const asset = id
    ? context.coinById(id)
    : symbol
      ? context.coinBySymbol(symbol)
      : undefined;
  if (!asset) {
    return {
      message: id
        ? `${quoted(id)} isn't a coin Keyworth knows.`
        : symbol
          ? `${quoted(symbol)} isn't among the 250 largest coins: put its id from an export in Coin.`
          : "No coin: fill in Coin or Symbol.",
    };
  }

  const quantityRead = fileAmount(cell("Quantity"));
  const quantity = "digits" in quantityRead ? quantityRead.digits : null;
  if (!quantity || !/[1-9]/.test(quantity)) {
    return {
      message: amountMessage(
        cell("Quantity"),
        quantityRead,
        `${quoted(cell("Quantity"))} isn't a quantity greater than zero.`,
      ),
    };
  }

  const value: Record<string, unknown> = {
    type,
    assetId: asset.id,
    executedAt: moment,
    quantity,
    source: "csv",
  };
  if (type !== "transfer_out") {
    const priceRead = fileAmount(cell("Price"));
    const price = "digits" in priceRead ? priceRead.digits : null;
    const trade = type === "buy" || type === "sell";
    if (!price || (trade && !/[1-9]/.test(price))) {
      return {
        message: amountMessage(
          cell("Price"),
          priceRead,
          trade
            ? `${quoted(cell("Price"))} isn't a price greater than zero.`
            : `${quoted(cell("Price"))} isn't a value per coin (0 for a gift).`,
        ),
      };
    }
    const currency = currencyOf(cell("Currency"));
    if (!currency) {
      return {
        message: `${quoted(cell("Currency"))} isn't a currency: use a code such as USD, EUR or USDT.`,
      };
    }
    value.price = price;
    value.priceCurrency = currency;
    if (trade && cell("Fee") !== "") {
      const feeRead = fileAmount(cell("Fee"));
      if (!("digits" in feeRead)) {
        return {
          message: amountMessage(
            cell("Fee"),
            feeRead,
            `${quoted(cell("Fee"))} isn't a fee.`,
          ),
        };
      }
      value.fee = feeRead.digits;
      if (cell("Fee currency") !== "") {
        const feeCurrency = currencyOf(cell("Fee currency"));
        if (!feeCurrency) {
          return {
            message: `${quoted(cell("Fee currency"))} isn't a currency: use a code such as USD, EUR or USDT.`,
          };
        }
        value.feeCurrency = feeCurrency;
      }
    }
  }
  const note = cleanText(cell("Note"), TRANSACTION_LIMITS.noteLength);
  if (note) value.note = note;

  const parsed = parseTransaction(value, context.now);
  if ("problem" in parsed) {
    return {
      message:
        parsed.problem.kind === "in-the-future"
          ? "The date is in the future."
          : "This row doesn't make a transaction.",
    };
  }
  return { value: parsed.value, asset };
}

/** What makes two transactions the same one, for skipping duplicates. */
function sameness(value: Transaction): string {
  // By type, not `in`: the records are loose objects, any key may be there.
  let amount: string;
  switch (value.type) {
    case "transfer_out":
      amount = decimal(value.quantity).toString();
      break;
    case "split":
      amount = decimal(value.ratio).toString();
      break;
    default:
      amount = `${decimal(value.quantity).toString()} at ${decimal(value.price).toString()} ${value.priceCurrency}`;
  }
  return [
    value.type,
    value.assetId,
    String(Date.parse(value.executedAt)),
    amount,
  ].join("|");
}

/**
 * What importing the file would do: the rows to add, the rows already
 * recorded, and the rows that cannot be added and why. Refused as a whole only
 * when the new rows do not fit in the account.
 */
export function planImport(
  table: CsvTable,
  context: ImportContext,
): { plan: ImportPlan } | { problem: FileProblem } {
  const room = Math.max(0, VAULT_LIMITS.maxRecords - context.stored);
  // At most one row per recorded transaction is a duplicate, so a file longer
  // than that and the room together cannot fit: refused before any row is
  // checked, which a file of a hundred thousand rows would take a minute for.
  const atLeastNew = table.rows.length - context.existing.length;
  if (atLeastNew > room) {
    return { problem: { kind: "over-quota", rows: atLeastNew, room } };
  }
  const problems: ImportPlan["problems"] = [];
  const duplicates: number[] = [];
  const candidates: (ImportPlan["added"][number] & { id: string })[] = [];

  // Each recorded transaction can match one row: two identical rows in a file
  // (a trade filled in two equal parts) are both new unless both are there.
  const recorded = new Map<string, number>();
  for (const { value } of context.existing) {
    const key = sameness(value);
    recorded.set(key, (recorded.get(key) ?? 0) + 1);
  }

  for (const { row, cells } of table.rows) {
    const result = rowValue(table, cells, context);
    if ("message" in result) {
      problems.push({ row, message: result.message });
      continue;
    }
    const key = sameness(result.value);
    const left = recorded.get(key) ?? 0;
    if (left > 0) {
      recorded.set(key, left - 1);
      duplicates.push(row);
      continue;
    }
    candidates.push({ id: `row:${String(row)}`, row, ...result });
  }

  // The ledger's rule over the whole file at once: a sale may need a purchase
  // further down. Leaving a short one out only adds units, so one pass does.
  const short = new Map<string, string>();
  const after = [...context.existing, ...candidates];
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  // The file's own outgoing rows by coin: what a recorded sale left short
  // looks through, instead of every row each time.
  const outgoing = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (c.value.type !== "sell" && c.value.type !== "transfer_out") continue;
    const list = outgoing.get(c.value.assetId) ?? [];
    list.push(c);
    outgoing.set(c.value.assetId, list);
  }
  for (const problem of ledgerProblems(context.existing, after)) {
    if (problem.kind !== "oversold") continue;
    const candidate = candidateById.get(problem.transactionId);
    const held = quantityText(problem.held, candidate?.asset.symbol ?? "");
    const when = dateInWords(problem.executedAt);
    if (candidate) {
      short.set(candidate.id, `You held ${held} on ${when}.`);
      continue;
    }
    // A recorded sale would be left short: by the file's earlier ones.
    const moment = Date.parse(problem.executedAt);
    for (const c of outgoing.get(problem.assetId) ?? []) {
      if (Date.parse(c.value.executedAt) <= moment && !short.has(c.id)) {
        short.set(
          c.id,
          `This would leave your ${quantityText(problem.asked, c.asset.symbol)} going out on ${when} short.`,
        );
      }
    }
  }
  const added = candidates
    .filter((c) => {
      const message = short.get(c.id);
      if (message) problems.push({ row: c.row, message });
      return !message;
    })
    .map(({ row, value, asset }) => ({ row, value, asset }));
  problems.sort((a, b) => a.row - b.row);

  if (added.length > room) {
    return { problem: { kind: "over-quota", rows: added.length, room } };
  }
  return {
    plan: { rows: table.rows.length, added, duplicates, problems },
  };
}
