import {
  MAX_REVISION,
  RECORD_ID,
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
const DEK_USAGES: ("encrypt" | "decrypt")[] = ["encrypt", "decrypt"];

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

export function keyCheckAad(userId: string): Bytes {
  assertUserId(userId);
  return utf8(`key-check|${userId}|${String(AAD_VERSION)}`);
}

/**
 * Binds a record's ciphertext to its owner, its kind, its id and its revision.
 * The revision makes an old version of a record fail as `tampered` when it is
 * written back over a newer one: the server stores every write with the next
 * revision, which the old ciphertext was not made for.
 */
export function recordAad(
  userId: string,
  kind: RecordKind,
  recordId: string,
  revision: number,
): Bytes {
  assertUserId(userId);
  if (
    !recordKindSchema.safeParse(kind).success ||
    !RECORD_ID.test(recordId) ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    revision > MAX_REVISION
  ) {
    throw new CryptoError("invalid-input", "Malformed record reference.");
  }
  return utf8(
    `record|${userId}|${kind}|${recordId}|${String(revision)}|${String(AAD_VERSION)}`,
  );
}

/** generateKey's result for a symmetric algorithm, never a key pair. */
function secretKey(key: CryptoKey | CryptoKeyPair): CryptoKey {
  if ("privateKey" in key) throw new Error("Expected a secret key.");
  return key;
}

/**
 * A fresh data key. It is extractable only so that it can be wrapped right
 * after creation; the copy used for encryption is unwrapped as
 * non-extractable (see key-slots.ts).
 */
export async function generateDataKey(): Promise<CryptoKey> {
  return secretKey(
    await crypto.subtle.generateKey(DEK_ALGORITHM, true, DEK_USAGES),
  );
}

/**
 * The "Remember this device" key: random, non-extractable, kept in IndexedDB.
 * Scripts on the page can use it but never read it.
 */
export async function generateDeviceKey(): Promise<CryptoKey> {
  return secretKey(
    await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "wrapKey",
      "unwrapKey",
    ]),
  );
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

/** Proof that a data key is this account's: an AES-GCM tag over nothing. */
export interface KeyCheck {
  iv: Bytes;
  /** The 16-byte tag; with an empty plaintext there is nothing else. */
  tag: Bytes;
}

/** Made once, at setup, and stored with the slots. */
export async function createKeyCheck(
  dataKey: CryptoKey,
  userId: string,
): Promise<KeyCheck> {
  const additionalData = keyCheckAad(userId);
  const iv = randomBytes(IV_BYTES);
  const tag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    dataKey,
    new Uint8Array(0),
  );
  return { iv, tag: new Uint8Array(tag) };
}

/**
 * Confirms that a data key belongs to this account before anything is
 * encrypted with it: after an unlock, and when another tab hands a key over.
 * Fails with `wrong-secret` for any other key.
 */
export async function verifyKeyCheck(
  dataKey: CryptoKey,
  userId: string,
  check: KeyCheck,
): Promise<void> {
  const additionalData = keyCheckAad(userId);
  await onAuthFailure(
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: check.iv, additionalData },
      dataKey,
      check.tag,
    ),
    "wrong-secret",
    "This data key does not belong to this account.",
  );
}

/**
 * Opens a wrapped data key. Fails with `wrong-secret` when the key-encryption
 * key or the AAD does not match, which is how a wrong passphrase shows up.
 */
export async function unwrapDataKey(
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
