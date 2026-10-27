import { describe, expect, it } from "vitest";
import { MAX_PADDED_BYTES } from "../../../shared/schemas/envelope.ts";
import {
  deviceSlotSchema,
  KDF_LIMITS,
  kdfParamsSchema,
  keySetupSchema,
  recoverySlotSchema,
} from "../../../shared/schemas/keys.ts";
import { RECORD_ID, vaultWriteSchema } from "../../../shared/schemas/vault.ts";
import {
  fromBase64url,
  randomBytes,
  toBase64url,
  utf8,
} from "../../../src/crypto/encoding.ts";
import { decryptRecord, encryptRecord } from "../../../src/crypto/envelope.ts";
import { CryptoError, onAuthFailure } from "../../../src/crypto/errors.ts";
import {
  derivePassphraseKek,
  deriveRecoveryKek,
} from "../../../src/crypto/kdf.ts";
import {
  createKeys,
  resetPassphrase,
  unlockWithDevice,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from "../../../src/crypto/key-slots.ts";
import {
  deviceAad,
  generateDataKey,
  generateDeviceKey,
  keyCheckAad,
  keySlotAad,
  recordAad,
  unwrapDataKey,
  wrapDataKey,
} from "../../../src/crypto/keys.ts";
import { pad, unpad } from "../../../src/crypto/padding.ts";
import { CURRENT_KDF_PARAMS } from "../../../src/crypto/params.ts";
import { generateRecoveryKey } from "../../../src/crypto/recovery-key.ts";
import {
  deviceSlotFromJson,
  deviceSlotToJson,
  keyCheckToJson,
  passphraseSlotToJson,
  recoverySlotFromJson,
  recoverySlotToJson,
} from "../../../src/crypto/serialize.ts";
import { ALICE, FAST_KDF } from "./fixtures.ts";

/*
 * Properties that a mutation of src/crypto could break while every flow test
 * still passes, because encryption and decryption would change together.
 */

const PASSPHRASE = "purple elephant dances at noon";
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

function expectWorkingKey(key: CryptoKey) {
  expect(key.extractable).toBe(false);
  expect(key.usages.toSorted()).toEqual(["decrypt", "encrypt"]);
  expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
}

function expectKek(key: CryptoKey) {
  expect(key.extractable).toBe(false);
  expect(key.usages.toSorted()).toEqual(["unwrapKey", "wrapKey"]);
  expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
}

describe("the working data key", () => {
  it("is non-extractable AES-256 on every path that returns one", async () => {
    const setup = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });
    const remembered = await unlockWithPassphrase({
      userId: ALICE,
      slot: setup.passphraseSlot,
      passphrase: PASSPHRASE,
      remember: true,
    });
    if (!remembered.device) throw new Error("Expected a remembered device");
    const reset = await resetPassphrase({
      userId: ALICE,
      recoverySlot: setup.recoverySlot,
      recoveryKey: setup.recoveryKey,
      newPassphrase: "a brand new passphrase",
      kdf: FAST_KDF,
    });

    for (const key of [
      setup.dataKey,
      remembered.dataKey,
      await unlockWithDevice({ userId: ALICE, ...remembered.device }),
      await unlockWithRecoveryKey({
        userId: ALICE,
        slot: setup.recoverySlot,
        recoveryKey: setup.recoveryKey,
      }),
      reset.dataKey,
    ]) {
      expectWorkingKey(key);
    }
  });
});

