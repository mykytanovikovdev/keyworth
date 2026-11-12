import { getLocalTimeZone, today } from "@internationalized/date";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { MARKET_LIMITS } from "../../../shared/schemas/market.ts";
import { showToast } from "../../ui/index.ts";
import { exportFileName, transactionsCsv } from "./csv-export.ts";
import {
  coinsToLookUp,
  type FileProblem,
  type ImportPlan,
  planImport,
  readTable,
  readText,
} from "./csv-import.ts";
import { downloadText } from "./download.ts";
import type { AssetChoice } from "./form-values.ts";
import { ImportDialog } from "./ImportDialog.tsx";
import { assetsOf, quotesQuery, snapshotQuery } from "./market.ts";
import { access } from "./queries.ts";
import {
  ImportStopped,
  importTransactions,
  TransactionError,
  type TransactionList,
} from "./service.ts";

/*
 * Import from and export to CSV, for the transactions page. The file is read,
 * checked and encrypted here; the server gets only envelopes, in batches. The
 * coins a file names outside the shared snapshot are looked up by id under
 * ["vault", …], like the coins in the list (they say what the user holds).
 */

interface ImportExportOptions {
  userId: string;
  current: () => TransactionList | undefined;
  /** False when the vault locked meanwhile: nothing was kept. */
  store: (list: TransactionList) => boolean;
  assetOf: (assetId: string) => AssetChoice;
  failed: (error: unknown) => void;
  /** The dialog is open from the first render (loaded on demand). */
  startOpen?: boolean;
}

const counted = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

export function useImportExport({
  userId,
  current,
  store,
  assetOf,
  failed,
  startOpen = false,
}: ImportExportOptions): {
  importDialog: ReactNode;
  openImport: () => void;
  exportCsv: () => void;
} {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(startOpen);

  const check = async (
    file: File,
  ): Promise<{ plan: ImportPlan } | { problem: FileProblem }> => {
    const read = await readText(file);
    if ("problem" in read) return read;
    const table = readTable(read.text);
    if ("problem" in table) return table;
    const list = current();
    if (!list) return { problem: { kind: "market-unavailable" } };

    const known = new Map<string, AssetChoice>();
    let top: AssetChoice[];
    try {
      top = assetsOf(await queryClient.query(snapshotQuery));
      for (const coin of top) known.set(coin.id, coin);
      const lookUp = coinsToLookUp(table.table, (id) => known.has(id));
      if ("problem" in lookUp) return lookUp;
      const asked = lookUp.ids;
      for (let at = 0; at < asked.length; at += MARKET_LIMITS.idsPerRequest) {
        const ids = asked.slice(at, at + MARKET_LIMITS.idsPerRequest);
        const prices = await queryClient.query(quotesQuery(userId, ids));
        for (const coin of assetsOf(prices)) known.set(coin.id, coin);
      }
    } catch {
      return { problem: { kind: "market-unavailable" } };
    }
    return planImport(table.table, {
      existing: list.records,
      stored: list.records.length + list.damaged.length,
      coinById: (id) => known.get(id),
      // The snapshot is largest first: a shared symbol means the larger coin.
      coinBySymbol: (symbol) =>
        top.find((coin) => coin.symbol.toUpperCase() === symbol.toUpperCase()),
      now: Date.now(),
    });
  };

  const run = (plan: ImportPlan, progress: (done: number) => void) => {
    const list = current();
    if (!list) return;
    const total = plan.added.length;
    importTransactions(
      access,
      list,
      plan.added.map(({ value }) => value),
      { progress },
    ).then(
      (next) => {
        if (!store(next)) return;
        setOpen(false);
        showToast(`${counted(total, "transaction", "transactions")} imported`, {
          tone: "success",
        });
      },
      (error: unknown) => {
        setOpen(false);
        if (error instanceof ImportStopped) {
          if (!store(error.list)) return;
          showToast("The import stopped", {
            tone: "error",
            description: `${String(error.written)} of ${counted(total, "transaction", "transactions")} were imported. Import the file again to add the rest: what's in already is skipped.`,
          });
        } else if (error instanceof TransactionError) {
          showToast("Your transactions changed meanwhile", {
            tone: "error",
            description: "Nothing was imported. Import the file again.",
          });
        } else {
          failed(error);
        }
      },
    );
  };

  const exportCsv = () => {
    const list = current();
    if (!list) return;
    const { text, rows, left } = transactionsCsv(
      list.records.map(({ value }) => value),
      assetOf,
    );
    downloadText(text, exportFileName(today(getLocalTimeZone()).toString()));
    const missing = [
      left > 0 &&
        `${counted(left, "split isn't", "splits aren't")} in it: the format has no column for them.`,
      list.damaged.length > 0 &&
        `${counted(list.damaged.length, "unreadable transaction isn't", "unreadable transactions aren't")} in it.`,
    ].filter((line) => line !== false);
    showToast(`${counted(rows, "transaction", "transactions")} exported`, {
      tone: "success",
      ...(missing.length > 0 && { description: missing.join(" ") }),
    });
  };

  return {
    importDialog: open && (
      <ImportDialog
        isOpen
        onOpenChange={setOpen}
        check={check}
        onImport={run}
      />
    ),
    openImport: () => {
      setOpen(true);
    },
    exportCsv,
  };
}
