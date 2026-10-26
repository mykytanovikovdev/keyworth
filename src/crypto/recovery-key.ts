import { type Bytes, randomBytes } from "./encoding.ts";

/*
 * The recovery key: 160 random bits written as 32 characters of Crockford's
 * Base32 in eight groups of four, e.g. `7KQM-3XRA-…`. Crockford's alphabet
 * leaves out I, L, O and U, so nothing is easy to misread when written down,
 * and when typed back I and L are read as 1 and O as 0.
 */

export const RECOVERY_KEY_BYTES = 20;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHARACTERS = (RECOVERY_KEY_BYTES * 8) / 5;
const GROUP = 4;

export interface RecoveryKey {
  bytes: Bytes;
  /** What the user saves: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. */
  text: string;
}

export function generateRecoveryKey(): RecoveryKey {
  const bytes = randomBytes(RECOVERY_KEY_BYTES);
  return { bytes, text: formatRecoveryKey(bytes) };
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
  return (
    characters.match(new RegExp(`.{1,${String(GROUP)}}`, "g")) ?? []
  ).join("-");
}

/**
 * Accepts what people actually type: any case, spaces or no dashes, and the
 * look-alikes Crockford maps (O → 0, I and L → 1). Returns null when it cannot
 * be a recovery key at all; a well-formed but wrong key fails later, when it
 * does not unwrap the data key.
 */
export function parseRecoveryKey(text: string): Bytes | null {
  const characters = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (characters.length !== CHARACTERS) return null;
  const bytes = new Uint8Array(RECOVERY_KEY_BYTES);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of characters) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (value >>> bits) & 0xff;
    }
  }
  return bytes;
}
