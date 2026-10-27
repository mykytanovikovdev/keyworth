import { z } from "./zod.ts";

/*
 * Unpadded base64url: how every binary value (IVs, salts, wrapped keys,
 * ciphertexts) travels in JSON between the browser and the Worker. Shared so
 * both sides encode and validate identically; plain JavaScript, so it runs in
 * browsers, Workers and Node alike.
 */

export const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Length of `bytes` bytes in unpadded base64url. */
export const base64urlLength = (bytes: number) => Math.ceil((bytes * 4) / 3);

/** A base64url string that decodes to exactly `bytes` bytes. */
export const base64urlBytes = (bytes: number) =>
  z.string().regex(BASE64URL).length(base64urlLength(bytes));

export function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Null for anything that is not unpadded base64url. */
export function decodeBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  // A length of 4n + 1 cannot come from any byte string.
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
