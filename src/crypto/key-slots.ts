import { type Bytes, randomBytes } from "./encoding.ts";
import {
  deriveRecoveryKek,
  derivePassphraseKek,
  type OnProgress,
} from "./kdf.ts";
import {
  deviceAad,
  generateDataKey,
  generateDeviceKey,
  keySlotAad,
  unwrapDataKey,
  type WrappedKey,
  wrapDataKey,
} from "./keys.ts";
import { CURRENT_KDF_PARAMS, type KdfParams, SALT_BYTES } from "./params.ts";
import { assertNewPassphrase } from "./passphrase.ts";
import { generateRecoveryKey, parseRecoveryKey } from "./recovery-key.ts";

/*
 * The user-facing key flows: set up, unlock, change the passphrase, replace
 * the recovery key, reset a forgotten passphrase, remember a device. Each
 * returns the data key as a non-extractable CryptoKey for this page, plus the
 * wrapped copies the server should store.
 *
 * WebCrypto can only wrap an extractable key, and the working copy is not
 * extractable. So any flow that creates a new wrapping first unwraps the data
 * key again as extractable, wraps it, and lets that copy go. This is why
 * changing the passphrase or the recovery key asks for the current passphrase.
 */

export interface PassphraseSlot extends WrappedKey {
  kind: "passphrase";
  kdf: KdfParams;
  salt: Bytes;
}

export interface RecoverySlot extends WrappedKey {
  kind: "recovery";
  salt: Bytes;
}

/** The server half of "Remember this device"; the device key stays local. */
export type DeviceSlot = WrappedKey;

export interface RememberedDevice {
  deviceKey: CryptoKey;
  deviceSlot: DeviceSlot;
}

interface WithProgress {
  onProgress?: OnProgress;
  /**
   * Argon2id settings for a new passphrase slot. Production always uses the
   * current ones; tests pass the cheaper OWASP minimum, which is still checked.
   */
  kdf?: KdfParams;
}

function passphraseKek(
  slot: Pick<PassphraseSlot, "kdf" | "salt">,
  passphrase: string,
  onProgress?: OnProgress,
) {
  return derivePassphraseKek(passphrase, slot.salt, slot.kdf, onProgress);
}

async function newPassphraseSlot(
  userId: string,
  dataKey: CryptoKey,
  passphrase: string,
  kdf: KdfParams,
  onProgress?: OnProgress,
): Promise<{ slot: PassphraseSlot; kek: CryptoKey }> {
  // Built first: a malformed user id is refused before Argon2 runs.
  const aad = keySlotAad(userId, "passphrase");
  const salt = randomBytes(SALT_BYTES);
  const kek = await derivePassphraseKek(passphrase, salt, kdf, onProgress);
  const wrapped = await wrapDataKey(dataKey, kek, aad);
  return {
    slot: { kind: "passphrase", kdf: { ...kdf }, salt, ...wrapped },
    kek,
  };
}

async function newRecoverySlot(
  userId: string,
  dataKey: CryptoKey,
): Promise<{ slot: RecoverySlot; recoveryKey: string }> {
  const recovery = generateRecoveryKey();
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveRecoveryKek(recovery.bytes, salt);
  const wrapped = await wrapDataKey(
    dataKey,
    kek,
    keySlotAad(userId, "recovery"),
  );
  recovery.bytes.fill(0);
  return {
    slot: { kind: "recovery", salt, ...wrapped },
    recoveryKey: recovery.text,
  };
}

async function rememberDevice(
  userId: string,
  extractableKey: CryptoKey,
): Promise<RememberedDevice> {
  const deviceKey = await generateDeviceKey();
  const deviceSlot = await wrapDataKey(
    extractableKey,
    deviceKey,
    deviceAad(userId),
  );
  return { deviceKey, deviceSlot };
}

async function recoveryKek(
  slot: RecoverySlot,
  recoveryKey: string,
): Promise<CryptoKey> {
  // Refuses malformed, non-Latin and mistyped keys before any cryptography.
  const bytes = parseRecoveryKey(recoveryKey);
  try {
    return await deriveRecoveryKek(bytes, slot.salt);
  } finally {
    bytes.fill(0);
  }
}

/** First sign-in: a new data key, wrapped by the passphrase and a new recovery key. */
export async function createKeys({
  userId,
  passphrase,
  onProgress,
  kdf = CURRENT_KDF_PARAMS,
}: { userId: string; passphrase: string } & WithProgress): Promise<{
  dataKey: CryptoKey;
  passphraseSlot: PassphraseSlot;
  recoverySlot: RecoverySlot;
  /** Shown to the user once; never stored or sent anywhere. */
  recoveryKey: string;
}> {
  assertNewPassphrase(passphrase);
  const extractable = await generateDataKey();
  const { slot: passphraseSlot, kek } = await newPassphraseSlot(
    userId,
    extractable,
    passphrase,
    kdf,
    onProgress,
  );
  const { slot: recoverySlot, recoveryKey } = await newRecoverySlot(
    userId,
    extractable,
  );
  const dataKey = await unwrapDataKey(
    passphraseSlot,
    kek,
    keySlotAad(userId, "passphrase"),
  );
  return { dataKey, passphraseSlot, recoverySlot, recoveryKey };
}