describe("key-encryption keys", () => {
  it("are AES-256, non-extractable, wrap and unwrap only", async () => {
    const salt = randomBytes(16);

    expectKek(await derivePassphraseKek(PASSPHRASE, salt, FAST_KDF));
    expectKek(await deriveRecoveryKek(generateRecoveryKey().bytes, salt));
    expectKek(await generateDeviceKey());
  });

  it("refuse a recovery salt that is not 16 bytes", async () => {
    await expect(
      deriveRecoveryKek(generateRecoveryKey().bytes, randomBytes(8)),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});

describe("AADs", () => {
  it("bind the slot kind even under the same key-encryption key", async () => {
    const kek = await generateDeviceKey();
    const wrapped = await wrapDataKey(
      await generateDataKey(),
      kek,
      keySlotAad(ALICE, "recovery"),
    );

    await expect(
      unwrapDataKey(wrapped, kek, keySlotAad(ALICE, "passphrase")),
    ).rejects.toMatchObject({ code: "wrong-secret" });
    await expect(
      unwrapDataKey(wrapped, kek, deviceAad(ALICE)),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });

  it("are distinct for every purpose", () => {
    const aads = [
      keySlotAad(ALICE, "passphrase"),
      keySlotAad(ALICE, "recovery"),
      deviceAad(ALICE),
      keyCheckAad(ALICE),
      recordAad(ALICE, "settings", crypto.randomUUID(), 1),
    ].map(hex);

    expect(new Set(aads).size).toBe(aads.length);
  });

  it("refuse user ids that could make them ambiguous, for every purpose", () => {
    const ambiguous = `${ALICE}|x`;
    for (const build of [
      () => keySlotAad(ambiguous, "passphrase"),
      () => deviceAad(ambiguous),
      () => keyCheckAad(ambiguous),
    ]) {
      expect(build).toThrow(expect.objectContaining({ code: "invalid-input" }));
    }
  });
});

describe("wrapping", () => {
  it("draws a new IV for every wrapping", async () => {
    const kek = await generateDeviceKey();
    const dek = await generateDataKey();

    const a = await wrapDataKey(dek, kek, deviceAad(ALICE));
    const b = await wrapDataKey(dek, kek, deviceAad(ALICE));

    expect(hex(a.iv)).not.toBe(hex(b.iv));
  });

  it("refuses a wrapped key whose IV is not 12 bytes, as a rejected promise", async () => {
    const kek = await generateDeviceKey();
    const wrapped = await wrapDataKey(
      await generateDataKey(),
      kek,
      deviceAad(ALICE),
    );

    await expect(
      unwrapDataKey(
        { ...wrapped, iv: wrapped.iv.slice(0, 8) },
        kek,
        deviceAad(ALICE),
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("reports only an authentication failure as wrong-secret", async () => {
    await expect(
      onAuthFailure(Promise.reject(new TypeError("bug")), "wrong-secret", "x"),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      onAuthFailure(
        Promise.reject(new DOMException("no", "InvalidAccessError")),
        "wrong-secret",
        "x",
      ),
    ).rejects.not.toBeInstanceOf(CryptoError);
  });
});

describe("salts", () => {
  it("are fresh for every slot of every setup", async () => {
    const a = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });
    const b = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });

    const salts = [
      a.passphraseSlot,
      a.recoverySlot,
      b.passphraseSlot,
      b.recoverySlot,
    ].map((slot) => hex(slot.salt));
    expect(new Set(salts).size).toBe(4);
  });
});

describe("records and padding", () => {
  const ref = () =>
    ({
      userId: ALICE,
      kind: "message",
      recordId: crypto.randomUUID(),
      revision: 1,
    }) as const;

  it("round-trips text whose UTF-8 contains the 0x80 marker byte", async () => {
    const key = await generateDataKey();
    const at = ref();
    // "р" is D1 80, "Ѐ" is D0 80, "À" is C3 80.
    const value = { note: "купил 5 LTC вчера по 60$ — Ѐ À 🙂" };

    expect(
      await decryptRecord(key, at, await encryptRecord(key, at, value)),
    ).toEqual(value);
  });

  it.each([
    [255, 256 + 16],
    [256, 512 + 16],
    [511, 512 + 16],
    [512, 1024 + 16],
  ])(
    "pads a %i-byte plaintext into the right bucket and back",
    async (length, ciphertextBytes) => {
      const key = await generateDataKey();
      const at = ref();
      // {"note":"…"} adds 11 bytes around the note.
      const note = "a".repeat(length - 11);

      const envelope = await encryptRecord(key, at, { note });

      expect(fromBase64url(envelope.ct)).toHaveLength(ciphertextBytes);
      expect(await decryptRecord(key, at, envelope)).toEqual({ note });
    },
  );

  it("accepts exactly one byte less than the largest bucket", () => {
    expect(pad(new Uint8Array(MAX_PADDED_BYTES - 1))).toHaveLength(
      MAX_PADDED_BYTES,
    );
    expect(() => pad(new Uint8Array(MAX_PADDED_BYTES))).toThrow(
      expect.objectContaining({ code: "invalid-input" }),
    );
  });

  it("refuses padding without the 0x80 marker", () => {
    for (const block of [
      new Uint8Array(256),
      Uint8Array.from([0x41, 0x01, 0, 0]),
      Uint8Array.from([0x41, 0x80, 0x01]),
    ]) {
      expect(() => unpad(block)).toThrow(
        expect.objectContaining({ code: "tampered" }),
      );
    }
  });

  it("reports a record whose plaintext is not valid UTF-8 as tampered", async () => {
    const key = await generateDataKey();
    const at = ref();
    const iv = randomBytes(12);
    const bytes = Uint8Array.from([...utf8('{"a":"'), 0xff, ...utf8('"}')]);
    const ct = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: recordAad(at.userId, at.kind, at.recordId, 1),
      },
      key,
      pad(bytes),
    );
    const envelope = {
      v: 1,
      alg: "A256GCM",
      iv: toBase64url(iv),
      ct: toBase64url(new Uint8Array(ct)),
    };

    await expect(decryptRecord(key, at, envelope)).rejects.toMatchObject({
      code: "tampered",
    });
  });
});

describe("Argon2 settings", () => {
  it("are RFC 9106's second option in production", () => {
    expect(CURRENT_KDF_PARAMS).toEqual({
      alg: "argon2id",
      version: 19,
      memoryKiB: 65536,
      passes: 3,
      parallelism: 1,
    });
  });

  it("are bounded by the documented limits", () => {
    expect(KDF_LIMITS).toEqual({
      minMemoryKiB: 19456,
      maxMemoryKiB: 262144,
      minPasses: 2,
      maxPasses: 10,
      maxParallelism: 4,
    });
    const ok = (change: object) =>
      kdfParamsSchema.safeParse({ ...CURRENT_KDF_PARAMS, ...change }).success;
    expect([ok({ memoryKiB: 19455 }), ok({ memoryKiB: 19456 })]).toEqual([
      false,
      true,
    ]);
    expect([ok({ memoryKiB: 262144 }), ok({ memoryKiB: 262145 })]).toEqual([
      true,
      false,
    ]);
    expect([ok({ passes: 1 }), ok({ passes: 10 }), ok({ passes: 11 })]).toEqual(
      [false, true, false],
    );
    expect([
      ok({ parallelism: 0 }),
      ok({ parallelism: 4 }),
      ok({ parallelism: 5 }),
    ]).toEqual([false, true, false]);
  });
});

describe("recovery and device slots from the server", () => {
  it("are refused when malformed", async () => {
    const setup = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });
    const remembered = await unlockWithPassphrase({
      userId: ALICE,
      slot: setup.passphraseSlot,
      passphrase: PASSPHRASE,
      remember: true,
    });
    if (!remembered.device) throw new Error("Expected a remembered device");
    const recovery = recoverySlotToJson(setup.recoverySlot);
    const device = deviceSlotToJson(remembered.device.deviceSlot);

    for (const bad of [
      null,
      { ...recovery, extra: true },
      { ...recovery, iv: recovery.iv.slice(4) },
      { ...recovery, wrappedKey: `${recovery.wrappedKey}AA` },
      { ...recovery, salt: undefined },
    ]) {
      expect(() => recoverySlotFromJson(bad)).toThrow(
        expect.objectContaining({ code: "invalid-input" }),
      );
    }
    for (const bad of [
      null,
      { ...device, extra: true },
      { ...device, iv: device.iv.slice(4) },
      { ...device, wrappedKey: device.wrappedKey.slice(4) },
    ]) {
      expect(() => deviceSlotFromJson(bad)).toThrow(
        expect.objectContaining({ code: "invalid-input" }),
      );
    }
    expect(recoverySlotSchema.safeParse({ ...recovery, kdf: {} }).success).toBe(
      false,
    );
    expect(
      deviceSlotSchema.safeParse({ ...device, salt: recovery.salt }).success,
    ).toBe(false);
  });
});

