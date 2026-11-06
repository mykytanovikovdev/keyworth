import { describe, expect, it } from "vitest";
import { decimal, toNumber, ZERO } from "../../../shared/money/decimal.ts";

describe("decimal", () => {
  it("adds without the float error: 0.1 + 0.2 is 0.3", () => {
    expect(decimal("0.1").plus(decimal("0.2")).toString()).toBe("0.3");
  });

  it("keeps every digit of a large amount with 18 decimal places", () => {
    const quantity = decimal("123456789012.123456789012345678");
    expect(quantity.times(decimal("3")).toString()).toBe(
      "370370367036.370370367037037034",
    );
  });

  it("never writes an exponent, for huge or tiny values", () => {
    expect(decimal("1e30").toString()).toBe(`1${"0".repeat(30)}`);
    expect(decimal("1e-18").toString()).toBe("0.000000000000000001");
    expect(JSON.stringify({ amount: decimal("1e-18") })).toBe(
      '{"amount":"0.000000000000000001"}',
    );
  });

  it("rounds division half-even at 40 places", () => {
    expect(decimal("1").div(decimal("3")).toString()).toBe(
      `0.${"3".repeat(40)}`,
    );
    // ...25 at the 42nd place is exactly halfway: 2 stays even.
    expect(
      decimal(`0.${"0".repeat(39)}25`)
        .div(decimal("1"))
        .toString(),
    ).toBe(`0.${"0".repeat(39)}2`);
  });

  it("refuses the two ways a float could slip in", () => {
    // @ts-expect-error a number is what strict mode refuses
    expect(() => decimal(0.1)).toThrow();
    expect(() => Number(decimal("1").valueOf())).toThrow();
  });

  it("converts to a number for statistics, even when not exact", () => {
    expect(toNumber(decimal("1").div(decimal("3")))).toBeCloseTo(1 / 3, 12);
    expect(toNumber(ZERO)).toBe(0);
  });
});