export async function unlockWithPassphrase({
  userId,
  slot,
  passphrase,
  remember = false,
  onProgress,
}: {
  userId: string;
  slot: PassphraseSlot;
  passphrase: string;
  /** "Remember this device": also returns a device key and its wrapping. */
  remember?: boolean;
  onProgress?: OnProgress;
}): Promise<{ dataKey: CryptoKey; device?: RememberedDevice }> {
  const aad = keySlotAad(userId, "passphrase");
  const kek = await passphraseKek(slot, passphrase, onProgress);
  if (!remember) return { dataKey: await unwrapDataKey(slot, kek, aad) };
  const extractable = await unwrapDataKey(slot, kek, aad, {
    extractable: true,
  });
  const device = await rememberDevice(userId, extractable);
  return { dataKey: await unwrapDataKey(slot, kek, aad), device };
}

export async function unlockWithDevice({
  userId,
  deviceKey,
  deviceSlot,
}: {
  userId: string;
  deviceKey: CryptoKey;
  deviceSlot: DeviceSlot;
}): Promise<CryptoKey> {
  return unwrapDataKey(deviceSlot, deviceKey, deviceAad(userId));
}

export async function unlockWithRecoveryKey({
  userId,
  slot,
  recoveryKey,
}: {
  userId: string;
  slot: RecoverySlot;
  recoveryKey: string;
}): Promise<CryptoKey> {
  const kek = await recoveryKek(slot, recoveryKey);
  return unwrapDataKey(slot, kek, keySlotAad(userId, "recovery"));
}

/**
 * Rewraps the data key with a new passphrase, or with the same passphrase and
 * newer Argon2id settings. Two derivations: progress runs 0…0.5, then 0.5…1.
 */
export async function changePassphrase({
  userId,
  slot,
  currentPassphrase,
  newPassphrase,
  onProgress,
  kdf = CURRENT_KDF_PARAMS,
}: {
  userId: string;
  slot: PassphraseSlot;
  currentPassphrase: string;
  newPassphrase: string;
} & WithProgress): Promise<PassphraseSlot> {
  assertNewPassphrase(newPassphrase);
  const aad = keySlotAad(userId, "passphrase");
  const kek = await passphraseKek(
    slot,
    currentPassphrase,
    onProgress &&
      ((f) => {
        onProgress(f / 2);
      }),
  );
  const extractable = await unwrapDataKey(slot, kek, aad, {
    extractable: true,
  });
  const { slot: next } = await newPassphraseSlot(
    userId,
    extractable,
    newPassphrase,
    kdf,
    onProgress &&
      ((f) => {
        onProgress(0.5 + f / 2);
      }),
  );
  return next;
}

/** A new recovery key; the old one stops working once the slot is replaced. */
export async function replaceRecoveryKey({
  userId,
  passphraseSlot,
  passphrase,
  onProgress,
}: {
  userId: string;
  passphraseSlot: PassphraseSlot;
  passphrase: string;
  onProgress?: OnProgress;
}): Promise<{ recoverySlot: RecoverySlot; recoveryKey: string }> {
  const aad = keySlotAad(userId, "passphrase");
  const kek = await passphraseKek(passphraseSlot, passphrase, onProgress);
  const extractable = await unwrapDataKey(passphraseSlot, kek, aad, {
    extractable: true,
  });
  const { slot: recoverySlot, recoveryKey } = await newRecoverySlot(
    userId,
    extractable,
  );
  return { recoverySlot, recoveryKey };
}

/** Forgotten passphrase: the recovery key opens the data key, a new passphrase wraps it. */
export async function resetPassphrase({
  userId,
  recoverySlot,
  recoveryKey,
  newPassphrase,
  onProgress,
  kdf = CURRENT_KDF_PARAMS,
}: {
  userId: string;
  recoverySlot: RecoverySlot;
  recoveryKey: string;
  newPassphrase: string;
} & WithProgress): Promise<{
  dataKey: CryptoKey;
  passphraseSlot: PassphraseSlot;
}> {
  assertNewPassphrase(newPassphrase);
  const kek = await recoveryKek(recoverySlot, recoveryKey);
  const aad = keySlotAad(userId, "recovery");
  const extractable = await unwrapDataKey(recoverySlot, kek, aad, {
    extractable: true,
  });
  const { slot: passphraseSlot } = await newPassphraseSlot(
    userId,
    extractable,
    newPassphrase,
    kdf,
    onProgress,
  );
  const dataKey = await unwrapDataKey(recoverySlot, kek, aad);
  return { dataKey, passphraseSlot };
}
