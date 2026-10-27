import {
  decodeBase64url,
  encodeBase64url,
} from "../../shared/schemas/base64url.ts";
import { CryptoError } from "./errors.ts";

/** Bytes as WebCrypto accepts them (backed by a plain ArrayBuffer). */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Unpadded base64url, the form envelopes and key slots travel in. */
export const toBase64url = encodeBase64url;

export function fromBase64url(text: string): Bytes {
  const bytes = decodeBase64url(text);
  if (!bytes) throw new CryptoError("invalid-input", "Not unpadded base64url.");
  return bytes;
}

export function utf8(text: string): Bytes {
  // Copied into a plain ArrayBuffer: Workers' types allow a shared buffer here.
  return Uint8Array.from(new TextEncoder().encode(text));
}

/** Strict: invalid UTF-8 throws instead of turning into replacement characters. */
export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    bytes,
  );
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}
