import { z } from "./zod.ts";

/*
 * What a "settings" record holds once decrypted. Only the browser ever sees
 * it; the server stores the envelope. Unlike the wire schemas, this one keeps
 * fields it does not know (a loose object): a newer version of the app may add
 * one, and an older tab that saves the base currency must not erase it.
 */

export const DEFAULT_BASE_CURRENCY = "USD";

export const settingsSchema = z.looseObject({
  /** An ISO 4217 code; the list offered depends on the price source (phase 4). */
  baseCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
