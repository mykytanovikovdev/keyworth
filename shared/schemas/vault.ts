import { z } from "./zod.ts";

/**
 * What a vault record holds. The server sees the kind (it lists and limits by
 * it) but never the content. The kind is part of the record's AAD, so a
 * record cannot be moved under another kind.
 */
export const RECORD_KINDS = [
  "settings",
  "transaction",
  "conversation",
  "message",
  "alert",
] as const;

export const recordKindSchema = z.enum(RECORD_KINDS);

export type RecordKind = z.infer<typeof recordKindSchema>;
