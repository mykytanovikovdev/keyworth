import { describe, expect, it } from "vitest";
import { decryptRecord, encryptRecord } from "../../../src/crypto/envelope.ts";
import {
  changePassphrase,
  createKeys,
  replaceRecoveryKey,
  resetPassphrase,
  unlockWithDevice,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from "../../../src/crypto/key-slots.ts";
import { CURRENT_KDF_PARAMS } from "../../../src/crypto/params.ts";
import { ALICE, BOB, FAST_KDF } from "./fixtures.ts";

const PASSPHRASE = "purple elephant dances at noon";
const record = {
  userId: ALICE,
  kind: "settings",
  recordId: crypto.randomUUID(),
} as const;

function setUp() {
  return createKeys({ userId: ALICE, passphrase: PASSPHRASE, kdf: FAST_KDF });
}

/** The data key opened by some path still reads what the original encrypted. */
async function opensSameData(original: CryptoKey, other: CryptoKey) {
  const envelope = await encryptRecord(original, record, {
    baseCurrency: "EUR",
  });
  return decryptRecord(other, record, envelope);
}

describe("setting up keys", () => {
  it("returns a data key that encrypts but can never be exported", async () => {
    const { dataKey } = await setUp();

    expect(dataKey.extractable).toBe(false);
    expect(dataKey.usages.toSorted()).toEqual(["decrypt", "encrypt"]);
    await expect(crypto.subtle.exportKey("raw", dataKey)).rejects.toThrow();
  });

  it("stores the settings it used and a fresh salt in the passphrase slot", async () => {
    const { passphraseSlot, recoverySlot } = await setUp();

    expect(passphraseSlot.kdf).toEqual(FAST_KDF);
    expect(passphraseSlot.salt).toHaveLength(16);
    expect(passphraseSlot.iv).toHaveLength(12);
    // 32 key bytes plus the 16-byte GCM tag.
    expect(passphraseSlot.wrappedKey).toHaveLength(48);
    expect(recoverySlot.salt).not.toEqual(passphraseSlot.salt);
  });

  it("uses the approved production settings by default", async () => {
    const { passphraseSlot, dataKey } = await createKeys({
      userId: ALICE,
      passphrase: PASSPHRASE,
    });

    expect(passphraseSlot.kdf).toEqual(CURRENT_KDF_PARAMS);
    const { dataKey: unlocked } = await unlockWithPassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      passphrase: PASSPHRASE,
    });
    expect(await opensSameData(dataKey, unlocked)).toEqual({
      baseCurrency: "EUR",
    });
  }, 30_000);

  it.each([
    ["too short", "eleven char", "invalid-input"],
    ["only spaces", " ".repeat(16), "invalid-input"],
    ["not plain Latin", "mañana por la mañana", "not-latin"],
  ])(
    "refuses a new passphrase that is %s, in every flow that sets one",
    async (_, passphrase, code) => {
      const { passphraseSlot, recoverySlot, recoveryKey } = await setUp();

      await expect(
        createKeys({ userId: ALICE, passphrase, kdf: FAST_KDF }),
      ).rejects.toMatchObject({ code });
      await expect(
        changePassphrase({
          userId: ALICE,
          slot: passphraseSlot,
          currentPassphrase: PASSPHRASE,
          newPassphrase: passphrase,
          kdf: FAST_KDF,
        }),
      ).rejects.toMatchObject({ code });
      await expect(
        resetPassphrase({
          userId: ALICE,
          recoverySlot,
          recoveryKey,
          newPassphrase: passphrase,
          kdf: FAST_KDF,
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("gives a recovery key in eight groups of four", async () => {
    const { recoveryKey } = await setUp();

    expect(recoveryKey).toMatch(
      /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/,
    );
  });
});

describe("unlocking with the passphrase", () => {
  it("opens the same data key", async () => {
    const { dataKey, passphraseSlot } = await setUp();

    const { dataKey: unlocked } = await unlockWithPassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      passphrase: PASSPHRASE,
    });

    expect(await opensSameData(dataKey, unlocked)).toEqual({
      baseCurrency: "EUR",
    });
    expect(unlocked.extractable).toBe(false);
  });

  it("fails with wrong-secret for a wrong passphrase", async () => {
    const { passphraseSlot } = await setUp();

    await expect(
      unlockWithPassphrase({
        userId: ALICE,
        slot: passphraseSlot,
        passphrase: "purple elephant dances at night",
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });

  it("does not open another user's slot, even with the right passphrase", async () => {
    const { passphraseSlot } = await setUp();

    await expect(
      unlockWithPassphrase({
        userId: BOB,
        slot: passphraseSlot,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });

  it("does not accept a recovery wrapping passed off as a passphrase wrapping", async () => {
    const { passphraseSlot, recoverySlot } = await setUp();

    await expect(
      unlockWithPassphrase({
        userId: ALICE,
        slot: {
          ...passphraseSlot,
          iv: recoverySlot.iv,
          wrappedKey: recoverySlot.wrappedKey,
        },
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });

  it("refuses stored settings below OWASP's minimum before deriving anything", async () => {
    const { passphraseSlot } = await setUp();

    await expect(
      unlockWithPassphrase({
        userId: ALICE,
        slot: { ...passphraseSlot, kdf: { ...passphraseSlot.kdf, passes: 1 } },
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});

describe("unlocking with the recovery key", () => {
  it("opens the same data key, however the key is typed", async () => {
    const { dataKey, recoverySlot, recoveryKey } = await setUp();
    const typed = recoveryKey
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/0/g, "o");

    const unlocked = await unlockWithRecoveryKey({
      userId: ALICE,
      slot: recoverySlot,
      recoveryKey: typed,
    });

    expect(await opensSameData(dataKey, unlocked)).toEqual({
      baseCurrency: "EUR",
    });
  });

  it("fails with wrong-secret for another valid-looking key", async () => {
    const { recoverySlot } = await setUp();
    const { recoveryKey: someoneElses } = await setUp();

    await expect(
      unlockWithRecoveryKey({
        userId: ALICE,
        slot: recoverySlot,
        recoveryKey: someoneElses,
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });

  it("fails with invalid-input for text that cannot be a recovery key", async () => {
    const { recoverySlot } = await setUp();

    await expect(
      unlockWithRecoveryKey({
        userId: ALICE,
        slot: recoverySlot,
        recoveryKey: "UUUU-1234",
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});

describe("changing the passphrase", () => {
  it("keeps the same data key, so no record needs re-encrypting", async () => {
    const { dataKey, passphraseSlot } = await setUp();

    const next = await changePassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      currentPassphrase: PASSPHRASE,
      newPassphrase: "a completely different phrase",
      kdf: FAST_KDF,
    });
    const { dataKey: unlocked } = await unlockWithPassphrase({
      userId: ALICE,
      slot: next,
      passphrase: "a completely different phrase",
    });

    expect(await opensSameData(dataKey, unlocked)).toEqual({
      baseCurrency: "EUR",
    });
    await expect(
      unlockWithPassphrase({
        userId: ALICE,
        slot: next,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });

  it("requires the current passphrase", async () => {
    const { passphraseSlot } = await setUp();

    await expect(
      changePassphrase({
        userId: ALICE,
        slot: passphraseSlot,
        currentPassphrase: "not the passphrase at all",
        newPassphrase: "a completely different phrase",
        kdf: FAST_KDF,
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });

  it("can rewrap with newer settings and the same passphrase", async () => {
    const { passphraseSlot } = await setUp();
    const stronger = { ...FAST_KDF, passes: FAST_KDF.passes + 1 };

    const upgraded = await changePassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      currentPassphrase: PASSPHRASE,
      newPassphrase: PASSPHRASE,
      kdf: stronger,
    });

    expect(upgraded.kdf).toEqual(stronger);
    expect(upgraded.salt).not.toEqual(passphraseSlot.salt);
  });

  it("reports one progress run across both derivations", async () => {
    const { passphraseSlot } = await setUp();
    const progress: number[] = [];

    await changePassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      currentPassphrase: PASSPHRASE,
      newPassphrase: "a completely different phrase",
      kdf: FAST_KDF,
      onProgress: (f) => progress.push(f),
    });

    expect(progress).toEqual(progress.toSorted((a, b) => a - b));
    expect(progress.at(0)).toBeLessThan(0.5);
    expect(progress.at(-1)).toBe(1);
  });
});

describe("replacing the recovery key", () => {
  it("issues a new key that works, and the old one no longer opens the new slot", async () => {
    const { dataKey, passphraseSlot, recoveryKey: oldKey } = await setUp();

    const { recoverySlot, recoveryKey } = await replaceRecoveryKey({
      userId: ALICE,
      passphraseSlot,
      passphrase: PASSPHRASE,
    });

    expect(recoveryKey).not.toBe(oldKey);
    const unlocked = await unlockWithRecoveryKey({
      userId: ALICE,
      slot: recoverySlot,
      recoveryKey,
    });
    expect(await opensSameData(dataKey, unlocked)).toEqual({
      baseCurrency: "EUR",
    });
    await expect(
      unlockWithRecoveryKey({
        userId: ALICE,
        slot: recoverySlot,
        recoveryKey: oldKey,
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
  });
});

describe("resetting a forgotten passphrase", () => {
  it("opens the data key with the recovery key and wraps it with a new passphrase", async () => {
    const { dataKey, recoverySlot, recoveryKey } = await setUp();

    const reset = await resetPassphrase({
      userId: ALICE,
      recoverySlot,
      recoveryKey,
      newPassphrase: "a brand new passphrase",
      kdf: FAST_KDF,
    });
    const { dataKey: unlocked } = await unlockWithPassphrase({
      userId: ALICE,
      slot: reset.passphraseSlot,
      passphrase: "a brand new passphrase",
    });

    expect(await opensSameData(dataKey, reset.dataKey)).toEqual({
      baseCurrency: "EUR",
    });
    expect(await opensSameData(dataKey, unlocked)).toEqual({
      baseCurrency: "EUR",
    });
  });
});

describe("remembering a device", () => {
  it("opens the data key with the device key alone, with no passphrase", async () => {
    const { dataKey, passphraseSlot } = await setUp();

    const { device } = await unlockWithPassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      passphrase: PASSPHRASE,
      remember: true,
    });
    if (!device) throw new Error("Expected a remembered device");
    const unlocked = await unlockWithDevice({ userId: ALICE, ...device });

    expect(device.deviceKey.extractable).toBe(false);
    expect(await opensSameData(dataKey, unlocked)).toEqual({
      baseCurrency: "EUR",
    });
  });

  it("does not remember the device unless asked", async () => {
    const { passphraseSlot } = await setUp();

    const result = await unlockWithPassphrase({
      userId: ALICE,
      slot: passphraseSlot,
      passphrase: PASSPHRASE,
    });

    expect(result.device).toBeUndefined();
  });

  it("does not open with another device's key or for another user", async () => {
    const { passphraseSlot } = await setUp();
    const remember = () =>
      unlockWithPassphrase({
        userId: ALICE,
        slot: passphraseSlot,
        passphrase: PASSPHRASE,
        remember: true,
      });
    const [first, second] = [
      (await remember()).device,
      (await remember()).device,
    ];
    if (!first || !second) throw new Error("Expected remembered devices");

    await expect(
      unlockWithDevice({
        userId: ALICE,
        deviceKey: second.deviceKey,
        deviceSlot: first.deviceSlot,
      }),
    ).rejects.toMatchObject({ code: "wrong-secret" });
    await expect(
      unlockWithDevice({ userId: BOB, ...first }),
    ).rejects.toMatchObject({
      code: "wrong-secret",
    });
  });
});
