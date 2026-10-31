import type { RecordKind } from "../../shared/schemas/vault.ts";
import { CryptoError } from "../crypto/index.ts";
import type { VaultApi } from "./api.ts";
import type { Vault } from "./vault.ts";

/*
 * Encrypted records, decrypted only in memory. Reading checks each value
 * against its kind's schema; a record that does not decrypt or does not match
 * is returned as damaged (value null) rather than dropped or thrown, so one
 * bad record cannot hide the others. Writing encrypts for the revision the
 * record will have once stored: the one it was read with, plus one.
 */

export interface StoredRecord<T> {
  id: string;
  /** The revision it was read with: send it back to replace the record. */
  revision: number;
  /** null when damaged: it does not decrypt, or holds something unexpected. */
  value: T | null;
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export async function readRecords<T>(
  vault: Vault,
  api: VaultApi,
  kind: RecordKind,
  schema: Schema<T>,
): Promise<StoredRecord<T>[]> {
  const rows = await api.records(kind);
  return Promise.all(
    rows.map(async (row) => {
      let value: T | null = null;
      try {
        // Decrypted as the kind asked for: a row of another kind fails its AAD.
        const parsed = schema.safeParse(
          await vault.decrypt(kind, row.id, row.revision, row.envelope),
        );
        if (parsed.success) value = parsed.data;
      } catch (error) {
        if (!(error instanceof CryptoError)) throw error;
      }
      return { id: row.id, revision: row.revision, value };
    }),
  );
}

/**
 * Creates (`revision` 0) or replaces a record and returns its new revision.
 * A stale revision fails with ApiError 409 `conflict`: read again, re-apply
 * the change, write again.
 */
export async function writeRecord(
  vault: Vault,
  api: VaultApi,
  kind: RecordKind,
  id: string,
  revision: number,
  value: unknown,
): Promise<number> {
  const envelope = await vault.encrypt(kind, id, revision + 1, value);
  return api.putRecord(id, { kind, revision, envelope });
}
