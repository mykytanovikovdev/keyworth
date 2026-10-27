import { sha256 } from "@noble/hashes/sha2.js";
import { type Bytes, randomBytes, utf8 } from "./encoding.ts";
import { CryptoError } from "./errors.ts";

/*
 * The recovery key: 160 random bits written as 32 characters of Crockford's
 * Base32, followed by a four-character check group: nine groups of four,
 * e.g. `7KQM-3XRA-…-W2CD`. Crockford's alphabet leaves out I, L, O and U, so
 * nothing is easy to misread when written down, and when typed back I and L
 * are read as 1 and O as 0. The check group catches typos: without it, a
 * mistyped key would look exactly like someone else's key.
 */

export const RECOVERY_KEY_BYTES = 20;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_CHARACTERS = (RECOVERY_KEY_BYTES * 8) / 5;
const CHECK_CHARACTERS = 4;
const GROUP = 4;
/** 36 characters of the alphabet, once separators are gone. */
const SHAPE = new RegExp(
  `^[${ALPHABET}]{${String(KEY_CHARACTERS + CHECK_CHARACTERS)}}$`,
);

export interface RecoveryKey {
  bytes: Bytes;
  /** What the user saves: nine groups of four, the last one the check group. */
  text: string;
}

export function generateRecoveryKey(): RecoveryKey {
  const bytes = randomBytes(RECOVERY_KEY_BYTES);
  return { bytes, text: formatRecoveryKey(bytes) };
}

/**
 * The check group: the first 20 bits of SHA-256 over a label and the key. It
 * is not a secret and protects nothing; it only detects typing mistakes (a
 * wrong key passes it once in about a million tries).
 */
function checkCharacters(bytes: Uint8Array): string {
  const hash = sha256(
    Uint8Array.from([...utf8("keyworth/recovery-check/v1"), ...bytes]),
  );
  const value =
    ((hash[0] ?? 0) << 12) | ((hash[1] ?? 0) << 4) | ((hash[2] ?? 0) >>> 4);
  let characters = "";
  for (let shift = 15; shift >= 0; shift -= 5) {
    characters += ALPHABET.charAt((value >>> shift) & 31);
  }
  return characters;
}

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let characters = "";
  for (const byte of bytes) {
    // At most 12 bits are pending at a time; the mask keeps the integer small.
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      characters += ALPHABET.charAt((value >>> bits) & 31);
    }
  }
  characters += checkCharacters(bytes);
  return (
    characters.match(new RegExp(`.{1,${String(GROUP)}}`, "g")) ?? []
  ).join("-");
}

/**
 * Accepts what people actually type or paste: any case, spaces or no dashes,
 * any kind of dash, a minus sign or a soft hyphen (copied from a PDF or a word
 * processor), full-width forms, and the look-alikes Crockford maps (O → 0, I and L → 1).
 * Refuses, before any cryptography:
 * - `not-latin`: characters other than plain Latin, such as a Cyrillic "С"
 *   typed for a "C" with another keyboard layout on;
 * - `invalid-input`: anything that is not 36 characters of the alphabet;
 * - `mistyped`: a check group that does not match the key.
 * A well-formed key that is simply not this account's fails later, when it
 * does not unwrap the data key.
 */
export function parseRecoveryKey(text: string): Bytes {
  const stripped = text
    .normalize("NFKC")
    .replace(/[\s\p{Pd}\u00ad\u2212]/gu, "");
  if (!/^[\x20-\x7e]*$/.test(stripped)) {
    throw new CryptoError("not-latin", "Use plain Latin characters only.");
  }
  const characters = stripped
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (!SHAPE.test(characters)) {
    throw new CryptoError("invalid-input", "This is not a recovery key.");
  }
  const bytes = new Uint8Array(RECOVERY_KEY_BYTES);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of characters.slice(0, KEY_CHARACTERS)) {
    value = ((value << 5) | ALPHABET.indexOf(character)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (value >>> bits) & 0xff;
    }
  }
  const check = characters.slice(KEY_CHARACTERS);
  if (check !== checkCharacters(bytes)) {
    bytes.fill(0);
    throw new CryptoError("mistyped", "This recovery key has a typo.");
  }
  return bytes;
}
