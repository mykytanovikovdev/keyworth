import { describe, expect, it } from "vitest";
import {
  decodeBase64url,
  encodeBase64url,
} from "../../../shared/schemas/base64url.ts";
import {
  createKeys,
  unlockWithPassphrase,
} from "../../../src/crypto/key-slots.ts";
import {
  deviceSlotFromJson,
  deviceSlotToJson,
  keyCheckFromJson,
  keyCheckToJson,
  passphraseSlotFromJson,
  passphraseSlotToJson,
  recoverySlotFromJson,
  recoverySlotToJson,
} from "../../../src/crypto/serialize.ts";
import { ALICE, FAST_KDF } from "./fixtures.ts";

const PASSPHRASE = "purple elephant dances at noon";

describe("key slots as JSON", () => {
  it("round-trip without losing a byte", async () => {
    const { passphraseSlot, recoverySlot, keyCheck } = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });
    const { device } = await unlockWithPassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      passphrase: PASSPHRASE,
      remember: true,
    });
    if (!device) throw new Error("Expected a remembered device");

    expect(
      passphraseSlotFromJson(passphraseSlotToJson(passphraseSlot)),
    ).toEqual(passphraseSlot);
    expect(recoverySlotFromJson(recoverySlotToJson(recoverySlot))).toEqual(
      recoverySlot,
    );
    expect(deviceSlotFromJson(deviceSlotToJson(device.deviceSlot))).toEqual(
      device.deviceSlot,
    );
    expect(keyCheckFromJson(keyCheckToJson(keyCheck))).toEqual(keyCheck);
  });

  it("carry their format version", async () => {
    const { passphraseSlot, recoverySlot, keyCheck } = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });

    expect(passphraseSlotToJson(passphraseSlot).v).toBe(1);
    expect(recoverySlotToJson(recoverySlot).v).toBe(1);
    expect(keyCheckToJson(keyCheck).v).toBe(1);
    for (const parse of [
      () => recoverySlotFromJson({ ...recoverySlotToJson(recoverySlot), v: 2 }),
      () => keyCheckFromJson({ ...keyCheckToJson(keyCheck), v: undefined }),
    ]) {
      expect(parse).toThrow(expect.objectContaining({ code: "invalid-input" }));
    }
  });

  it("refuse anything a server should not have sent", async () => {
    const { passphraseSlot } = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });
    const json = passphraseSlotToJson(passphraseSlot);

    for (const bad of [
      null,
      { ...json, salt: json.salt.slice(1) },
      { ...json, wrappedKey: `${json.wrappedKey}AA` },
      { ...json, kdf: { ...json.kdf, memoryKiB: 1024 } },
      { ...json, kdf: { ...json.kdf, memoryKiB: 4 * 1024 * 1024 } },
      { ...json, extra: true },
      { ...json, v: 2 },
    ]) {
      expect(() => passphraseSlotFromJson(bad)).toThrow(
        expect.objectContaining({ code: "invalid-input" }),
      );
    }
  });
});

describe("base64url", () => {
  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);

    expect(decodeBase64url(encodeBase64url(bytes))).toEqual(bytes);
    expect(encodeBase64url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each(["a", "abcde", "ab+c", "ab/c", "ab=="])("rejects %s", (text) => {
    expect(decodeBase64url(text)).toBeNull();
  });
});
