import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  formatRecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
  RECOVERY_KEY_BYTES,
} from "../../../src/crypto/recovery-key.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SHAPE = /^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{4}$/;
const SEQUENCE = Uint8Array.from({ length: 20 }, (_, i) => i);

/** The check group computed independently, with Node's own SHA-256. */
function nodeCheck(bytes: Uint8Array): string {
  const hash = createHash("sha256")
    .update("keyworth/recovery-check/v1")
    .update(bytes)
    .digest();
  const value =
    ((hash[0] ?? 0) << 12) | ((hash[1] ?? 0) << 4) | ((hash[2] ?? 0) >>> 4);
  return [15, 10, 5, 0]
    .map((shift) => ALPHABET.charAt((value >>> shift) & 31))
    .join("");
}

describe("recovery keys", () => {
  it("hold 160 random bits as 32 characters plus a check group of four", () => {
    const { bytes, text } = generateRecoveryKey();

    expect(bytes).toHaveLength(RECOVERY_KEY_BYTES);
    expect(text).toMatch(SHAPE);
    expect(text.slice(-4)).toBe(nodeCheck(bytes));
  });

  it("use all 160 bits: across 64 keys every bit takes both values", () => {
    const keys = Array.from({ length: 64 }, () => generateRecoveryKey().bytes);

    for (let bit = 0; bit < 160; bit++) {
      const values = new Set(
        keys.map((key) => ((key[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1),
      );
      expect(values.size, `bit ${String(bit)}`).toBe(2);
    }
  });

  it("never use the letters people misread (I, L, O, U)", () => {
    const texts = Array.from(
      { length: 200 },
      () => generateRecoveryKey().text,
    ).join("");

    expect(texts).not.toMatch(/[ILOU]/);
  });

  it("round-trip through text", () => {
    for (let i = 0; i < 50; i++) {
      const { bytes, text } = generateRecoveryKey();
      expect(parseRecoveryKey(text)).toEqual(bytes);
    }
  });

  // Fixed strings: keys people wrote down must keep decoding to the same bytes.
  it("encode known bytes the same way every time", () => {
    expect(formatRecoveryKey(new Uint8Array(20))).toBe(
      "0000-0000-0000-0000-0000-0000-0000-0000-S2B3",
    );
    expect(formatRecoveryKey(new Uint8Array(20).fill(0xff))).toBe(
      "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-Z2Z7",
    );
    expect(formatRecoveryKey(SEQUENCE)).toBe(
      "000G-40R4-0M30-E209-185G-R38E-1W81-24GK-B0P9",
    );
    expect(
      parseRecoveryKey("000G-40R4-0M30-E209-185G-R38E-1W81-24GK-B0P9"),
    ).toEqual(SEQUENCE);
  });

  it("accept what people type: lower case, spaces, missing dashes, look-alikes", () => {
    expect(
      parseRecoveryKey(" oooo-oooo-oooo-oooo-oooo-oooo-oooo-oooo-s2b3 "),
    ).toEqual(new Uint8Array(20));
    expect(
      parseRecoveryKey("000g 4or4 om3o e2o9 l85g r38e iw8l 24gk bop9"),
    ).toEqual(SEQUENCE);
    expect(parseRecoveryKey("000G40R40M30E209185GR38E1W8124GKB0P9")).toEqual(
      SEQUENCE,
    );
  });

  it("accept what people paste: any dash, a soft hyphen, full-width forms", () => {
    const text = formatRecoveryKey(SEQUENCE);

    for (const separator of ["–", "—", "‐", "‑", "−"]) {
      expect(parseRecoveryKey(text.replaceAll("-", separator))).toEqual(
        SEQUENCE,
      );
    }
    expect(parseRecoveryKey(text.replaceAll("-", "-\u00ad"))).toEqual(SEQUENCE);
    expect(parseRecoveryKey(text.replace("000G", "０００Ｇ"))).toEqual(
      SEQUENCE,
    );
  });

  it("report a typo as mistyped: one changed character or two swapped", () => {
    const text = formatRecoveryKey(SEQUENCE);
    const changed = text.replace("40R4", "40R5");
    const swapped = text.replace("40R4", "4R04");
    const wrongCheck = text.replace("B0P9", "B0P8");

    for (const typo of [changed, swapped, wrongCheck]) {
      expect(() => parseRecoveryKey(typo)).toThrow(
        expect.objectContaining({ code: "mistyped" }),
      );
    }
  });

  it("report characters other than plain Latin as not-latin", () => {
    // A Cyrillic "С" and "Е" look like the Latin ones.
    const cyrillic = formatRecoveryKey(SEQUENCE).replace("E209", "Е209");

    expect(() => parseRecoveryKey(cyrillic)).toThrow(
      expect.objectContaining({ code: "not-latin" }),
    );
    expect(() => parseRecoveryKey(`${"0".repeat(35)}ñ`)).toThrow(
      expect.objectContaining({ code: "not-latin" }),
    );
  });

  it.each([
    ["too short", "ABCD-EFGH"],
    ["without its check group", "0000-0000-0000-0000-0000-0000-0000-0000"],
    ["too long", `${formatRecoveryKey(SEQUENCE)}-0`],
    ["with a U", `U${"0".repeat(35)}`],
    ["with punctuation", `${"0".repeat(35)}!`],
    ["empty", ""],
  ])("reject text that cannot be a key: %s", (_, text) => {
    expect(() => parseRecoveryKey(text)).toThrow(
      expect.objectContaining({ code: "invalid-input" }),
    );
  });
});
