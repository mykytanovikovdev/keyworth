import { KDF_LIMITS } from "../../../shared/schemas/keys.ts";
import type { KdfParams } from "../../../src/crypto/params.ts";

/**
 * OWASP's minimum: the cheapest settings the code accepts, so flow tests stay
 * fast. Production settings are exercised separately (kdf.test.ts and the
 * "production settings" test in key-slots.test.ts).
 */
export const FAST_KDF: KdfParams = {
  alg: "argon2id",
  version: 19,
  memoryKiB: KDF_LIMITS.minMemoryKiB,
  passes: KDF_LIMITS.minPasses,
  parallelism: 1,
};

/** Better Auth ids are 32 letters and digits. */
export const ALICE = "8BFRk1PpjTWtWzcpsTRTbk4JmogJsyNU";
export const BOB = "5GiZFW90hK5eEIia6AjWWMbL5DtOpbCn";
