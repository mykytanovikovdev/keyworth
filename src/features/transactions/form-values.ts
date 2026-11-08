import { decimal } from "../../../shared/money/decimal.ts";
import { cleanText } from "../../../shared/schemas/text.ts";
import {
  type Transaction,
  TRANSACTION_LIMITS,
} from "../../../shared/schemas/transaction.ts";
import type { TransactionProblem } from "./check.ts";
import { dateInWords, quantity as formatQuantity } from "./format.ts";

/*
 * The form's fields and the transaction they make. Four tabs cover five kinds:
 * Receive is a transfer in, or income when its box is ticked.
 */

export type FormKind = "buy" | "sell" | "receive" | "send";

export interface AssetChoice {
  id: string;
  symbol: string;
  name: string;
}

export interface FormValues {
  kind: FormKind;
  /** Receive only: staking, interest and other rewards. */
  income: boolean;
  asset: AssetChoice | null;
  /** YYYY-MM-DD, the day as the user picked it. */
  day: string | null;
  quantity: string;
  price: string;
  priceCurrency: string;
  fee: string;
  note: string;
}

export type FieldName =
  "asset" | "day" | "quantity" | "price" | "fee" | "note" | "form";

export type FieldErrors = Partial<Record<FieldName, string>>;

export const emptyValues = (priceCurrency: string): FormValues => ({
  kind: "buy",
  income: false,
  asset: null,
  day: null,
  quantity: "",
  price: "",
  priceCurrency,
  fee: "",
  note: "",
});

/**
 * Typed digits as plain digits, or null. Spaces go; a comma with a point is a
 * thousands separator ("60,000.03"); a comma alone is the decimal point
 * ("0,5"), as most of Europe writes it.
 */
export function parseAmount(text: string): string | null {
  let digits = text.replace(/\s/g, "");
  if (digits.includes(".")) digits = digits.replace(/,/g, "");
  else if ((digits.match(/,/g) ?? []).length === 1)
    digits = digits.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  return decimal(digits).toString();
}

const MAX_DECIMALS = 18;
const MAX_WHOLE_DIGITS = 30;

/** Characters an amount field takes: the schema's 30 digits, a point, 18 decimals. */
export const AMOUNT_MAX_LENGTH = MAX_WHOLE_DIGITS + 1 + MAX_DECIMALS;

/**
 * What an amount field keeps of a change: digits and one decimal separator,
 * a point or a comma (a phone's number pad gives whichever its region uses),
 * and at most 18 decimals, the schema's limit. A keystroke that is anything
 * else is not typed at all. A pasted amount keeps its digits: with both
 * separators the last one is the decimal one ("60,000.03", "1.000,50"); one
 * kind repeated groups thousands ("1,000,000"). A leading separator gets its
 * zero: ",5" becomes "0,5".
 */
export function typedAmount(next: string, previous: string): string {
  const text = next.replace(/\s/g, "");
  if (!/^[\d.,]*$/.test(text)) return previous;
  const separators = [...text.matchAll(/[.,]/g)];
  let amount = text;
  const last = separators.at(-1);
  if (separators.length > 1 && last) {
    // Typing never adds a second separator; only a paste brings one.
    if (next.length - previous.length <= 1) return previous;
    const kinds = new Set(separators.map(([separator]) => separator));
    const digitsBefore = text.slice(0, last.index).replace(/[.,]/g, "");
    amount =
      kinds.size === 1
        ? text.replace(/[.,]/g, "")
        : `${digitsBefore}.${text.slice(last.index + 1)}`;
  }
  const [whole = "", fraction] = amount.split(/[.,]/);
  if (whole.length > MAX_WHOLE_DIGITS) return previous;
  if (fraction !== undefined && fraction.length > MAX_DECIMALS) return previous;
  return whole === "" && fraction !== undefined ? `0${amount}` : amount;
}

const decimalsOf = (plain: string) => plain.split(".")[1]?.length ?? 0;

/**
 * When it happened: noon UTC of the picked day, which stays that day for
 * anyone from UTC−11 to UTC+11, but never later than now.
 */
export function executedAt(day: string, now: number): string {
  const noon = Date.parse(`${day}T12:00:00Z`);
  return new Date(Math.min(noon, now)).toISOString().replace(".000Z", "Z");
}

