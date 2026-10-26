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

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Length of `bytes` bytes in unpadded base64url. */
export const base64urlLength = (bytes: number) => Math.ceil((bytes * 4) / 3);

// Every possible ciphertext is one padding bucket plus the GCM tag.
const CIPHERTEXT_LENGTHS = new Set<number>();
for (let size = MIN_PADDED_BYTES; size <= MAX_PADDED_BYTES; size *= 2) {
  CIPHERTEXT_LENGTHS.add(base64urlLength(size + TAG_BYTES));
}

export const envelopeSchema = z.strictObject({
  v: z.literal(ENVELOPE_VERSION),
  alg: z.literal("A256GCM"),
  iv: z.string().regex(BASE64URL).length(base64urlLength(IV_BYTES)),
  ct: z
    .string()
    .regex(BASE64URL)
    .refine((ct) => CIPHERTEXT_LENGTHS.has(ct.length), {
      message: "Ciphertext length is not a padding bucket plus the tag",
    }),
});

export type Envelope = z.infer<typeof envelopeSchema>;
