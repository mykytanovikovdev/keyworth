import { describe, expect, it } from "vitest";
import { FIAT_CURRENCIES } from "../../shared/schemas/currencies.ts";
import { envelopeSchema } from "../../shared/schemas/envelope.ts";
import { KDF_LIMITS, kdfParamsSchema } from "../../shared/schemas/keys.ts";
import { settingsSchema } from "../../shared/schemas/settings.ts";
import {
  cleanText,
  hasHiddenCharacters,
  plainTextSchema,
  typedText,
} from "../../shared/schemas/text.ts";
import { transactionSchema } from "../../shared/schemas/transaction.ts";
import { recordKindSchema } from "../../shared/schemas/vault.ts";

// Base64url lengths: 12-byte IV → 16 characters; 256-byte bucket + tag → 363.
const valid = {
  v: 1,
  alg: "A256GCM",
  iv: "A".repeat(16),
  ct: "A".repeat(363),
};

describe("envelopeSchema", () => {
  it("accepts a well-formed envelope", () => {
    expect(envelopeSchema.safeParse(valid).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["another version", { v: 2 }],
    ["another algorithm", { alg: "A128GCM" }],
    ["an IV that is not 12 bytes", { iv: "A".repeat(15) }],
    [
      "a ciphertext that is not a padding bucket plus the tag",
      { ct: "A".repeat(362) },
    ],
    ["characters outside base64url", { ct: `${"A".repeat(362)}+` }],
    ["an extra field", { note: "plaintext" }],
  ])("rejects %s", (_, change) => {
    expect(envelopeSchema.safeParse({ ...valid, ...change }).success).toBe(
      false,
    );
  });

  it("accepts every bucket up to 64 KiB and nothing larger", () => {
    const lengthOf = (bytes: number) => Math.ceil((bytes * 4) / 3);
    for (let size = 256; size <= 64 * 1024; size *= 2) {
      expect(
        envelopeSchema.safeParse({
          ...valid,
          ct: "A".repeat(lengthOf(size + 16)),
        }).success,
      ).toBe(true);
    }
    expect(
      envelopeSchema.safeParse({
        ...valid,
        ct: "A".repeat(lengthOf(128 * 1024 + 16)),
      }).success,
    ).toBe(false);
  });
});

describe("kdfParamsSchema", () => {
  const params = {
    alg: "argon2id",
    version: 19,
    memoryKiB: 65536,
    passes: 3,
    parallelism: 1,
  };

  it("accepts the production settings", () => {
    expect(kdfParamsSchema.safeParse(params).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["another algorithm", { alg: "argon2i" }],
    ["another version", { version: 16 }],
    [
      "less memory than OWASP's minimum",
      { memoryKiB: KDF_LIMITS.minMemoryKiB - 1 },
    ],
    [
      "more memory than a page should take",
      { memoryKiB: KDF_LIMITS.maxMemoryKiB + 1 },
    ],
    ["one pass", { passes: 1 }],
    ["a string number", { passes: "3" }],
    ["an extra field", { salt: "x" }],
  ])("rejects %s", (_, change) => {
    expect(kdfParamsSchema.safeParse({ ...params, ...change }).success).toBe(
      false,
    );
  });
});

describe("recordKindSchema", () => {
  it("knows the planned kinds and nothing else", () => {
    for (const kind of [
      "settings",
      "transaction",
      "conversation",
      "message",
      "alert",
    ]) {
      expect(recordKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(recordKindSchema.safeParse("password").success).toBe(false);
  });
});

describe("transactionSchema", () => {
  const buy = {
    type: "buy",
    assetId: "crypto:bitcoin",
    executedAt: "2025-12-20T10:30:00Z",
    quantity: "0.5",
    price: "60000.03",
    priceCurrency: "USD",
    source: "manual",
  };
  const parses = (value: unknown) => transactionSchema.safeParse(value).success;

  it.each([
    ["a buy", buy],
    [
      "a sell with a fee",
      { ...buy, type: "sell", fee: "1.5", feeCurrency: "EUR" },
    ],
    ["a free trade fee", { ...buy, fee: "0" }],
    ["18 decimal places", { ...buy, quantity: "0.000000000000000001" }],
    ["a transfer in", { ...buy, type: "transfer_in" }],
    ["an airdrop, at price 0", { ...buy, type: "transfer_in", price: "0" }],
    ["income", { ...buy, type: "income", source: "csv" }],
    ["a price in USDT", { ...buy, priceCurrency: "USDT" }],
    [
      "a fee in USDC",
      { ...buy, priceCurrency: "USDC", fee: "0.1", feeCurrency: "USDC" },
    ],
    [
      "a transfer out, with no price",
      {
        type: "transfer_out",
        assetId: "crypto:bitcoin",
        executedAt: buy.executedAt,
        quantity: "0.5",
        source: "chat",
      },
    ],
    [
      "a split, with a ratio and no quantity",
      {
        type: "split",
        assetId: "stock:BRK.B",
        executedAt: buy.executedAt,
        ratio: "0.1",
        source: "manual",
      },
    ],
  ])("accepts %s", (_, value) => {
    expect(parses(value)).toBe(true);
  });

  it.each([
    ["an asset id without its kind", { assetId: "bitcoin" }],
    ["an asset id with a space", { assetId: "crypto:bit coin" }],
    ["an exponent", { quantity: "1e5" }],
    ["a comma", { quantity: "1,5" }],
    ["a sign", { quantity: "+1" }],
    ["a negative amount", { price: "-1" }],
    ["a leading zero", { quantity: "01" }],
    ["no digit before the point", { quantity: ".5" }],
    ["no digit after the point", { quantity: "5." }],
    ["19 decimal places", { quantity: "0.0000000000000000001" }],
    ["a number instead of a string", { quantity: 1 }],
    ["a quantity of zero", { quantity: "0.0" }],
    ["a purchase at price zero", { price: "0" }],
    ["a lower-case currency", { priceCurrency: "usd" }],
    ["a stablecoin other than USDT and USDC", { priceCurrency: "BUSD" }],
    ["a time with no zone", { executedAt: "2025-12-20T10:30:00" }],
    ["a time in another zone", { executedAt: "2025-12-20T10:30:00+04:00" }],
    ["a date alone", { executedAt: "2025-12-20" }],
    ["an unknown source", { source: "import" }],
    ["an unknown type", { type: "gift" }],
    ["a note too long", { note: "x".repeat(1001) }],
    ["a note that reverses its text", { note: "fee \u202Eeert" }],
    ["a note with an invisible space", { note: "Bin\u200Bance" }],
    ["a note on two lines", { note: "first\nsecond" }],
  ])("refuses %s", (_, change) => {
    expect(parses({ ...buy, ...change })).toBe(false);
  });

  it("needs a price for what comes in: it becomes the cost", () => {
    expect(parses({ ...buy, type: "transfer_in", price: undefined })).toBe(
      false,
    );
    expect(parses({ ...buy, type: "income", price: undefined })).toBe(false);
  });

  it("keeps fields a newer version added", () => {
    expect(transactionSchema.parse({ ...buy, later: 1 })).toMatchObject({
      later: 1,
    });
  });
});

describe("currencies", () => {
  it("lists each fiat currency once, by code, with a name", () => {
    const codes = FIAT_CURRENCIES.map(([code]) => code);
    expect(codes).toEqual([...new Set(codes)].sort());
    expect(codes).toEqual(expect.arrayContaining(["USD", "EUR", "GEL"]));
    for (const [code, name] of FIAT_CURRENCIES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect(name.trim()).not.toBe("");
    }
  });

  it("keeps the base currency a fiat code: a stablecoin is a price currency only", () => {
    expect(settingsSchema.safeParse({ baseCurrency: "GEL" }).success).toBe(
      true,
    );
    expect(settingsSchema.safeParse({ baseCurrency: "USDT" }).success).toBe(
      false,
    );
  });
});

describe("free text", () => {
  // Bidi override, zero-width space, a line break: as a hostile name could carry.
  const hostile = "Tiny‮​\nCoin";

  it("keeps one clean line: no hidden characters, single spaces, no edges", () => {
    expect(cleanText(hostile, 100)).toBe("Tiny Coin");
    expect(cleanText("  a ​ b\t\tc  ", 100)).toBe("a b c");
    expect(cleanText("NUL\u0000ESC\u001B", 100)).toBe("NULESC");
  });

  it("composes accents into one character, however they were typed", () => {
    expect(cleanText("café", 100)).toBe("café");
  });

  it("keeps markup as the text it is: it is only ever shown as text", () => {
    const markup = "<img src=x onerror=alert(1)>";
    expect(cleanText(markup, 100)).toBe(markup);
  });

  it("cuts at the limit without splitting a character or ending on a space", () => {
    expect(cleanText("\u{1F600}\u{1F600}", 3)).toBe("\u{1F600}");
    expect(cleanText("abc def", 4)).toBe("abc");
  });

  it("changes nothing when cleaning twice", () => {
    for (const text of [hostile, "a ​ b", "abc def", "café "]) {
      const once = cleanText(text, 5);
      expect(cleanText(once, 5)).toBe(once);
    }
  });

  it("lets a field keep spaces as typed, so the next word can follow", () => {
    expect(typedText("a ‮b\nc ", 100)).toBe("a b c ");
    expect(typedText("x".repeat(60), 50)).toHaveLength(50);
  });

  it("finds what cannot be seen", () => {
    expect(hasHiddenCharacters("plain text")).toBe(false);
    expect(hasHiddenCharacters("Bin​ance")).toBe(true);
    expect(hasHiddenCharacters("line\nbreak")).toBe(true);
  });

  it("accepts in a schema only text already as clean as cleanText leaves it", () => {
    const note = plainTextSchema(20);
    expect(note.safeParse("Bought on Kraken").success).toBe(true);
    expect(note.safeParse(" padded").success).toBe(false);
    expect(note.safeParse("café").success).toBe(false);
    expect(note.safeParse(hostile).success).toBe(false);
    expect(note.safeParse("x".repeat(21)).success).toBe(false);
  });
});
