import { z } from "./zod.ts";

/*
 * Free text: what a person types (a note, a search) or a source sends (a
 * coin's name). It is only ever shown as text, never as markup, and these rules
 * keep it to what reads the same everywhere it appears: one line, nothing
 * invisible, nothing that reorders what is shown. See docs/input-validation.md.
 */

/**
 * Characters nobody can see, or that act instead of being shown: control
 * characters (line breaks, tabs, NUL, escape) and format characters, among
 * them zero-width spaces and joiners and the bidirectional overrides that make
 * "txt.exe" look like "exe.txt" (Trojan Source).
 */
const HIDDEN = /[\p{Cc}\p{Cf}]/u;
const HIDDEN_EVERYWHERE = /[\p{Cc}\p{Cf}]/gu;

export const hasHiddenCharacters = (value: string) => HIDDEN.test(value);

/** At most `maxLength` UTF-16 units, without splitting a character in two. */
function cut(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const end = /[\uD800-\uDBFF]/.test(value.charAt(maxLength - 1))
    ? maxLength - 1
    : maxLength;
  return value.slice(0, end);
}

/**
 * What a single-line text field keeps of a keystroke or a paste: line breaks
 * and tabs become spaces, other hidden characters go, and nothing past
 * `maxLength`. Spaces stay as typed, so the next word can follow; `cleanText`
 * tidies them when the text is kept.
 */
export function typedText(value: string, maxLength: number): string {
  // Any white space but a plain space: line breaks, tabs, no-break spaces.
  const spaced = value.replace(/[^\S ]/g, " ");
  return cut(spaced.replace(HIDDEN_EVERYWHERE, ""), maxLength);
}

/**
 * Text as it may be kept: one composed form (NFC, so "é" is one character
 * however it was typed), every run of white space one space, no hidden
 * characters, no spaces at the ends, at most `maxLength`. White space becomes a
 * space before hidden characters go, so no two words run together.
 */
export function cleanText(value: string, maxLength: number): string {
  const oneLine = value
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(HIDDEN_EVERYWHERE, "")
    // A hidden character between two spaces leaves both behind.
    .replace(/ {2,}/g, " ")
    .trim();
  // Cut, then trim again: the cut may end on a space. Cleaning twice changes nothing.
  return cut(oneLine, maxLength).trimEnd();
}

/**
 * Free text in a schema: refused unless it is already as `cleanText` leaves it.
 * Whoever sends it cleans it first; the schema does not quietly change it.
 */
export const plainTextSchema = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine((value) => cleanText(value, maxLength) === value, {
      message: "Text must be one clean line: no hidden characters.",
    });
