import { describe, expect, it } from "vitest";
import { envelopeSchema } from "../../shared/schemas/envelope.ts";
import { KDF_LIMITS, kdfParamsSchema } from "../../shared/schemas/keys.ts";
import { recordKindSchema } from "../../shared/schemas/vault.ts";

// Base64url lengths: 12-byte IV → 16 characters; 256-byte bucket + tag → 363.
const valid = {
  v: 1,
  alg: "A256GCM",
  iv: "A".repeat(16),
  ct: "A".repeat(363),
};

describe("envelopeSchema", () => {
  it("accepts a well-formed envelope", () => {
    expect(envelopeSchema.safeParse(valid).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["another version", { v: 2 }],
    ["another algorithm", { alg: "A128GCM" }],
    ["an IV that is not 12 bytes", { iv: "A".repeat(15) }],
    [
      "a ciphertext that is not a padding bucket plus the tag",
      { ct: "A".repeat(362) },
    ],
    ["characters outside base64url", { ct: `${"A".repeat(362)}+` }],
    ["an extra field", { note: "plaintext" }],
  ])("rejects %s", (_, change) => {
    expect(envelopeSchema.safeParse({ ...valid, ...change }).success).toBe(
      false,
    );
  });

  it("accepts every bucket up to 64 KiB and nothing larger", () => {
    const lengthOf = (bytes: number) => Math.ceil((bytes * 4) / 3);
    for (let size = 256; size <= 64 * 1024; size *= 2) {
      expect(
        envelopeSchema.safeParse({
          ...valid,
          ct: "A".repeat(lengthOf(size + 16)),
        }).success,
      ).toBe(true);
    }
    expect(
      envelopeSchema.safeParse({
        ...valid,
        ct: "A".repeat(lengthOf(128 * 1024 + 16)),
      }).success,
    ).toBe(false);
  });
});

describe("kdfParamsSchema", () => {
  const params = {
    alg: "argon2id",
    version: 19,
    memoryKiB: 65536,
    passes: 3,
    parallelism: 1,
  };

  it("accepts the production settings", () => {
    expect(kdfParamsSchema.safeParse(params).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["another algorithm", { alg: "argon2i" }],
    ["another version", { version: 16 }],
    [
      "less memory than OWASP's minimum",
      { memoryKiB: KDF_LIMITS.minMemoryKiB - 1 },
    ],
    [
      "more memory than a page should take",
      { memoryKiB: KDF_LIMITS.maxMemoryKiB + 1 },
    ],
    ["one pass", { passes: 1 }],
    ["a string number", { passes: "3" }],
    ["an extra field", { salt: "x" }],
  ])("rejects %s", (_, change) => {
    expect(kdfParamsSchema.safeParse({ ...params, ...change }).success).toBe(
      false,
    );
  });
});

describe("recordKindSchema", () => {
  it("knows the planned kinds and nothing else", () => {
    for (const kind of [
      "settings",
      "transaction",
      "conversation",
      "message",
      "alert",
    ]) {
      expect(recordKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(recordKindSchema.safeParse("password").success).toBe(false);
  });
});
