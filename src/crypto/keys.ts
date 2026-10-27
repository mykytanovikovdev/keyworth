import {
  recordKindSchema,
  type RecordKind,
} from "../../shared/schemas/vault.ts";
import { IV_BYTES } from "../../shared/schemas/envelope.ts";
import { type Bytes, randomBytes, utf8 } from "./encoding.ts";
import { CryptoError, onAuthFailure } from "./errors.ts";

/*
 * The data key (DEK) and its wrappings. One random AES-256-GCM key encrypts
 * every record of a user; it is stored only wrapped (encrypted) by
 * key-encryption keys: one from the passphrase, one from the recovery key and,
 * when the user asks to be remembered, one that lives on the device.
 */

const DEK_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const DEK_USAGES: KeyUsage[] = ["encrypt", "decrypt"];

/** An encrypted copy of the data key; safe to store on the server. */
export interface WrappedKey {
  iv: Bytes;
  /** The raw key encrypted with AES-GCM: 32 bytes plus the 16-byte tag. */
  wrappedKey: Bytes;
}

export type SlotKind = "passphrase" | "recovery";

// Every value that goes into an AAD is checked against a pattern that cannot
// contain "|", so joining the fields with "|" is unambiguous.
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RECORD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AAD_VERSION = 1;

function assertUserId(userId: string): void {
  if (!USER_ID.test(userId)) {
    throw new CryptoError("invalid-input", "Malformed user id.");
  }
}

/**
 * Binds a wrapped key to its owner and its kind: a passphrase wrapping cannot
 * be passed off as a recovery wrapping, or as another user's.
 */
export function keySlotAad(userId: string, kind: SlotKind): Bytes {
  assertUserId(userId);
  return utf8(`key-slot|${userId}|${kind}|${String(AAD_VERSION)}`);
}

export function deviceAad(userId: string): Bytes {
  assertUserId(userId);
  return utf8(`device|${userId}|${String(AAD_VERSION)}`);
}

/** Binds a record's ciphertext to its owner, its kind and its id. */
export function recordAad(
  userId: string,
  kind: RecordKind,
  recordId: string,
): Bytes {
  assertUserId(userId);
  if (!recordKindSchema.safeParse(kind).success || !RECORD_ID.test(recordId)) {
    throw new CryptoError("invalid-input", "Malformed record reference.");
  }
  return utf8(`record|${userId}|${kind}|${recordId}|${String(AAD_VERSION)}`);
}

/**
 * A fresh data key. It is extractable only so that it can be wrapped right
 * after creation; the copy used for encryption is unwrapped as
 * non-extractable (see key-slots.ts).
 */
export function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(DEK_ALGORITHM, true, DEK_USAGES);
}

/**
 * The "Remember this device" key: random, non-extractable, kept in IndexedDB.
 * Scripts on the page can use it but never read it.
 */
export function generateDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
}

export async function wrapDataKey(
  dataKey: CryptoKey,
  kek: CryptoKey,
  aad: Bytes,
): Promise<WrappedKey> {
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.wrapKey("raw", dataKey, kek, {
    name: "AES-GCM",
    iv,
    additionalData: aad,
  });
  return { iv, wrappedKey: new Uint8Array(wrapped) };
}

/**
 * Opens a wrapped data key. Fails with `wrong-secret` when the key-encryption
 * key or the AAD does not match, which is how a wrong passphrase shows up.
 */
export function unwrapDataKey(
  wrapped: WrappedKey,
  kek: CryptoKey,
  aad: Bytes,
  { extractable = false }: { extractable?: boolean } = {},
): Promise<CryptoKey> {
  if (wrapped.iv.length !== IV_BYTES) {
    throw new CryptoError("invalid-input", "Malformed wrapped key.");
  }
  return onAuthFailure(
    crypto.subtle.unwrapKey(
      "raw",
      wrapped.wrappedKey,
      kek,
      { name: "AES-GCM", iv: wrapped.iv, additionalData: aad },
      DEK_ALGORITHM,
      extractable,
      DEK_USAGES,
    ),
    "wrong-secret",
    "This key does not open the data key.",
  );
}
