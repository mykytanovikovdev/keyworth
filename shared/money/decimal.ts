import Library from "big.js";

/*
 * The one place that configures decimal arithmetic; an ESLint rule keeps every
 * other file from importing the library. Addition, subtraction and
 * multiplication are exact. Only division rounds, at far more places than any
 * amount has. Strict mode refuses `number` input and comparing with `<`, the
 * two ways a float could slip into a sum.
 */
const Big = Library();
Big.DP = 40;
Big.RM = Big.roundHalfEven;
// Never exponential notation: amounts leave here as plain digits.
Big.NE = -1e6;
Big.PE = 1e6;
Big.strict = true;

export type Decimal = Library.Big;

export const ZERO: Decimal = new Big("0");

/** Throws on anything but a number in a string; schemas check stored data first. */
export function decimal(value: string): Decimal {
  return new Big(value);
}

/**
 * For statistics and charts, where a ratio or a pixel needs no exact digits.
 * Never feed the result back into a sum.
 */
export function toNumber(value: Decimal): number {
  return Number(value.toString());
}
