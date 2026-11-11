import {
  type Transaction,
  transactionSchema,
} from "../../../shared/schemas/transaction.ts";
import { VAULT_BATCH, type VaultBatch } from "../../../shared/schemas/vault.ts";
import { ApiError, type VaultApi } from "../../vault/api.ts";
import { newRecord, readRecords, writeRecord } from "../../vault/records.ts";
import type { Vault } from "../../vault/vault.ts";
import {
  ledgerProblems,
  parseTransaction,
  type TransactionProblem,
} from "./check.ts";

/*
 * Transactions: encrypted records of kind "transaction", the source of truth
 * for every position and figure. The one way to add, change or delete one,
 * whether from the form, the chat or a CSV file: each change is checked
 * against the whole ledger before anything is encrypted. The vault and the
 * API come in as arguments, so tests run it against a fake server.
 */

export interface VaultAccess {
  vault: Vault;
  api: VaultApi;
}

export interface TransactionRecord {
  id: string;
  /** The revision it was read with: a change sends it back. */
  revision: number;
  value: Transaction;
}

export interface TransactionList {
  /** Transactions that decrypt and fit the schema. */
  records: TransactionRecord[];
  /** Records that do not: left out of every figure, but they can be deleted. */
  damaged: string[];
}

/** A change was refused; nothing was written. */
export class TransactionError extends Error {
  readonly problems: readonly TransactionProblem[];
  /** After `changed-elsewhere`: the list as it is now, to show instead. */
  readonly latest: TransactionList | undefined;

  constructor(problems: TransactionProblem[], latest?: TransactionList) {
    super(`Transaction refused: ${problems.map((p) => p.kind).join(", ")}`);
    this.name = "TransactionError";
    this.problems = problems;
    this.latest = latest;
  }
}

export async function loadTransactions({
  vault,
  api,
}: VaultAccess): Promise<TransactionList> {
  const records = await readRecords(
    vault,
    api,
    "transaction",
    transactionSchema,
  );
  return {
    records: records.flatMap(({ id, revision, value }) =>
      value ? [{ id, revision, value }] : [],
    ),
    damaged: records.flatMap(({ id, value }) => (value ? [] : [id])),
  };
}

/**
 * Adds a transaction, or replaces the one with `id`. Returns the list with the
 * change in it. Refused with a TransactionError when the value is not a valid
 * transaction, is dated in the future, would leave a sale short, or the record
 * changed on another device since `list` was read.
 */
export async function saveTransaction(
  access: VaultAccess,
  list: TransactionList,
  change: { id?: string; value: unknown },
  now = Date.now(),
): Promise<TransactionList> {
  const parsed = parseTransaction(change.value, now);
  if ("problem" in parsed) throw new TransactionError([parsed.problem]);
  const current = change.id
    ? list.records.find((record) => record.id === change.id)
    : undefined;
  if (change.id && !current) {
    throw new TransactionError(
      [{ kind: "changed-elsewhere" }],
      await loadTransactions(access),
    );
  }
  const id = current?.id ?? crypto.randomUUID();
  const after = [
    ...list.records.filter((record) => record.id !== id),
    { id, revision: current?.revision ?? 0, value: parsed.value },
  ];
  const problems = ledgerProblems(list.records, after);
  if (problems.length > 0) throw new TransactionError(problems);

  let revision: number;
  try {
    revision = await writeRecord(
      access.vault,
      access.api,
      "transaction",
      id,
      current?.revision ?? 0,
      parsed.value,
    );
  } catch (error) {
    // Edited or deleted elsewhere: the user decides again on what is there now.
    if (
      error instanceof ApiError &&
      (error.code === "conflict" || error.code === "not_found")
    ) {
      throw new TransactionError(
        [{ kind: "changed-elsewhere" }],
        await loadTransactions(access),
      );
    }
    throw error;
  }
  return {
    records: after.map((record) =>
      record.id === id ? { ...record, revision } : record,
    ),
    damaged: list.damaged,
  };
}

/**
 * Deletes a transaction, or a damaged record. Refused when a later sale needs
 * the units it brought in. A record already gone counts as deleted.
 */
export async function deleteTransaction(
  access: VaultAccess,
  list: TransactionList,
  id: string,
): Promise<TransactionList> {
  const after = list.records.filter((record) => record.id !== id);
  const problems = ledgerProblems(list.records, after);
  if (problems.length > 0) throw new TransactionError(problems);
  try {
    await access.api.deleteRecord(id);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "not_found")) throw error;
  }
  return {
    records: after,
    damaged: list.damaged.filter((damaged) => damaged !== id),
  };
}

/**
 * An import stopped part of the way. What was written is in `list`; importing
 * the same file again skips it as recorded already.
 */
export class ImportStopped extends Error {
  readonly written: number;
  readonly list: TransactionList;

  constructor(written: number, list: TransactionList, cause: unknown) {
    super(`Import stopped after ${String(written)} transactions.`, { cause });
    this.name = "ImportStopped";
    this.written = written;
    this.list = list;
  }
}

type BatchRecord = VaultBatch["records"][number];

/** Room left for the JSON around the records in a batch's body. */
const BODY_MARGIN = 1024;

/** Records in batches the server takes: by count, and by the body's size. */
export function inBatches(records: readonly BatchRecord[]): BatchRecord[][] {
  const batches: BatchRecord[][] = [];
  let batch: BatchRecord[] = [];
  let size = 0;
  for (const record of records) {
    const bytes = JSON.stringify(record).length + 1;
    if (
      batch.length === VAULT_BATCH.maxRecords ||
      (batch.length > 0 && size + bytes > VAULT_BATCH.maxBytes - BODY_MARGIN)
    ) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(record);
    size += bytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** Times a batch answered "too many requests" is sent again. */
const RETRIES = 3;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Adds many transactions at once: an import. Every value meets the same rules
 * as one from the form, and the ledger's rule is checked over all of them
 * together before anything is encrypted (a TransactionError refuses the lot).
 * They are then written in batches, each whole or not at all; `progress` hears
 * how many are in. A batch answered 429 waits as told and goes again; any
 * other failure throws ImportStopped with the list as written so far.
 */
export async function importTransactions(
  access: VaultAccess,
  list: TransactionList,
  values: readonly unknown[],
  {
    now = Date.now(),
    progress,
    wait = sleep,
  }: {
    now?: number;
    progress?: (written: number) => void;
    /** For tests: how a 429's wait is spent. */
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<TransactionList> {
  const added: TransactionRecord[] = [];
  for (const value of values) {
    const parsed = parseTransaction(value, now);
    if ("problem" in parsed) throw new TransactionError([parsed.problem]);
    added.push({ id: crypto.randomUUID(), revision: 1, value: parsed.value });
  }
  const problems = ledgerProblems(list.records, [...list.records, ...added]);
  if (problems.length > 0) throw new TransactionError(problems);

  const encrypted = await Promise.all(
    added.map(({ id, value }) =>
      newRecord(access.vault, "transaction", id, value),
    ),
  );
  let written = 0;
  const sofar = (): TransactionList => ({
    records: [...list.records, ...added.slice(0, written)],
    damaged: list.damaged,
  });
  for (const batch of inBatches(encrypted)) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await access.api.createRecords({ records: batch });
        break;
      } catch (error) {
        const limited =
          error instanceof ApiError &&
          error.status === 429 &&
          attempt < RETRIES;
        if (!limited) throw new ImportStopped(written, sofar(), error);
        await wait((error.retryAfter ?? 1) * 1000);
      }
    }
    written += batch.length;
    progress?.(written);
  }
  return sofar();
}