describe("request schemas", () => {
  it("refuse extra fields, negative revisions and non-canonical record ids", async () => {
    const setup = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });
    const id = crypto.randomUUID();
    const envelope = await encryptRecord(
      await generateDataKey(),
      { userId: ALICE, kind: "settings", recordId: id, revision: 1 },
      {},
    );
    const write = { kind: "settings", revision: 0, envelope };
    const setupBody = {
      passphrase: passphraseSlotToJson(setup.passphraseSlot),
      recovery: recoverySlotToJson(setup.recoverySlot),
      check: keyCheckToJson(setup.keyCheck),
    };

    expect(vaultWriteSchema.safeParse(write).success).toBe(true);
    expect(vaultWriteSchema.safeParse({ ...write, note: "x" }).success).toBe(
      false,
    );
    expect(vaultWriteSchema.safeParse({ ...write, revision: -1 }).success).toBe(
      false,
    );
    expect(RECORD_ID.test(id.toUpperCase())).toBe(false);
    expect(RECORD_ID.test("6f1c2a3e-4b5d-1c6e-8f70-0a1b2c3d4e5f")).toBe(false);
    expect(keySetupSchema.safeParse(setupBody).success).toBe(true);
    expect(keySetupSchema.safeParse({ ...setupBody, extra: 1 }).success).toBe(
      false,
    );
    expect(
      keySetupSchema.safeParse({ ...setupBody, check: undefined }).success,
    ).toBe(false);
  });
});
