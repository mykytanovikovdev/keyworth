/** Counted in characters as people see them (graphemes), after normalization. */
export const PASSPHRASE_MIN_LENGTH = 12;
export const PASSPHRASE_MAX_LENGTH = 1024;

export type PassphraseProblem = "too-short" | "too-long";

/**
 * The same passphrase typed on two devices can arrive as different code points
 * ("é" as one character or as "e" plus a combining accent). NFC makes them the
 * same bytes, so the key never depends on the keyboard. Nothing else changes:
 * spaces and case are part of the passphrase.
 */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFC");
}

export function checkPassphrase(passphrase: string): PassphraseProblem | null {
  const length = [
    ...new Intl.Segmenter().segment(normalizePassphrase(passphrase)),
  ].length;
  if (length < PASSPHRASE_MIN_LENGTH) return "too-short";
  if (length > PASSPHRASE_MAX_LENGTH) return "too-long";
  return null;
}
