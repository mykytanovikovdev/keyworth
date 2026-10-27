import { type KdfParams, kdfParamsSchema } from "../../shared/schemas/keys.ts";
import { CryptoError } from "./errors.ts";

export type { KdfParams };

/**
 * Approved for phase 3: RFC 9106's second recommended option (64 MiB, three
 * passes), with one lane because JavaScript runs Argon2 on one thread anyway.
 * New and upgraded passphrase slots use these.
 */
export const CURRENT_KDF_PARAMS: Readonly<KdfParams> = Object.freeze({
  alg: "argon2id",
  version: 19,
  memoryKiB: 64 * 1024,
  passes: 3,
  parallelism: 1,
});

export { SALT_BYTES } from "../../shared/schemas/keys.ts";
export const KEY_BYTES = 32;

/** Settings read from a stored slot are untrusted until they pass this. */
export function assertKdfParams(params: unknown): asserts params is KdfParams {
  if (!kdfParamsSchema.safeParse(params).success) {
    throw new CryptoError("invalid-input", "Unsupported Argon2id parameters.");
  }
}

/** False when a slot was made with older settings and should be rewrapped. */
export function isCurrentKdf(params: KdfParams): boolean {
  return (
    params.memoryKiB === CURRENT_KDF_PARAMS.memoryKiB &&
    params.passes === CURRENT_KDF_PARAMS.passes &&
    params.parallelism === CURRENT_KDF_PARAMS.parallelism
  );
}
