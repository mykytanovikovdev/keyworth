import { CryptoError } from "./errors.ts";

/** Bytes as WebCrypto accepts them (backed by a plain ArrayBuffer). */
export type Bytes = Uint8Array<ArrayBuffer>;

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Unpadded base64url, the form envelopes and key slots travel in. */
export function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64url(text: string): Bytes {
  // A length of 4n + 1 cannot come from any byte string.
  if (!BASE64URL.test(text) || text.length % 4 === 1) {
    throw new CryptoError("invalid-input", "Not unpadded base64url.");
  }
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function utf8(text: string): Bytes {
  return new TextEncoder().encode(text);
}

/** Strict: invalid UTF-8 throws instead of turning into replacement characters. */
export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}
