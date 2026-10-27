import { argon2idAsync } from "@noble/hashes/argon2.js";
import { type Bytes, utf8 } from "./encoding.ts";
import { CryptoError } from "./errors.ts";
import {
  assertKdfParams,
  KEY_BYTES,
  type KdfParams,
  SALT_BYTES,
} from "./params.ts";
import { normalizePassphrase } from "./passphrase.ts";

/** Called with 0…1 while Argon2 runs, so the unlock screen shows real progress. */
export type OnProgress = (fraction: number) => void;

// Key-encryption keys only wrap and unwrap the data key; they never encrypt data.
// Typed as literals: the Workers types (used by the integration tests) lack KeyUsage.
const KEK_USAGES: ("wrapKey" | "unwrapKey")[] = ["wrapKey", "unwrapKey"];

function assertSalt(salt: Uint8Array): void {
  if (salt.length !== SALT_BYTES) {
    throw new CryptoError("invalid-input", "The salt must be 16 bytes.");
  }
}

/**
 * Passphrase → key-encryption key, with Argon2id from @noble/hashes. The async
 * variant computes in slices and yields to the event loop between them, so the
 * page stays responsive without a Web Worker (which our CSP would not allow).
 */
export async function derivePassphraseKek(
  passphrase: string,
  salt: Bytes,
  params: KdfParams,
  onProgress?: OnProgress,
): Promise<CryptoKey> {
  assertKdfParams(params);
  assertSalt(salt);
  const password = utf8(normalizePassphrase(passphrase));
  const raw = await argon2idAsync(password, salt, {
    t: params.passes,
    m: params.memoryKiB,
    p: params.parallelism,
    dkLen: KEY_BYTES,
    ...(onProgress && { onProgress }),
  });
  try {
    return await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(raw),
      "AES-GCM",
      false,
      KEK_USAGES,
    );
  } finally {
    // Best effort: JavaScript cannot guarantee that no copy remains elsewhere.
    raw.fill(0);
    password.fill(0);
  }
}

/**
 * Recovery key → key-encryption key. The recovery key is 160 random bits, so a
 * slow password hash adds nothing: HKDF (built into WebCrypto) derives the key
 * at once. The `info` label keeps this key separate from any other use.
 */
export async function deriveRecoveryKek(
  recoveryKey: Bytes,
  salt: Bytes,
): Promise<CryptoKey> {
  assertSalt(salt);
  const base = await crypto.subtle.importKey(
    "raw",
    recoveryKey,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: utf8("keyworth/recovery-kek/v1"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    KEK_USAGES,
  );
}
