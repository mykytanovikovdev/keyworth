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
