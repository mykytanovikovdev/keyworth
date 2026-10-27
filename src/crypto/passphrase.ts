import { CryptoError } from "./errors.ts";

/** Counted in characters, after normalization. */
export const PASSPHRASE_MIN_LENGTH = 12;
export const PASSPHRASE_MAX_LENGTH = 1024;

export type PassphraseProblem = "not-latin" | "too-short" | "too-long";

/**
 * Passphrases are plain Latin: printable ASCII only (a–z, A–Z, digits, the
 * space and ASCII punctuation). Accented letters, other scripts and emoji are
 * refused rather than accepted: they are typed differently on different
 * keyboards and phones, and a passphrase typed while another keyboard layout
 * is active (Cyrillic, say) is caught at once, with a reason, instead of
 * failing after Argon2 as "wrong passphrase".
 */
const PLAIN_LATIN = /^[\x20-\x7e]*$/;

/**
 * Makes the forms a plain-Latin passphrase can arrive in identical before it
 * is checked or hashed: NFKC turns full-width letters and digits (typed by
 * East Asian input methods) into plain ones, every kind of space (Option+Space
 * gives a no-break space; tabs; ideographic spaces) becomes an ordinary space,
 * and spaces at either end are dropped. Case and inner spaces are kept.
 *
 * This is part of the key derivation: changing it changes every key derived
 * from a passphrase, so it is versioned with the slots, never edited in place.
 */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFKC").replace(/\s/gu, " ").trim();
}

/** True when the normalized passphrase is plain Latin; nothing else can be right. */
export function isPlainLatin(normalized: string): boolean {
  return PLAIN_LATIN.test(normalized);
}

export function checkPassphrase(passphrase: string): PassphraseProblem | null {
  const normalized = normalizePassphrase(passphrase);
  if (!isPlainLatin(normalized)) return "not-latin";
  if (normalized.length < PASSPHRASE_MIN_LENGTH) return "too-short";
  if (normalized.length > PASSPHRASE_MAX_LENGTH) return "too-long";
  return null;
}

/** Every flow that creates a passphrase slot refuses what checkPassphrase refuses. */
export function assertNewPassphrase(passphrase: string): void {
  const problem = checkPassphrase(passphrase);
  if (problem === "not-latin") {
    throw new CryptoError("not-latin", "Use plain Latin characters only.");
  }
  if (problem) {
    throw new CryptoError("invalid-input", `The passphrase is ${problem}.`);
  }
}
