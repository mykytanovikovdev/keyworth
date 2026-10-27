import { base64urlBytes } from "./base64url.ts";
import { IV_BYTES } from "./envelope.ts";
import { z } from "./zod.ts";

/*
 * Argon2id settings stored with a passphrase slot. They come back from the
 * server, so they are untrusted: the browser refuses anything weaker than
 * OWASP's minimum (19 MiB, two passes) and anything large enough to hang the
 * page or exhaust its memory.
 */

export const KDF_LIMITS = Object.freeze({
  minMemoryKiB: 19 * 1024,
  maxMemoryKiB: 256 * 1024,
  minPasses: 2,
  maxPasses: 10,
  maxParallelism: 4,
});

export const kdfParamsSchema = z.strictObject({
  alg: z.literal("argon2id"),
  /** Argon2 version 1.3 (0x13), the one RFC 9106 specifies. */
  version: z.literal(19),
  memoryKiB: z.int().min(KDF_LIMITS.minMemoryKiB).max(KDF_LIMITS.maxMemoryKiB),
  passes: z.int().min(KDF_LIMITS.minPasses).max(KDF_LIMITS.maxPasses),
  parallelism: z.int().min(1).max(KDF_LIMITS.maxParallelism),
});

export type KdfParams = z.infer<typeof kdfParamsSchema>;

/*
 * Wrapped copies of the data key ("slots") as they travel to and from
 * /api/keys. Every binary field has an exact length: a 16-byte salt, a 12-byte
 * IV and the 32-byte key encrypted with AES-GCM (plus its 16-byte tag).
 */

export const SALT_BYTES = 16;
export const WRAPPED_KEY_BYTES = 32 + 16;

const wrapped = {
  iv: base64urlBytes(IV_BYTES),
  wrappedKey: base64urlBytes(WRAPPED_KEY_BYTES),
};

export const passphraseSlotSchema = z.strictObject({
  kdf: kdfParamsSchema,
  salt: base64urlBytes(SALT_BYTES),
  ...wrapped,
});

export const recoverySlotSchema = z.strictObject({
  salt: base64urlBytes(SALT_BYTES),
  ...wrapped,
});

/** The server half of "Remember this device"; the device key never leaves it. */
export const deviceSlotSchema = z.strictObject(wrapped);

/** First setup: both slots at once, so a user never has only one of them. */
export const keySetupSchema = z.strictObject({
  passphrase: passphraseSlotSchema,
  recovery: recoverySlotSchema,
});

export type PassphraseSlotJson = z.infer<typeof passphraseSlotSchema>;
export type RecoverySlotJson = z.infer<typeof recoverySlotSchema>;
export type DeviceSlotJson = z.infer<typeof deviceSlotSchema>;
export type KeySetupJson = z.infer<typeof keySetupSchema>;
