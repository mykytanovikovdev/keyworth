import { argon2Sync } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2.js";
import { describe, expect, it } from "vitest";
import { KDF_LIMITS } from "../../../shared/schemas/keys.ts";
import { randomBytes, utf8 } from "../../../src/crypto/encoding.ts";
import { derivePassphraseKek } from "../../../src/crypto/kdf.ts";
import {
  generateDataKey,
  unwrapDataKey,
  wrapDataKey,
} from "../../../src/crypto/keys.ts";
import {
  CURRENT_KDF_PARAMS,
  type KdfParams,
} from "../../../src/crypto/params.ts";
import { FAST_KDF } from "./fixtures.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const filled = (length: number, byte: number) =>
  new Uint8Array(length).fill(byte);
const aad = utf8("test");

/** True when both keys are the same AES key: one opens what the other wrapped. */
async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const wrapped = await wrapDataKey(await generateDataKey(), a, aad);
  return unwrapDataKey(wrapped, b, aad).then(
    () => true,
    () => false,
  );
}

describe("Argon2id from @noble/hashes", () => {
  it("matches the RFC 9106 Argon2id test vector", () => {
    const tag = argon2id(filled(32, 1), filled(16, 2), {
      t: 3,
      m: 32,
      p: 4,
      dkLen: 32,
      key: filled(8, 3),
      personalization: filled(12, 4),
    });

    expect(hex(tag)).toBe(
      "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
    );
  });

  it("matches Node's native Argon2id (OpenSSL) with the production settings", () => {
    const password = utf8("correct horse battery staple");
    const salt = randomBytes(16);

    const noble = argon2id(password, salt, {
      t: CURRENT_KDF_PARAMS.passes,
      m: CURRENT_KDF_PARAMS.memoryKiB,
      p: CURRENT_KDF_PARAMS.parallelism,
      dkLen: 32,
    });
    const native = argon2Sync("argon2id", {
      message: password,
      nonce: salt,
      memory: CURRENT_KDF_PARAMS.memoryKiB,
      passes: CURRENT_KDF_PARAMS.passes,
      parallelism: CURRENT_KDF_PARAMS.parallelism,
      tagLength: 32,
    });

    expect(hex(noble)).toBe(hex(native));
  }, 30_000);
});

describe("derivePassphraseKek", () => {
  it("derives the same key from the same passphrase and salt", async () => {
    const salt = randomBytes(16);

    const a = await derivePassphraseKek(
      "purple elephant dances",
      salt,
      FAST_KDF,
    );
    const b = await derivePassphraseKek(
      "purple elephant dances",
      salt,
      FAST_KDF,
    );

    expect(await sameKey(a, b)).toBe(true);
  });

  it("derives different keys for another passphrase or another salt", async () => {
    const salt = randomBytes(16);
    const base = await derivePassphraseKek(
      "purple elephant dances",
      salt,
      FAST_KDF,
    );

    const otherPassphrase = await derivePassphraseKek(
      "purple elephant dance",
      salt,
      FAST_KDF,
    );
    const otherSalt = await derivePassphraseKek(
      "purple elephant dances",
      randomBytes(16),
      FAST_KDF,
    );

    expect(await sameKey(base, otherPassphrase)).toBe(false);
    expect(await sameKey(base, otherSalt)).toBe(false);
  });

  it("treats the forms one plain-Latin passphrase can be typed in as the same", async () => {
    const salt = randomBytes(16);
    const plain = await derivePassphraseKek(
      "purple elephant dances",
      salt,
      FAST_KDF,
    );
    const typed = [
      // Option+Space on a Mac types a no-break space.
      "purple\u00a0elephant\u00a0dances",
      // East Asian input methods: an ideographic space and full-width letters.
      "purple\u3000elephant dances",
      "ｐｕｒｐｌｅ elephant dances",
      "purple\telephant dances",
      "  purple elephant dances ",
    ];

    for (const passphrase of typed) {
      const kek = await derivePassphraseKek(passphrase, salt, FAST_KDF);
      expect(await sameKey(plain, kek), JSON.stringify(passphrase)).toBe(true);
    }
  });

  it("keeps case and the spaces inside the passphrase", async () => {
    const salt = randomBytes(16);
    const base = await derivePassphraseKek("purple elephant", salt, FAST_KDF);
    const capital = await derivePassphraseKek(
      "Purple elephant",
      salt,
      FAST_KDF,
    );
    const doubled = await derivePassphraseKek(
      "purple  elephant",
      salt,
      FAST_KDF,
    );

    expect(await sameKey(base, capital)).toBe(false);
    expect(await sameKey(base, doubled)).toBe(false);
  });

  it.each([
    ["an accented letter", "café au lait, s'il vous plaît"],
    ["a Spanish letter", "mañana por la mañana"],
    ["a Cyrillic layout", "фиолетовый слон танцует"],
    ["a Cyrillic look-alike", "purple elephant dаnces"],
    ["an emoji", "purple elephant dances 🐘"],
    ["an invisible character", "purple\u200belephant dances"],
  ])(
    "refuses %s before Argon2 runs",
    async (_, passphrase) => {
      await expect(
        derivePassphraseKek(passphrase, randomBytes(16), CURRENT_KDF_PARAMS),
      ).rejects.toMatchObject({ code: "not-latin" });
    },
    // Production settings would take a second: refusing must not run them.
    200,
  );

  it("is a non-extractable key that can only wrap and unwrap", async () => {
    const kek = await derivePassphraseKek(
      "purple elephant dances",
      randomBytes(16),
      FAST_KDF,
    );

    expect(kek.extractable).toBe(false);
    expect(kek.usages.toSorted()).toEqual(["unwrapKey", "wrapKey"]);
    await expect(crypto.subtle.exportKey("raw", kek)).rejects.toThrow();
  });

  it("reports progress up to completion", async () => {
    const progress: number[] = [];

    await derivePassphraseKek(
      "purple elephant dances",
      randomBytes(16),
      FAST_KDF,
      (f) => progress.push(f),
    );

    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(1);
  });

  it.each<[string, Partial<KdfParams>]>([
    [
      "below OWASP's memory minimum",
      { memoryKiB: KDF_LIMITS.minMemoryKiB - 1 },
    ],
    ["below OWASP's pass minimum", { passes: 1 }],
    [
      "more memory than a page should take",
      { memoryKiB: KDF_LIMITS.maxMemoryKiB + 1 },
    ],
    ["too many passes", { passes: KDF_LIMITS.maxPasses + 1 }],
    ["fractional values", { memoryKiB: 20_000.5 }],
  ])("refuses settings %s", async (_, change) => {
    await expect(
      derivePassphraseKek("purple elephant dances", randomBytes(16), {
        ...FAST_KDF,
        ...change,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("refuses a salt that is not 16 bytes", async () => {
    await expect(
      derivePassphraseKek("purple elephant dances", randomBytes(8), FAST_KDF),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});
