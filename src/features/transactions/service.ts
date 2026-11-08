import {
  type Transaction,
  transactionSchema,
} from "../../../shared/schemas/transaction.ts";
import { ApiError, type VaultApi } from "../../vault/api.ts";
import { readRecords, writeRecord } from "../../vault/records.ts";
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
