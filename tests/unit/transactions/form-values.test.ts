import { describe, expect, it } from "vitest";
import {
  executedAt,
  parseAmount,
  typedAmount,
} from "../../../src/features/transactions/form-values.ts";

/*
 * What the form's amount fields let through as they are typed or pasted into,
 * and what they mean once read.
 */

describe("a day without a time", () => {
  const now = Date.parse("2026-11-09T15:00:00Z");

  it("is noon UTC, or now while noon is still ahead", () => {
    expect(executedAt("2026-11-08", now)).toBe("2026-11-08T12:00:00Z");
    expect(executedAt("2026-11-09", Date.parse("2026-11-09T08:30:00Z"))).toBe(
      "2026-11-09T08:30:00Z",
    );
  });

  it("keeps its noon when it has begun nowhere yet, so the rules refuse it", () => {
    // Begun in UTC+14 (10:00 UTC on the 9th): already a day of someone's.
    expect(executedAt("2026-11-10", now)).toBe("2026-11-09T15:00:00Z");
    expect(executedAt("2026-11-11", now)).toBe("2026-11-11T12:00:00Z");
  });
});

describe("typing an amount", () => {
  it.each([
    ["a digit", "", "5", "5"],
    ["a point", "0", "0.", "0."],
    ["a comma, as a phone's number pad in Europe gives", "0", "0,", "0,"],
    ["a separator first, which gets its zero", "", ",", "0,"],
    [
      "18 decimal places",
      "0.00000000000000000",
      "0.000000000000000001",
      "0.000000000000000001",
    ],
  ])("lets through %s", (_, previous, next, kept) => {
    expect(typedAmount(next, previous)).toBe(kept);
  });

  it.each([
    ["a letter", "1", "1a"],
    ["an exponent", "1", "1e"],
    ["a sign", "", "-"],
    ["a second point", "0.5", "0.5."],
    ["a comma after a point", "0.5", "0.5,"],
    ["a 19th decimal place", "0.000000000000000001", "0.0000000000000000011"],
    ["a 31st digit before the separator", "1".repeat(30), "1".repeat(31)],
  ])("ignores %s", (_, previous, next) => {
    expect(typedAmount(next, previous)).toBe(previous);
  });

  it("drops spaces", () => {
    expect(typedAmount("1 ", "1")).toBe("1");
  });
});

describe("pasting an amount", () => {
  it.each([
    ["thousands with commas, a decimal point", "60,000.03", "60000.03"],
    ["thousands with points, a decimal comma", "1.000,50", "1000.50"],
    ["thousands with commas only", "1,000,000", "1000000"],
    ["thousands with spaces", "60 000.03", "60000.03"],
  ])("keeps the digits of %s", (_, pasted, kept) => {
    expect(typedAmount(pasted, "")).toBe(kept);
  });

  it.each([
    ["a currency sign", "$60"],
    ["an exponent", "1e5"],
    ["text", "half"],
  ])("refuses one with %s", (_, pasted) => {
    expect(typedAmount(pasted, "2")).toBe("2");
  });
});

describe("reading an amount", () => {
  it.each([
    ["0,5", "0.5"],
    ["0.50", "0.5"],
    ["60000.03", "60000.03"],
    ["007", "7"],
  ])("reads %s as %s", (typed, plain) => {
    expect(parseAmount(typed)).toBe(plain);
  });

  it.each([[""], ["0."], [","]])("finds no amount in %j", (typed) => {
    expect(parseAmount(typed)).toBeNull();
  });
});
