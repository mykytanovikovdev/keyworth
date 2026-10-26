import {
  MAX_PADDED_BYTES,
  MIN_PADDED_BYTES,
} from "../../shared/schemas/envelope.ts";
import type { Bytes } from "./encoding.ts";
import { CryptoError } from "./errors.ts";

/*
 * Before encryption, plaintext is padded to the next power of two (at least
 * 256 bytes), so the server sees which size bucket a record falls into, not
 * how long a note is. The padding is a 0x80 byte followed by zeros (ISO/IEC
 * 7816-4), which can be removed without knowing the original length. It is
 * checked only after AES-GCM has authenticated the whole block, so it cannot
 * serve as a padding oracle.
 */

/** The longest plaintext that still fits the largest bucket. */
export const MAX_PLAINTEXT_BYTES = MAX_PADDED_BYTES - 1;

export function paddedSize(length: number): number {
  let size = MIN_PADDED_BYTES;
  while (size < length + 1) size *= 2;
  return size;
}

export function pad(plaintext: Uint8Array): Bytes {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new CryptoError("invalid-input", "The record is too large to store.");
  }
  const padded = new Uint8Array(paddedSize(plaintext.length));
  padded.set(plaintext);
  padded[plaintext.length] = 0x80;
  return padded;
}

export function unpad(padded: Uint8Array): Uint8Array {
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 0x80) {
    throw new CryptoError("tampered", "The record's padding is malformed.");
  }
  return padded.subarray(0, end);
}
