import { priceCurrencySchema } from "./currencies.ts";
import { z } from "./zod.ts";

/*
 * What a "transaction" record holds once decrypted. Only the browser ever sees
 * it. Amounts are strings of plain digits, because a `number` would lose digits
 * before any calculation starts. Loose objects, like settings: an older tab that
 * saves a transaction must not erase a field a newer version added.
 */

/** Plain digits and up to 18 decimal places: what EVM tokens need. No exponent. */
const decimalString = z.string().regex(/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/);
const positiveDecimalString = decimalString.refine((value) =>
  /[1-9]/.test(value),
);

const common = {
  /** Kind and the source's id: "crypto:bitcoin" (shared/schemas/market.ts). */
  assetId: z.string().regex(/^[a-z]+:[A-Za-z0-9._-]{1,90}$/),
  /** ISO 8601 in UTC. */
  executedAt: z.iso.datetime(),
  note: z.string().max(1000).optional(),
  source: z.enum(["manual", "chat", "csv"]),
};

const trade = {
  quantity: positiveDecimalString,
  price: positiveDecimalString,
  /** A currency, or USDT or USDC at their own rate to the dollar. */
  priceCurrency: priceCurrencySchema,
  fee: decimalString.optional(),
  /** The price currency when absent. */
  feeCurrency: priceCurrencySchema.optional(),
};

/** A price is what these units were worth, so 0 is possible (an airdrop). */
const received = {
  quantity: positiveDecimalString,
  price: decimalString,
  priceCurrency: priceCurrencySchema,
};

export const transactionSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("buy"), ...common, ...trade }),
  z.looseObject({ type: z.literal("sell"), ...common, ...trade }),
  /** Units from outside what is recorded: its price becomes their cost. */
  z.looseObject({ type: z.literal("transfer_in"), ...common, ...received }),
  /** Units that left; the quantity includes any network fee. */
  z.looseObject({
    type: z.literal("transfer_out"),
    ...common,
    quantity: positiveDecimalString,
  }),
  /** Staking, interest and the like, received in units of the asset. */
  z.looseObject({ type: z.literal("income"), ...common, ...received }),
  /** New units per old one: "4" for 4-for-1, "0.1" for 1-for-10. */
  z.looseObject({
    type: z.literal("split"),
    ...common,
    ratio: positiveDecimalString,
  }),
]);

export type Transaction = z.infer<typeof transactionSchema>;
