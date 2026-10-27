import {
  type DeviceSlotJson,
  deviceSlotSchema,
  type KeyCheckJson,
  keyCheckSchema,
  type PassphraseSlotJson,
  passphraseSlotSchema,
  type RecoverySlotJson,
  recoverySlotSchema,
  SLOT_VERSION,
} from "../../shared/schemas/keys.ts";
import { fromBase64url, toBase64url } from "./encoding.ts";
import { CryptoError } from "./errors.ts";
import type { DeviceSlot, PassphraseSlot, RecoverySlot } from "./key-slots.ts";
import type { KeyCheck } from "./keys.ts";

/*
 * Key slots as JSON for /api/keys, and back. Slots read from the server are
 * untrusted: they are validated against the shared schemas (exact lengths,
 * Argon2 settings within limits) before any cryptography touches them.
 */

function parse<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CryptoError("invalid-input", "Malformed key slot.");
  }
  return result.data;
}

export function passphraseSlotToJson(slot: PassphraseSlot): PassphraseSlotJson {
  return {
    v: SLOT_VERSION,
    kdf: { ...slot.kdf },
    salt: toBase64url(slot.salt),
    iv: toBase64url(slot.iv),
    wrappedKey: toBase64url(slot.wrappedKey),
  };
}

export function passphraseSlotFromJson(value: unknown): PassphraseSlot {
  const json = parse(passphraseSlotSchema, value);
  return {
    kind: "passphrase",
    kdf: json.kdf,
    salt: fromBase64url(json.salt),
    iv: fromBase64url(json.iv),
    wrappedKey: fromBase64url(json.wrappedKey),
  };
}

export function recoverySlotToJson(slot: RecoverySlot): RecoverySlotJson {
  return {
    v: SLOT_VERSION,
    salt: toBase64url(slot.salt),
    iv: toBase64url(slot.iv),
    wrappedKey: toBase64url(slot.wrappedKey),
  };
}

export function recoverySlotFromJson(value: unknown): RecoverySlot {
  const json = parse(recoverySlotSchema, value);
  return {
    kind: "recovery",
    salt: fromBase64url(json.salt),
    iv: fromBase64url(json.iv),
    wrappedKey: fromBase64url(json.wrappedKey),
  };
}

export function deviceSlotToJson(slot: DeviceSlot): DeviceSlotJson {
  return { iv: toBase64url(slot.iv), wrappedKey: toBase64url(slot.wrappedKey) };
}

export function deviceSlotFromJson(value: unknown): DeviceSlot {
  const json = parse(deviceSlotSchema, value);
  return {
    iv: fromBase64url(json.iv),
    wrappedKey: fromBase64url(json.wrappedKey),
  };
}

export function keyCheckToJson(check: KeyCheck): KeyCheckJson {
  return {
    v: SLOT_VERSION,
    iv: toBase64url(check.iv),
    tag: toBase64url(check.tag),
  };
}

export function keyCheckFromJson(value: unknown): KeyCheck {
  const json = parse(keyCheckSchema, value);
  return { iv: fromBase64url(json.iv), tag: fromBase64url(json.tag) };
}
