/*
 * CSV as RFC 4180 describes it, for this app's files: fields separated by a
 * comma (or a semicolon or a tab, as spreadsheets in some countries save
 * them), quoted when they hold a separator, a quote or a line break, a quote
 * doubled inside quotes, lines ended by CRLF, LF or CR. Pure functions: the
 * import reads a file's text with them, the export writes one. No library: the
 * format fits on a screen, and every rule here is tested.
 */

export type Delimiter = "," | ";" | "\t";

const DELIMITERS: readonly Delimiter[] = [",", ";", "\t"];

/** The separator the first line uses most, outside quotes; a comma by default. */
export function detectDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>();
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && DELIMITERS.includes(char as Delimiter)) {
      const delimiter = char as Delimiter;
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  let best: Delimiter = ",";
  for (const delimiter of DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) {
      best = delimiter;
    }
  }
  return best;
}

/**
 * The records of a CSV text, one array of fields each. A blank line is a
 * record with one empty field, kept so that record numbers match the rows a
 * spreadsheet shows. A quote opens a quoted field only at the field's start;
 * anywhere else it is an ordinary character.
 */
export function parseCsv(
  text: string,
  delimiter: Delimiter = detectDelimiter(text),
): { records: string[][] } | { problem: "unclosed-quote" } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  let index = 0;
  const endField = () => {
    record.push(field);
    field = "";
    started = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (index < text.length) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else field += char;
      index += 1;
      continue;
    }
    if (char === '"' && !started) {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\r" || char === "\n") {
      endRecord();
      if (char === "\r" && text.charAt(index + 1) === "\n") index += 1;
    } else {
      field += char;
      started = true;
    }
    index += 1;
  }
  if (quoted) return { problem: "unclosed-quote" };
  // The last line may or may not end with a line break.
  if (started || field !== "" || record.length > 0) endRecord();
  return { records };
}

/*
 * Where a spreadsheet could start a formula: at the start of a cell, and after
 * a ";" too, because a spreadsheet in a region whose list separator is ";"
 * (much of Europe) splits a comma-separated line there, quotes or not. A
 * formula starts with = + - @, a tab or a carriage return.
 */
const FORMULA_AT = /(^|; *)('*)(?=[=+\-@\t\r])/g;
const ESCAPED_AT = /(^|; *)'('*)(?=[=+\-@\t\r])/g;

/**
 * A cell as written for spreadsheets: where a formula could start, one more
 * `'` goes before it (and before any `'` already there), so `=HYPERLINK(…)` in
 * a note stays text when the file is opened, wherever it is in the note.
 */
export const safeCell = (text: string): string =>
  text.replace(FORMULA_AT, "$1'$2");

/**
 * A cell as read back: exactly the `'` that `safeCell` added comes off, so a
 * note that itself starts with `'=` comes back as it was.
 */
export const plainCell = (text: string): string =>
  text.replace(ESCAPED_AT, "$1$2");

const quoteField = (text: string): string =>
  /[",;\t\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;

/** CSV text from records: commas, CRLF line ends, quotes only where needed. */
export function toCsv(records: readonly (readonly string[])[]): string {
  return records
    .map((record) => record.map(quoteField).join(",") + "\r\n")
    .join("");
}
