# shared/money/

## Purpose

Decimal arithmetic for money and quantities, so a sum never goes through a
floating-point `number`. Only this folder imports the library. It does no
currency conversion and no formatting: conversion needs rates
([shared/metrics/](../metrics/README.md) takes them as a parameter), and
formatting belongs to the screens.

## How it works

| File         | Role                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| `decimal.ts` | The configured constructor: `decimal("1.5")`, `ZERO`, the `Decimal` type, `toNumber` |

A `Decimal` is immutable: `a.plus(b)` returns a new value. Its methods come from
[big.js](https://github.com/MikeMcl/big.js): `plus`, `minus`, `times`, `div`,
`eq`, `lt`, `gt`, `round`, `toString`.

| Setting  | Value      | Why                                                       |
| -------- | ---------- | --------------------------------------------------------- |
| `DP`     | 40         | Places kept by `div`; far more than any amount has        |
| `RM`     | half-even  | Division only, so a long series of rounding has no drift  |
| `NE, PE` | ±1,000,000 | `toString` never writes an exponent, in logs or in JSON   |
| `strict` | on         | `decimal(0.1)` and `a < b` throw instead of using a float |

## Why this way

- **big.js, not decimal.js or bignumber.js.** Addition, subtraction and
  multiplication are always exact, so only division needs a decision. decimal.js
  rounds every operation to a precision in significant digits, which silently
  drops digits of a large amount with 18 decimal places. big.js is 6 KB with no
  dependencies; the bundle matters here, and we need nothing more.
- **Not dinero.js.** It models money as integers of a currency's smallest unit,
  which does not fit quantities of 18 decimal places or prices below one cent.
- **Not hand-written `BigInt` fixed point.** Rounding and scaling are exactly the
  kind of code that is easy to get subtly wrong.
- **Its own constructor (`Library()`).** The settings stay private to this module
  instead of changing a global that another package could also use.

## Pitfalls & gotchas

- `a < b` and `a + b` throw in strict mode (`valueOf`). Use `a.lt(b)` and
  `a.plus(b)`.
- `toNumber` is for statistics and charts. Library's own `.toNumber()` throws
  on values a `number` cannot hold exactly, which is most of them.
- Multiply before dividing: `cost.times(part).div(whole)` keeps every digit until
  the last step; `cost.div(whole).times(part)` rounds in the middle.

## How to work with it

```ts
import { decimal } from "../money/decimal.ts";

decimal("0.1").plus(decimal("0.2")).toString(); // "0.3"
```

Tests: `tests/unit/money/decimal.test.ts`.

## Related

- [shared/metrics/](../metrics/README.md): the calculations that use it
- [shared/schemas/](../schemas/README.md): the strings it parses
