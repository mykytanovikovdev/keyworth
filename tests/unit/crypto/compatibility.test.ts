import { argon2Sync, createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromBase64url } from "../../../src/crypto/encoding.ts";
import { decryptRecord, encryptRecord } from "../../../src/crypto/envelope.ts";
import {
  createKeys,
  unlockWithDevice,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from "../../../src/crypto/key-slots.ts";
import { verifyKeyCheck } from "../../../src/crypto/keys.ts";
import { formatRecoveryKey } from "../../../src/crypto/recovery-key.ts";
import {
  deviceSlotFromJson,
  keyCheckFromJson,
  passphraseSlotFromJson,
  recoverySlotFromJson,
} from "../../../src/crypto/serialize.ts";
import { ALICE, FAST_KDF } from "./fixtures.ts";

/*
 * Compatibility ("golden") vectors. Data written today must stay readable, so
 * these bytes were made once, independently of src/crypto, with node:crypto
 * (AES-256-GCM, HKDF-SHA-256, Argon2id, SHA-256) from the formats in
 * src/crypto/docs. If one of these tests fails, a change broke the wire
 * format, an AAD, a KDF input, passphrase normalization or the recovery-key
 * text: existing users would lose access. Never regenerate them to make a test
 * pass; a format change needs a new version that reads the old one.
 *
 * Inputs: data key 00..1f; record IV 10..1b; passphrase salt 20..2f, IV
 * 30..3b; recovery key bytes 40..53, salt 60..6f, IV 70..7b; device key
 * 80..9f, IV a0..ab; check value IV b0..bb.
 */
const RECORD = {
  ref: {
    userId: ALICE,
    kind: "transaction",
    recordId: "6f1c2a3e-4b5d-4c6e-8f70-0a1b2c3d4e5f",
    revision: 3,
  },
  // Cyrillic on purpose: "р" is D1 80 in UTF-8, the padding marker's byte.
  value: { note: "купил 5 LTC вчера по 60$", quantity: "5", price: "60.03" },
  envelope: {
    v: 1,
    alg: "A256GCM",
    iv: "EBESExQVFhcYGRob",
    ct: "Btz2eT2sGInopbLMjKnWg2-A9S4u4hvlpNky1Y_ThG6BaYez1XbRP8AWpGGuuj85YskmHZfiLYueJBgE0buGG3eRXEZrhCkCXa4Fzfq8aL49uZKtZp1SOoDwIB_uhOMVfAdOtrKqe5FuCdFzbH3SklXK6Cbov_n_tv7b43-y-Budw8QmduLB43e3htO8yUR_ryNoXVbZy-Cu1EqNjPXtK8TXj02O-JGh-3IRu5E4YULpa7aj6yC0ZP6jthrzletLPtxdT_v3n_KyArkmUhILm4ikD1h3rk6kagjY9HLF-dap71A8TG6xbyYh4KJOm_s0fu616w1HQMDoHfffERXB1v6X4qtY626eksL3_kY_D2M",
  },
} as const;
// Typed with a no-break space and spaces at the ends; derived from
// "Correct horse battery staple, 42!". Settings above the minimum on purpose,
// so that memory, passes and lanes are all pinned.
const PASSPHRASE = "  Correct horse battery staple, 42! ";
const PASSPHRASE_SLOT = {
  v: 1,
  kdf: {
    alg: "argon2id",
    version: 19,
    memoryKiB: 20480,
    passes: 3,
    parallelism: 2,
  },
  salt: "ICEiIyQlJicoKSorLC0uLw",
  iv: "MDEyMzQ1Njc4OTo7",
  wrappedKey:
    "dH7a0OGPQHducSdZhSTO7DGaFYnrwCKwbk6co-vUAC8EI-fnxNf6WAZWX5bHeEjZ",
};
// A public test vector (bytes 40..53), not a credential.
const RECOVERY_KEY = "810M-4GT4-8N34-EJ29-995M-RKAE-9X85-2MJK-99VN"; // gitleaks:allow
const RECOVERY_SLOT = {
  v: 1,
  salt: "YGFiY2RlZmdoaWprbG1ubw",
  iv: "cHFyc3R1dnd4eXp7",
  wrappedKey:
    "Bln0pihLz_MrtSSAgzhVLFWI9hzbgONQOlYr_m-dbxZKXMUf0iMazL4gOzZa7bfp",
};
const DEVICE_SLOT = {
  iv: "oKGio6Slpqeoqaqr",
  wrappedKey:
    "AA5yM1illTd2Zgy9iAyEib07FKI7nZQ62LmcIBzLz8NkS2RtGA6o0zLK0WosvE82",
};
const KEY_CHECK = {
  v: 1,
  iv: "sLGys7S1tre4ubq7",
  tag: "znm1_E5oyl_WoOmbyBmJyQ",
};

const DATA_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const DEVICE_KEY = Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i);

function importDataKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", DATA_KEY, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Opens what src/crypto wrote with node:crypto and a literal AAD string. */
function nodeDecrypt(key: Uint8Array, iv: string, data: string, aad: string) {
  const bytes = fromBase64url(data);
  const decipher = createDecipheriv("aes-256-gcm", key, fromBase64url(iv));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([
    decipher.update(bytes.subarray(0, -16)),
    decipher.final(),
  ]);
}

describe("data written in this format stays readable", () => {
  it("a record decrypts to the same value", async () => {
    expect(
      await decryptRecord(await importDataKey(), RECORD.ref, RECORD.envelope),
    ).toEqual(RECORD.value);
  });

  it("the passphrase slot opens with the passphrase as typed", async () => {
    const { dataKey } = await unlockWithPassphrase({
      userId: ALICE,
      slot: passphraseSlotFromJson(PASSPHRASE_SLOT),
      passphrase: PASSPHRASE,
    });

    expect(await decryptRecord(dataKey, RECORD.ref, RECORD.envelope)).toEqual(
      RECORD.value,
    );
  });

  it("the recovery slot opens with the recovery key, typed sloppily too", async () => {
    for (const typed of [
      RECOVERY_KEY,
      RECOVERY_KEY.toLowerCase().replaceAll("-", " "),
    ]) {
      const dataKey = await unlockWithRecoveryKey({
        userId: ALICE,
        slot: recoverySlotFromJson(RECOVERY_SLOT),
        recoveryKey: typed,
      });
      expect(await decryptRecord(dataKey, RECORD.ref, RECORD.envelope)).toEqual(
        RECORD.value,
      );
    }
  });

  it("the recovery key's bytes still format to the text the user wrote down", () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => 0x40 + i);

    expect(formatRecoveryKey(bytes)).toBe(RECOVERY_KEY);
  });

  it("the device slot opens with the device key", async () => {
    const deviceKey = await crypto.subtle.importKey(
      "raw",
      DEVICE_KEY,
      "AES-GCM",
      false,
      ["wrapKey", "unwrapKey"],
    );
    const dataKey = await unlockWithDevice({
      userId: ALICE,
      deviceKey,
      deviceSlot: deviceSlotFromJson(DEVICE_SLOT),
    });

    expect(await decryptRecord(dataKey, RECORD.ref, RECORD.envelope)).toEqual(
      RECORD.value,
    );
  });

  it("the check value passes with the data key", async () => {
    await expect(
      verifyKeyCheck(await importDataKey(), ALICE, keyCheckFromJson(KEY_CHECK)),
    ).resolves.toBe(undefined);
  });
});

describe("what src/crypto writes, an independent implementation can read", () => {
  it("records: AES-256-GCM, the literal AAD, 0x80 padding, JSON", async () => {
    const ref = { ...RECORD.ref, revision: 7 };
    const envelope = await encryptRecord(
      await importDataKey(),
      ref,
      RECORD.value,
    );

    const padded = nodeDecrypt(
      DATA_KEY,
      envelope.iv,
      envelope.ct,
      `record|${ALICE}|transaction|${ref.recordId}|7|1`,
    );
    const end = padded.lastIndexOf(0x80);

    expect(padded).toHaveLength(256);
    expect(padded.subarray(end + 1).every((byte) => byte === 0)).toBe(true);
    expect(JSON.parse(padded.subarray(0, end).toString("utf8"))).toEqual(
      RECORD.value,
    );
  });

  it("slots and the check value: Argon2id and AES-GCM with their AADs", async () => {
    const keys = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
      kdf: FAST_KDF,
    });
    const slot = keys.passphraseSlot;
    const kek = argon2Sync("argon2id", {
      message: Buffer.from("Correct horse battery staple, 42!"),
      nonce: Buffer.from(slot.salt),
      memory: FAST_KDF.memoryKiB,
      passes: FAST_KDF.passes,
      parallelism: FAST_KDF.parallelism,
      tagLength: 32,
    });

    const dataKey = nodeDecrypt(
      kek,
      Buffer.from(slot.iv).toString("base64url"),
      Buffer.from(slot.wrappedKey).toString("base64url"),
      `key-slot|${ALICE}|passphrase|1`,
    );
    const check = nodeDecrypt(
      dataKey,
      Buffer.from(keys.keyCheck.iv).toString("base64url"),
      Buffer.from(keys.keyCheck.tag).toString("base64url"),
      `key-check|${ALICE}|1`,
    );

    expect(dataKey).toHaveLength(32);
    expect(check).toHaveLength(0);
  });
});