/** What the fields say is missing or malformed, before anything is checked. */
export function fieldErrors(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.asset) errors.asset = "Choose a coin.";
  if (!values.day) errors.day = "Enter the date.";
  const amount = parseAmount(values.quantity);
  if (!amount || !/[1-9]/.test(amount)) {
    errors.quantity = "Enter a quantity greater than zero, such as 0.5.";
  } else if (decimalsOf(amount) > MAX_DECIMALS) {
    errors.quantity = "Use at most 18 decimal places.";
  }
  if (values.kind !== "send") {
    const price = parseAmount(values.price);
    const free = values.kind === "receive";
    if (price === null || (!free && !/[1-9]/.test(price))) {
      errors.price = free
        ? "Enter what one coin was worth, or 0."
        : "Enter the price per coin, such as 60000.03.";
    } else if (decimalsOf(price) > MAX_DECIMALS) {
      errors.price = "Use at most 18 decimal places.";
    }
  }
  if (values.fee.trim() && parseAmount(values.fee) === null) {
    errors.fee = "Enter the fee as a number, or leave it empty.";
  }
  if (values.note.length > TRANSACTION_LIMITS.noteLength)
    errors.note = "Keep the note under 1,000 characters.";
  return errors;
}

/** The transaction the fields describe; call after fieldErrors found none. */
export function toTransaction(
  values: FormValues,
  now: number,
  source: Transaction["source"] = "manual",
): unknown {
  const common = {
    assetId: values.asset?.id,
    executedAt: executedAt(values.day ?? "", now),
    quantity: parseAmount(values.quantity),
    source,
    ...(cleanText(values.note, TRANSACTION_LIMITS.noteLength) && {
      note: cleanText(values.note, TRANSACTION_LIMITS.noteLength),
    }),
  };
  const price = parseAmount(values.price);
  const fee = values.fee.trim() ? parseAmount(values.fee) : null;
  switch (values.kind) {
    case "buy":
    case "sell":
      return {
        type: values.kind,
        ...common,
        price,
        priceCurrency: values.priceCurrency,
        ...(fee !== null && { fee }),
      };
    case "receive":
      return {
        type: values.income ? "income" : "transfer_in",
        ...common,
        price,
        priceCurrency: values.priceCurrency,
      };
    case "send":
      return { type: "transfer_out", ...common };
  }
}

/** The fields again, to edit a stored transaction. */
export function fromTransaction(
  transaction: Transaction,
  asset: AssetChoice,
  baseCurrency: string,
): FormValues {
  const day = transaction.executedAt.slice(0, 10);
  const base = {
    ...emptyValues(baseCurrency),
    asset,
    day,
    note: transaction.note ?? "",
  };
  switch (transaction.type) {
    case "buy":
    case "sell":
      return {
        ...base,
        kind: transaction.type,
        quantity: transaction.quantity,
        price: transaction.price,
        priceCurrency: transaction.priceCurrency,
        fee: transaction.fee ?? "",
      };
    case "transfer_in":
    case "income":
      return {
        ...base,
        kind: "receive",
        income: transaction.type === "income",
        quantity: transaction.quantity,
        price: transaction.price,
        priceCurrency: transaction.priceCurrency,
      };
    case "transfer_out":
      return { ...base, kind: "send", quantity: transaction.quantity };
    case "split":
      // Splits are not entered in this form (stocks, release 2).
      return { ...base, quantity: transaction.ratio };
  }
}

/** The service's refusals in words, next to the field they concern. */
export function problemErrors(
  problems: readonly TransactionProblem[],
  {
    isThisOne,
    symbolOf,
  }: {
    /** Whether a problem concerns the transaction in the form, not a later one. */
    isThisOne: (transactionId: string) => boolean;
    symbolOf: (assetId: string) => string;
  },
): FieldErrors {
  const errors: FieldErrors = {};
  for (const problem of problems) {
    switch (problem.kind) {
      case "invalid":
        errors.form = "Some fields need another look.";
        break;
      case "in-the-future":
        errors.day = "The date can't be in the future.";
        break;
      case "changed-elsewhere":
        errors.form =
          "This transaction changed on another device. Its current version is shown below.";
        break;
      case "oversold": {
        const symbol = symbolOf(problem.assetId);
        const held = formatQuantity(problem.held, symbol);
        const when = dateInWords(problem.executedAt);
        if (isThisOne(problem.transactionId)) {
          errors.quantity = `You held ${held} on ${when}.`;
        } else {
          errors.form = `This would leave your ${formatQuantity(problem.asked, symbol)} going out on ${when} short: only ${held} would be left by then.`;
        }
        break;
      }
    }
  }
  return errors;
}
