import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  parseCsv,
  plainCell,
  safeCell,
  toCsv,
} from "../../../src/features/transactions/csv.ts";

/*
 * CSV as RFC 4180 has it, the part a file of transactions needs: what
 * spreadsheets write (quotes, separators, line ends) reads back as it was
 * written, and what Keyworth writes opens as text, never as a formula.
 */

const records = (text: string) => {
  const parsed = parseCsv(text);
  if ("problem" in parsed) throw new Error(parsed.problem);
  return parsed.records;
};

describe("reading CSV", () => {
  it("splits fields at commas and records at line ends of any kind", () => {
    expect(records("a,b\r\nc,d\ne,f\rg,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("takes a quoted field whole: separators, line breaks, doubled quotes", () => {
    expect(records('"1,5","say ""hi""","two\nlines",""\n')).toEqual([
      ["1,5", 'say "hi"', "two\nlines", ""],
    ]);
  });

  it("keeps empty fields, and blank lines as records, so rows keep their numbers", () => {
    expect(records("a,,b,\n\nc")).toEqual([["a", "", "b", ""], [""], ["c"]]);
  });

  it("does not add a record for the final line break", () => {
    expect(records("a\n")).toEqual([["a"]]);
    expect(records("")).toEqual([]);
  });

  it("treats a quote inside an unquoted field as a character", () => {
    expect(records('5" screen,x')).toEqual([['5" screen', "x"]]);
  });

  it("refuses a quote that never closes", () => {
    expect(parseCsv('a,"b\nc,d')).toEqual({ problem: "unclosed-quote" });
  });

  it("finds the separator from the first line: comma, semicolon or tab", () => {
    expect(detectDelimiter("Date;Type;Note\n1,5;x;y")).toBe(";");
    expect(detectDelimiter("Date\tType\n")).toBe("\t");
    expect(detectDelimiter('"a;b",c\n')).toBe(",");
    expect(detectDelimiter("Date")).toBe(",");
    expect(records("a;b\n1,5;2")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });
});

describe("writing CSV", () => {
  it("quotes only what needs it, and ends every line with CRLF", () => {
    expect(
      toCsv([
        ["Date", "Note"],
        ["2025-01-01", 'a "b", c'],
      ]),
    ).toBe('Date,Note\r\n2025-01-01,"a ""b"", c"\r\n');
  });

  it("reads back what it wrote", () => {
    const tricky = [
      ["", ",", ";", "\t", '"', '""', "a\r\nb", "x\ny", "é ü 中", " pad "],
    ];
    expect(records(toCsv(tricky))).toEqual(tricky);
  });
});

describe("cells and formulas", () => {
  it("keeps a would-be formula as text with a leading quote", () => {
    for (const formula of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
      expect(safeCell(formula)).toBe(`'${formula}`);
    }
    expect(safeCell("Bitcoin")).toBe("Bitcoin");
    expect(safeCell("'quoted")).toBe("'quoted");
  });

  it("takes the quote off again when reading, and only that quote", () => {
    expect(plainCell(safeCell('=HYPERLINK("x")'))).toBe('=HYPERLINK("x")');
    expect(plainCell("'quoted")).toBe("'quoted");
    expect(plainCell("plain")).toBe("plain");
  });
});
