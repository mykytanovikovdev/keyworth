import { describe, expect, it } from "vitest";
import {
  checkPassphrase,
  normalizePassphrase,
  PASSPHRASE_MAX_LENGTH,
  PASSPHRASE_MIN_LENGTH,
} from "../../../src/crypto/passphrase.ts";

describe("checkPassphrase", () => {
  it("holds the limits exactly: 12 to 1,024 characters", () => {
    expect(PASSPHRASE_MIN_LENGTH).toBe(12);
    expect(PASSPHRASE_MAX_LENGTH).toBe(1024);
    expect(checkPassphrase("a".repeat(11))).toBe("too-short");
    expect(checkPassphrase("a".repeat(12))).toBeNull();
    expect(checkPassphrase("a".repeat(1024))).toBeNull();
    expect(checkPassphrase("a".repeat(1025))).toBe("too-long");
  });

  it("accepts every printable ASCII character", () => {
    const printable = Array.from({ length: 95 }, (_, i) =>
      String.fromCharCode(0x20 + i),
    ).join("");

    expect(checkPassphrase(`x${printable}x`)).toBeNull();
  });

  it.each([
    ["accents", "café au lait, s'il vous plaît"],
    ["Spanish letters", "mañana por la mañana"],
    ["German letters", "straße straße straße"],
    ["Cyrillic", "фиолетовый слон танцует"],
    ["a Cyrillic look-alike", "purple elephant dаnces"],
    ["an emoji", "purple elephant dances 🐘"],
    ["an invisible character", "purple​elephant dances"],
  ])("refuses %s as not plain Latin", (_, passphrase) => {
    expect(checkPassphrase(passphrase)).toBe("not-latin");
  });

  it("says not-latin before too-short, the more useful hint", () => {
    expect(checkPassphrase("ñ")).toBe("not-latin");
  });

  it("does not count spaces at either end", () => {
    expect(checkPassphrase(" ".repeat(12))).toBe("too-short");
    expect(checkPassphrase(`   ${"a".repeat(11)}   `)).toBe("too-short");
  });
});

describe("normalizePassphrase", () => {
  it("turns every kind of space into one ordinary space and trims the ends", () => {
    expect(normalizePassphrase(" a　b\tc d ")).toBe("a b c d");
  });

  it("turns full-width letters and digits into plain ones", () => {
    expect(normalizePassphrase("Ｐａｓｓ１２３")).toBe("Pass123");
  });

  it("keeps case, inner runs of spaces and punctuation", () => {
    expect(normalizePassphrase("Purple  Elephant, 42!")).toBe(
      "Purple  Elephant, 42!",
    );
  });
});
