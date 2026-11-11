import { envelopeSchema } from "./envelope.ts";
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

/**
 * Record ids are random UUIDs (version 4, lower case) made by the browser
 * before encryption, because the id is part of the AAD.
 */
export const RECORD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const recordIdSchema = z.string().regex(RECORD_ID);

/** Per-user limits, so one account cannot fill the database. */
export const VAULT_LIMITS = Object.freeze({
  maxRecords: 20_000,
  /** Ciphertext bytes across all of a user's records. */
  maxBytes: 50 * 1024 * 1024,
});

/**
 * One page of `GET /api/vault`. A Worker has 128 MB of memory and a user up
 * to 50 MiB of ciphertext, so the records come in pages; the record that
 * crosses `maxBytes` is still included, so a page always moves forward.
 */
export const VAULT_PAGE = Object.freeze({
  maxRecords: 5000,
  /** Ciphertext bytes. */
  maxBytes: 4 * 1024 * 1024,
});

/**
 * Where the next page starts: when the last record was created (microseconds
 * since 1970) and its id. Opaque to the browser, which only sends it back.
 */
export const VAULT_CURSOR =
  /^(\d{1,17})_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

/** Revisions are stored in a 32-bit integer column. */
export const MAX_REVISION = 2_147_483_647;

/**
 * Body of `PUT /api/vault/:id`. `revision` is the revision the browser last
 * saw: 0 to create the record, otherwise the current one; the record is stored
 * with the next one. A stale revision is refused (409), so two devices cannot
 * silently overwrite each other.
 */
export const vaultWriteSchema = z.strictObject({
  kind: recordKindSchema,
  revision: z
    .int()
    .min(0)
    .max(MAX_REVISION - 1),
  envelope: envelopeSchema,
});

export type VaultWrite = z.infer<typeof vaultWriteSchema>;

/**
 * `POST /api/vault/batch`: new records written together, all or none, for an
 * import. Writes one at a time are limited to 120 a minute; a file of a
 * thousand transactions would take nine.
 */
export const VAULT_BATCH = Object.freeze({
  maxRecords: 100,
  /**
   * Body bytes. Checking and decoding envelopes costs CPU by the byte (about
   * 27 µs a KB measured on a laptop), so the body, not the count, keeps a batch
   * well inside a Worker's 10 ms: a hundred short transactions take 40 KB,
   * long notes split into more batches.
   */
  maxBytes: 128 * 1024,
});

/** Only kinds that come in numbers; settings stay one record, written alone. */
export const BATCH_KINDS = ["transaction"] as const satisfies RecordKind[];

export const vaultBatchSchema = z.strictObject({
  records: z
    .array(
      z.strictObject({
        id: recordIdSchema,
        kind: z.enum(BATCH_KINDS),
        envelope: envelopeSchema,
      }),
    )
    .min(1)
    .max(VAULT_BATCH.maxRecords)
    .refine(
      (records) => new Set(records.map(({ id }) => id)).size === records.length,
      { message: "Each id once." },
    ),
});

export type VaultBatch = z.infer<typeof vaultBatchSchema>;

/** One record as `GET /api/vault` returns it. */
export interface VaultRecordJson {
  id: string;
  kind: RecordKind;
  revision: number;
  envelope: z.infer<typeof envelopeSchema>;
  updatedAt: string;
}

/** A page of records, oldest first; `next` is null on the last page. */
export interface VaultPageJson {
  records: VaultRecordJson[];
  next: string | null;
}
