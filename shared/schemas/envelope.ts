import {
  BASE64URL,
  base64urlBytes,
  base64urlLength,
  isCanonicalBase64url,
} from "./base64url.ts";
import { z } from "./zod.ts";

/*
 * The encrypted "envelope" of a vault record: everything the server stores and
 * returns for it. It is validated on both sides: the server rejects anything
 * that could not have come from src/crypto/envelope.ts, and the browser checks
 * the shape before it tries to decrypt.
 */

export const ENVELOPE_VERSION = 1;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

/**
 * Plaintext is padded to a power of two between these sizes before encryption
 * (src/crypto/padding.ts), so the server learns a size bucket, not a length.
 */
export const MIN_PADDED_BYTES = 256;
export const MAX_PADDED_BYTES = 64 * 1024;

// Every possible ciphertext is one padding bucket plus the GCM tag.
const CIPHERTEXT_LENGTHS = new Set<number>();
for (let size = MIN_PADDED_BYTES; size <= MAX_PADDED_BYTES; size *= 2) {
  CIPHERTEXT_LENGTHS.add(base64urlLength(size + TAG_BYTES));
}

export const envelopeSchema = z.strictObject({
  v: z.literal(ENVELOPE_VERSION),
  alg: z.literal("A256GCM"),
  iv: base64urlBytes(IV_BYTES),
  ct: z
    .string()
    .regex(BASE64URL)
    .refine((ct) => CIPHERTEXT_LENGTHS.has(ct.length), {
      message: "Ciphertext length is not a padding bucket plus the tag",
    })
    .refine(isCanonicalBase64url, { message: "Not canonical base64url" }),
});

export type Envelope = z.infer<typeof envelopeSchema>;
