// Display formatting for the prototype. Real money math (decimal strings) lives in
// shared/money from phase 4; these mocks only need to look right.

const MINUS = "−";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const signedUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
});
const signedPercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

// A real minus sign lines up with plus signs and reads as a sign, not a hyphen.
const withMinus = (text: string) => text.replace("-", MINUS);

export const formatUsd = (value: number) => withMinus(usd.format(value));
export const formatSignedUsd = (value: number) =>
  withMinus(signedUsd.format(value));
export const formatSignedPercent = (value: number) =>
  withMinus(signedPercent.format(value / 100));
export const formatShare = (value: number) => percent.format(value / 100);

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Axis ticks: $46.5K rather than $46,500.00. */
export const formatCompactUsd = (value: number) =>
  withMinus(compactUsd.format(value));

const tickPercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** Axis ticks: +2% rather than +2.0%. */
export const formatTickPercent = (value: number) =>
  withMinus(tickPercent.format(value / 100));
