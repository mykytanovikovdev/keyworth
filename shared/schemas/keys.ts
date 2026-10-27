import { base64urlBytes } from "./base64url.ts";
import { IV_BYTES, TAG_BYTES } from "./envelope.ts";
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
 * Passphrase and recovery slots carry their format version `v`, so a future
 * format can be read alongside this one.
 */

export const SALT_BYTES = 16;
export const WRAPPED_KEY_BYTES = 32 + 16;
export const SLOT_VERSION = 1;

const wrapped = {
  iv: base64urlBytes(IV_BYTES),
  wrappedKey: base64urlBytes(WRAPPED_KEY_BYTES),
};

export const passphraseSlotSchema = z.strictObject({
  v: z.literal(SLOT_VERSION),
  kdf: kdfParamsSchema,
  salt: base64urlBytes(SALT_BYTES),
  ...wrapped,
});

export const recoverySlotSchema = z.strictObject({
  v: z.literal(SLOT_VERSION),
  salt: base64urlBytes(SALT_BYTES),
  ...wrapped,
});

/**
 * The server half of "Remember this device"; the device key never leaves it.
 * No version: device slots live for one session, and a format change simply
 * forgets remembered devices.
 */
export const deviceSlotSchema = z.strictObject(wrapped);

/**
 * The data key's check value: the 16-byte AES-GCM tag over nothing, with the
 * data key and an AAD naming the user. It tells the browser that a data key
 * belongs to this account, and nothing about the key.
 */
export const keyCheckSchema = z.strictObject({
  v: z.literal(SLOT_VERSION),
  iv: base64urlBytes(IV_BYTES),
  tag: base64urlBytes(TAG_BYTES),
});

/** First setup: both slots and the check value at once, or nothing. */
export const keySetupSchema = z.strictObject({
  passphrase: passphraseSlotSchema,
  recovery: recoverySlotSchema,
  check: keyCheckSchema,
});

/**
 * Replacing a slot names the slot it replaces by its IV (each wrapping has a
 * fresh random one): if another tab or device replaced it first, or this
 * request already went through and only its answer was lost, the server
 * answers 409 instead of silently overwriting.
 */
const replacing = <T extends z.ZodType>(slot: T) =>
  z.strictObject({ expectedIv: base64urlBytes(IV_BYTES), slot });

export const passphraseReplaceSchema = replacing(passphraseSlotSchema);
export const recoveryReplaceSchema = replacing(recoverySlotSchema);

export type PassphraseSlotJson = z.infer<typeof passphraseSlotSchema>;
export type RecoverySlotJson = z.infer<typeof recoverySlotSchema>;
export type DeviceSlotJson = z.infer<typeof deviceSlotSchema>;
export type KeyCheckJson = z.infer<typeof keyCheckSchema>;
export type KeySetupJson = z.infer<typeof keySetupSchema>;

/** What `GET /api/keys` returns: everything set up together, or nothing yet. */
export interface KeysJson {
  keys: {
    passphrase: PassphraseSlotJson;
    recovery: RecoverySlotJson;
    check: KeyCheckJson;
  } | null;
}
