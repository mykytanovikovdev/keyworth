import { describe, expect, it } from "vitest";
import type { Transaction } from "../../../shared/schemas/transaction.ts";
import { VAULT_LIMITS } from "../../../shared/schemas/vault.ts";
import {
  CSV_TEMPLATE,
  transactionsCsv,
} from "../../../src/features/transactions/csv-export.ts";
import {
  type ImportContext,
  coinsToLookUp,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_UNKNOWN_COINS,
  planImport,
  readTable,
  readText,
} from "../../../src/features/transactions/csv-import.ts";
import type { AssetChoice } from "../../../src/features/transactions/form-values.ts";
import { buy, entries, sell, transferOut } from "../metrics/fixtures.ts";

/*
 * Importing a CSV file: what is refused before reading, which rows become
 * transactions and which are skipped and why, duplicates, the ledger's rule
 * over the whole file, and an export that imports back as it was.
 */

const COINS: AssetChoice[] = [
  { id: "crypto:bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "crypto:ethereum", symbol: "ETH", name: "Ethereum" },
];
const NOW = Date.parse("2026-11-09T15:00:00Z");
const HEADER =
  "Date,Type,Coin,Symbol,Quantity,Price,Currency,Fee,Fee currency,Note";

const contextOf = (
  existing: { id: string; value: Transaction }[] = [],
  extra: Partial<ImportContext> = {},
): ImportContext => ({
  existing,
  stored: existing.length,
  coinById: (id) => COINS.find((coin) => coin.id === id),
  coinBySymbol: (symbol) =>
    COINS.find((coin) => coin.symbol === symbol.toUpperCase()),
  now: NOW,
  ...extra,
});

function plan(text: string, context = contextOf()) {
  const read = readTable(text);
  if ("problem" in read) throw new Error(read.problem.kind);
  const planned = planImport(read.table, context);
  if ("problem" in planned) throw new Error(planned.problem.kind);
  return planned.plan;
}

const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("reading the file", () => {
  it("refuses a file over the limit before reading it", async () => {
    const big = new Blob([new Uint8Array(IMPORT_MAX_BYTES + 1)]);
    expect(await readText(big)).toEqual({ problem: { kind: "too-large" } });
  });

  it("refuses bytes that are not UTF-8 text, and a NUL", async () => {
    const latin1 = new Blob([new Uint8Array([0x44, 0xe9, 0x0a])]);
    expect(await readText(latin1)).toEqual({ problem: { kind: "not-text" } });
    expect(await readText(new Blob(["Date\u0000"]))).toEqual({
      problem: { kind: "not-text" },
    });
  });

  it("drops a byte-order mark", async () => {
    const bom = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), "Date"]);
    expect(await readText(bom)).toEqual({ text: "Date" });
  });
});

describe("the columns", () => {
  it("names the ones missing", () => {
    expect(readTable("Date,Type,Quantity\n2025-01-01,Buy,1")).toEqual({
      problem: {
        kind: "missing-columns",
        columns: ["Price", "Currency", "Coin"],
      },
    });
  });

  it("takes headings in any case, with underscores, in any order", () => {
    const text =
      "note;FEE_CURRENCY;fee;currency;price;quantity;symbol;type;date\n" +
      ";EUR;1;eur;100;0,5;btc;buy;2025-01-01";
    expect(plan(text).added[0]?.value).toMatchObject({
      type: "buy",
      assetId: "crypto:bitcoin",
      quantity: "0.5",
      price: "100",
      priceCurrency: "EUR",
      fee: "1",
      feeCurrency: "EUR",
    });
  });

  it("refuses a file with a header and nothing else", () => {
    expect(readTable(`${HEADER}\n\n`)).toEqual({
      problem: { kind: "no-rows" },
    });
    expect(readTable("")).toEqual({ problem: { kind: "no-rows" } });
  });
});

