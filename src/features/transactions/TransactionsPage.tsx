import { Button, Notice, showToast, Skeleton } from "../../ui/index.ts";
import { useTransactionEditor } from "./editor.tsx";
import { access } from "./queries.ts";
import { deleteTransaction } from "./service.ts";
import { TransactionList as ListView } from "./TransactionList.tsx";

/*
 * The transactions page (`/transactions`): the list from the vault, with the
 * form that adds, edits and deletes through the service (`editor.tsx`, shared
 * with the portfolio page). Decrypted transactions live only under
 * ["vault", …].
 */

export function TransactionsPage() {
  const {
    transactions,
    assetOf,
    openAdd,
    openEdit,
    remove,
    current,
    store,
    failed,
    dialog,
  } = useTransactionEditor();

  const removeDamaged = async () => {
    let list = current();
    try {
      for (const id of list?.damaged ?? []) {
        if (!list) break;
        list = await deleteTransaction(access, list, id);
        store(list);
      }
      showToast("Unreadable transactions deleted");
    } catch (error) {
      failed(error);
    }
  };

  if (transactions.isPending) {
    return (
      <div
        aria-busy="true"
        className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-10 sm:px-6"
      >
        <Skeleton className="h-8 w-48" />
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (transactions.isError) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col items-start gap-4 px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
        <Notice tone="error">
          Your transactions couldn't load. Check your connection and try again.
        </Notice>
        <Button onPress={() => void transactions.refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <>
      <ListView
        transactions={[...transactions.data.records]
          .sort((a, b) => b.value.executedAt.localeCompare(a.value.executedAt))
          .map((record) => ({
            id: record.id,
            value: record.value,
            symbol: assetOf(record.value.assetId).symbol,
            name: assetOf(record.value.assetId).name,
          }))}
        damaged={transactions.data.damaged.length}
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={(id) => void remove(id)}
        onDeleteDamaged={() => void removeDamaged()}
      />
      {dialog}
    </>
  );
}
