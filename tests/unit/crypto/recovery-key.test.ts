import { describe, expect, it } from "vitest";
import {
  formatRecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
  RECOVERY_KEY_BYTES,
} from "../../../src/crypto/recovery-key.ts";

describe("recovery keys", () => {
  it("hold 160 random bits as 32 characters in eight groups", () => {
    const { bytes, text } = generateRecoveryKey();

    expect(bytes).toHaveLength(RECOVERY_KEY_BYTES);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
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

  it("encode known bytes the same way every time", () => {
    expect(formatRecoveryKey(new Uint8Array(20))).toBe(
      "0000-0000-0000-0000-0000-0000-0000-0000",
    );
    expect(formatRecoveryKey(new Uint8Array(20).fill(0xff))).toBe(
      "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ",
    );
  });

  it("accept what people type: lower case, spaces, missing dashes, look-alikes", () => {
    const { bytes, text } = generateRecoveryKey();
    const sloppy = ` ${text.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l")} `;

    expect(parseRecoveryKey(sloppy)).toEqual(bytes);
    expect(parseRecoveryKey(text.replace(/-/g, ""))).toEqual(bytes);
  });

  it.each([
    ["too short", "ABCD-EFGH"],
    ["too long", `${"A".repeat(32)}B`],
    ["with a U", `U${"A".repeat(31)}`],
    ["with punctuation", `${"A".repeat(31)}!`],
    ["empty", ""],
  ])("reject text that cannot be a key: %s", (_, text) => {
    expect(parseRecoveryKey(text)).toBeNull();
  });
});