describe("each row", () => {
  it("becomes the transaction the form would make, from the file", () => {
    const { added, problems } = plan(
      file(
        "2025-01-01,Buy,crypto:bitcoin,BTC,0.5,60000,USD,1.5,,first",
        "2025-01-02T09:15:00.000Z,Sell,,btc,0.1,61000,usdt,,,",
        "2025-01-03,Receive,,ETH,2,0,USD,,,airdrop",
        "2025-01-04,Income,,ETH,0.01,3000,EUR,,,",
        "2025-01-05,Send,,ETH,1,999,USD,,,",
      ),
    );
    expect(problems).toEqual([]);
    expect(added.map(({ row, value }) => ({ row, value }))).toEqual([
      {
        row: 2,
        value: {
          type: "buy",
          assetId: "crypto:bitcoin",
          executedAt: "2025-01-01T12:00:00Z",
          quantity: "0.5",
          price: "60000",
          priceCurrency: "USD",
          fee: "1.5",
          note: "first",
          source: "csv",
        },
      },
      {
        row: 3,
        value: {
          type: "sell",
          assetId: "crypto:bitcoin",
          executedAt: "2025-01-02T09:15:00Z",
          quantity: "0.1",
          price: "61000",
          priceCurrency: "USDT",
          source: "csv",
        },
      },
      {
        row: 4,
        value: {
          type: "transfer_in",
          assetId: "crypto:ethereum",
          executedAt: "2025-01-03T12:00:00Z",
          quantity: "2",
          price: "0",
          priceCurrency: "USD",
          note: "airdrop",
          source: "csv",
        },
      },
      {
        row: 5,
        value: {
          type: "income",
          assetId: "crypto:ethereum",
          executedAt: "2025-01-04T12:00:00Z",
          quantity: "0.01",
          price: "3000",
          priceCurrency: "EUR",
          source: "csv",
        },
      },
      {
        // A send has no price: what the file says there is ignored.
        row: 6,
        value: {
          type: "transfer_out",
          assetId: "crypto:ethereum",
          executedAt: "2025-01-05T12:00:00Z",
          quantity: "1",
          source: "csv",
        },
      },
    ]);
  });

  it("is skipped with what is wrong, numbered as a spreadsheet numbers it", () => {
    const { added, problems } = plan(
      file(
        "31/12/2025,Buy,,BTC,1,1,USD,,,",
        "2025-02-30,Buy,,BTC,1,1,USD,,,",
        "",
        "2025-01-01,Transfer,,BTC,1,1,USD,,,",
        "2025-01-01,Buy,crypto:nothing,,1,1,USD,,,",
        "2025-01-01,Buy,,XYZ,1,1,USD,,,",
        "2025-01-01,Buy,,,1,1,USD,,,",
        "2025-01-01,Buy,,BTC,0,1,USD,,,",
        "2025-01-01,Buy,,BTC,1,0,USD,,,",
        "2025-01-01,Receive,,BTC,1,,USD,,,",
        "2025-01-01,Buy,,BTC,1,1,XXX,,,",
        "2025-01-01,Buy,,BTC,1,1,USD,lots,,",
        "2027-01-01,Buy,,BTC,1,1,USD,,,",
      ),
    );
    expect(added).toEqual([]);
    const expected: [number, string | RegExp][] = [
      [2, /^"31\/12\/2025" isn't a date/],
      [3, /^"2025-02-30" isn't a date/],
      [5, /^"Transfer" isn't a type/],
      [6, `"crypto:nothing" isn't a coin Keyworth knows.`],
      [7, /^"XYZ" isn't among the 250/],
      [8, "No coin: fill in Coin or Symbol."],
      [9, `"0" isn't a quantity greater than zero.`],
      [10, `"0" isn't a price greater than zero.`],
      [11, `"" isn't a value per coin (0 for a gift).`],
      [12, /^"XXX" isn't a currency/],
      [13, `"lots" isn't a fee.`],
      [14, "The date is in the future."],
    ];
    expect(problems.map(({ row }) => row)).toEqual(
      expected.map(([row]) => row),
    );
    problems.forEach(({ message }, index) => {
      const [, wanted] = expected[index] ?? [0, "?"];
      if (typeof wanted === "string") expect(message).toBe(wanted);
      else expect(message).toMatch(wanted);
    });
  });

  it("takes plain numbers with a point or a lone comma, and spaces between thousands", () => {
    const amounts = (quantity: string, price: string) =>
      plan(file(`2025-01-01,Buy,,BTC,"${quantity}","${price}",USD,,,`)).added[0]
        ?.value;
    expect(amounts("1.234", "60000")).toMatchObject({
      quantity: "1.234",
      price: "60000",
    });
    expect(amounts("0,5", "1234,567")).toMatchObject({
      quantity: "0.5",
      price: "1234.567",
    });
    expect(amounts("0,123", "1 234,50")).toMatchObject({
      quantity: "0.123",
      price: "1234.5",
    });
    expect(amounts("2", "1\u00a0234\u00a0567.5")).toMatchObject({
      price: "1234567.5",
    });
  });

  it("refuses a number grouped any other way, instead of reading it a thousand times off", () => {
    const { added, problems } = plan(
      file(
        '2025-01-01,Buy,,BTC,"1.234,50",1,USD,,,',
        '2025-01-01,Buy,,BTC,1,"1,234.50",USD,,,',
        '2025-01-01,Buy,,BTC,"1,234",1,USD,,,',
        '2025-01-01,Buy,,BTC,1,"60,000",USD,,,',
        "2025-01-01,Buy,,BTC,1,1,USD,1'000,,",
        '2025-01-01,Buy,,BTC,1,"1,000,000",USD,,,',
      ),
    );
    expect(added).toEqual([]);
    expect(problems.map(({ message }) => message)).toEqual([
      `"1.234,50" has a thousands separator: write numbers without one, with a point for decimals, such as 1234.5.`,
      `"1,234.50" has a thousands separator: write numbers without one, with a point for decimals, such as 1234.5.`,
      `"1,234" could mean 1234 or 1.234: write it without a thousands separator, with a point for decimals.`,
      `"60,000" could mean 60000 or 60.000: write it without a thousands separator, with a point for decimals.`,
      `"1'000" has a thousands separator: write numbers without one, with a point for decimals, such as 1234.5.`,
      `"1,000,000" has a thousands separator: write numbers without one, with a point for decimals, such as 1234.5.`,
    ]);
  });

  it("gets a note back as text, with the export's formula quote taken off", () => {
    const { added } = plan(
      file(`2025-01-01,Buy,,BTC,1,1,USD,,,"'=HYPERLINK(""x"")"`),
    );
    expect(added[0]?.value.note).toBe('=HYPERLINK("x")');
  });
});

describe("refused rows", () => {
  it("come back as a file to fix, with the reasons, that imports as it was written", () => {
    const { refusedCsv } = plan(
      file(
        "2025-01-01,Buy,,BTC,1,1,USD,,,ok",
        '2025-01-02,Buy,,BTC,"1,234",1,USD,,,=x',
        "2025-01-03,Buy,,XYZ,1,1,USD,,,",
      ),
    );
    if (!refusedCsv) throw new Error("Expected refused rows");
    const read = readTable(refusedCsv.slice(1));
    if ("problem" in read) throw new Error(read.problem.kind);

    expect(refusedCsv.startsWith("\uFEFF")).toBe(true);
    expect(read.table.rows.map(({ cells }) => cells.slice(0, 5))).toEqual([
      ["2025-01-02", "Buy", "", "BTC", "1,234"],
      ["2025-01-03", "Buy", "", "XYZ", "1"],
    ]);
    expect(read.table.rows[0]?.cells.at(-2)).toBe("'=x");
    expect(read.table.rows[1]?.cells.at(-1)).toMatch(/^"XYZ" isn't among/);
    expect(plan(file("2025-01-01,Buy,,BTC,1,1,USD,,,")).refusedCsv).toBeNull();
  });
});

describe("duplicates", () => {
  const recorded = entries(buy("2025-01-01", "0.5", "60000"));

  it("skips a row recorded already, and adds the rest", () => {
    const { added, duplicates } = plan(
      file(
        "2025-01-01T12:00:00Z,Buy,crypto:bitcoin,BTC,0.50,60000.0,USD,,,",
        "2025-01-01T12:00:00Z,Buy,crypto:bitcoin,BTC,0.5,60000,EUR,,,",
      ),
      contextOf(recorded),
    );
    expect(duplicates).toEqual([2]);
    expect(added.map(({ row }) => row)).toEqual([3]);
  });

  it("matches each recorded one once: equal rows in a file are equal fills", () => {
    const { added, duplicates } = plan(
      file(
        "2025-01-01,Buy,,BTC,0.5,60000,USD,,,",
        "2025-01-01,Buy,,BTC,0.5,60000,USD,,,",
      ),
      contextOf(recorded),
    );
    expect(duplicates).toEqual([2]);
    expect(added.map(({ row }) => row)).toEqual([3]);
  });
});

describe("the ledger's rule over the whole file", () => {
  it("takes a sale whose purchase comes further down the file", () => {
    const { added, problems } = plan(
      file(
        "2025-02-01,Sell,,BTC,0.5,70000,USD,,,",
        "2025-01-01,Buy,,BTC,0.5,60000,USD,,,",
      ),
    );
    expect(problems).toEqual([]);
    expect(added).toHaveLength(2);
  });

  it("skips a sale of more than was held, and says how much was", () => {
    const { added, problems } = plan(
      file(
        "2025-01-01,Buy,,BTC,0.5,60000,USD,,,",
        "2025-02-01,Sell,,BTC,0.7,70000,USD,,,",
      ),
    );
    expect(added.map(({ row }) => row)).toEqual([2]);
    expect(problems).toEqual([
      {
        row: 3,
        message:
          "Sells 0.7 BTC, but you held 0.5 BTC on February 1, 2025. Fix the quantity, or add the buy before it.",
      },
    ]);
  });

  it("skips a send that would leave a recorded later sale short", () => {
    const recorded = entries(
      buy("2025-01-01", "1", "60000"),
      sell("2025-03-01", "1", "70000"),
    );
    const { added, problems } = plan(
      file("2025-02-01,Send,,BTC,0.2,,,,,"),
      contextOf(recorded),
    );
    expect(added).toEqual([]);
    expect(problems).toEqual([
      {
        row: 2,
        message:
          "This would leave your recorded 1 BTC going out on March 1, 2025 short: fix this row's quantity.",
      },
    ]);
  });
});

describe("coins looked up by id", () => {
  const lookUp = (
    text: string,
    known: (id: string) => boolean = () => false,
  ) => {
    const read = readTable(text);
    if ("problem" in read) throw new Error(read.problem.kind);
    return coinsToLookUp(read.table, known);
  };

  it("are the well-formed ids the snapshot lacks, once each", () => {
    expect(
      lookUp(
        file(
          "2025-01-01,Buy,crypto:bitcoin,,1,1,USD,,,",
          "2025-01-01,Buy,crypto:rare,,1,1,USD,,,",
          "2025-01-01,Buy,crypto:rare,,1,1,USD,,,",
          "2025-01-01,Buy,Not An Id,,1,1,USD,,,",
          "2025-01-01,Buy,,BTC,1,1,USD,,,",
        ),
        (id) => id === "crypto:bitcoin",
      ),
    ).toEqual({ ids: ["crypto:rare"] });
  });

  it("are refused past a hundred, before any is asked for", () => {
    const rows = Array.from(
      { length: IMPORT_MAX_UNKNOWN_COINS + 1 },
      (_, i) => `2025-01-01,Buy,crypto:coin-${String(i)},,1,1,USD,,,`,
    );
    expect(lookUp(file(...rows))).toEqual({
      problem: {
        kind: "too-many-coins",
        coins: IMPORT_MAX_UNKNOWN_COINS + 1,
        limit: IMPORT_MAX_UNKNOWN_COINS,
      },
    });
    expect(lookUp(file(...rows.slice(1)))).toMatchObject({
      ids: expect.any(Array) as unknown,
    });
  });
});

describe("room in the account", () => {
  it("refuses at once a file longer than the room and every recorded row together", () => {
    const read = readTable(
      file("2025-01-01,Buy,,BTC,1,1,USD,,,", "2025-01-02,Buy,,BTC,1,1,USD,,,"),
    );
    if ("problem" in read) throw new Error(read.problem.kind);

    expect(
      planImport(
        read.table,
        contextOf([], { stored: VAULT_LIMITS.maxRecords - 1 }),
      ),
    ).toEqual({ problem: { kind: "over-quota", rows: 2, room: 1 } });
  });

  it("refuses the file when its new rows do not fit", () => {
    const read = readTable(
      file("2025-01-01,Buy,,BTC,1,1,USD,,,", "2025-01-02,Buy,,BTC,1,1,USD,,,"),
    );
    if ("problem" in read) throw new Error(read.problem.kind);
    expect(
      planImport(
        read.table,
        contextOf([], { stored: VAULT_LIMITS.maxRecords - 1 }),
      ),
    ).toEqual({ problem: { kind: "over-quota", rows: 2, room: 1 } });
  });
});

describe("an export imported back", () => {
  const assetOf = (id: string) =>
    COINS.find((coin) => coin.id === id) ?? { id, symbol: "?", name: id };
  const recorded = entries(
    buy("2025-01-01", "0.5", "60000", {
      fee: "1.5",
      feeCurrency: "EUR",
      note: "=1+1, said the note",
    }),
    transferOut("2025-03-01", "0.1"),
    sell("2025-02-01", "0.2", "70000", { priceCurrency: "USDT" }),
  );

  it("is a file of the same transactions, oldest first, safe to open", () => {
    const { text, rows, left } = transactionsCsv(
      recorded.map(({ value }) => value),
      assetOf,
    );
    expect({ rows, left }).toEqual({ rows: 3, left: 0 });
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.slice(1).split("\r\n")).toEqual([
      HEADER,
      `2025-01-01T12:00:00Z,Buy,crypto:bitcoin,BTC,0.5,60000,USD,1.5,EUR,"'=1+1, said the note"`,
      "2025-02-01T12:00:00Z,Sell,crypto:bitcoin,BTC,0.2,70000,USDT,,,",
      "2025-03-01T12:00:00Z,Send,crypto:bitcoin,BTC,0.1,,,,,",
      "",
    ]);
  });

  it("adds them all to an empty account, and nothing to the same one", () => {
    const { text } = transactionsCsv(
      recorded.map(({ value }) => value),
      assetOf,
    );
    const fresh = plan(text.slice(1));
    expect(fresh.problems).toEqual([]);
    // As recorded, but from a file; a send never had a price currency to keep.
    const send = {
      type: "transfer_out",
      assetId: "crypto:bitcoin",
      executedAt: "2025-03-01T12:00:00Z",
      quantity: "0.1",
      source: "manual",
    };
    expect(
      fresh.added.map(({ value }) => ({ ...value, source: "manual" })),
    ).toEqual([recorded[0]?.value, recorded[2]?.value, send]);
    const again = plan(text.slice(1), contextOf(recorded));
    expect(again.added).toEqual([]);
    expect(again.duplicates).toEqual([2, 3, 4]);
  });

  it("and the template imports as it is", () => {
    const { added, problems } = plan(CSV_TEMPLATE.slice(1));
    expect(problems).toEqual([]);
    expect(added).toHaveLength(5);
  });
});
