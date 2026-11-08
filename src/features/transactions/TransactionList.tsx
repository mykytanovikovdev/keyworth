import { ArrowLeftRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button as AriaButton } from "react-aria-components";
import type { Transaction } from "../../../shared/schemas/transaction.ts";
import { ActionMenu, Button, Notice } from "../../ui/index.ts";
import { AssetLogo } from "./AssetLogo.tsx";
import { groupDigits, money, shortDate } from "./format.ts";

/*
 * Every transaction, newest first: on a wide screen in columns, on a phone in
 * two lines a row. A row opens its transaction to edit; its menu also deletes.
 */

export interface ListedTransaction {
  id: string;
  value: Transaction;
  symbol: string;
  name: string;
}

interface TransactionListProps {
  transactions: readonly ListedTransaction[];
  /** Records that cannot be read: left out of every figure. */
  damaged: number;
  useLogos?: boolean;
  onAdd?: () => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDeleteDamaged?: () => void;
}

const KIND_LABEL: Record<Transaction["type"], string> = {
  buy: "Buy",
  sell: "Sell",
  transfer_in: "Receive",
  income: "Income",
  transfer_out: "Send",
  split: "Split",
};

function amounts(transaction: Transaction, symbol: string) {
  switch (transaction.type) {
    case "buy":
    case "transfer_in":
    case "income":
    case "sell":
    case "transfer_out": {
      const sign =
        transaction.type === "sell" || transaction.type === "transfer_out"
          ? "−"
          : "+";
      const quantity = `${sign}${groupDigits(transaction.quantity)} ${symbol}`;
      if (transaction.type === "transfer_out") {
        return { quantity, price: null };
      }
      return {
        quantity,
        price: money(transaction.price, transaction.priceCurrency),
      };
    }
    case "split":
      return { quantity: `×${transaction.ratio}`, price: null };
  }
}

export function TransactionList({
  transactions,
  damaged,
  useLogos = true,
  onAdd,
  onEdit,
  onDelete,
  onDeleteDamaged,
}: TransactionListProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
        {transactions.length > 0 && (
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" />}
            {...(onAdd && { onPress: onAdd })}
          >
            Add transaction
          </Button>
        )}
      </div>
      {damaged > 0 && (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center gap-x-2">
            {damaged === 1
              ? "1 transaction can't be read and is left out of every figure."
              : `${String(damaged)} transactions can't be read and are left out of every figure.`}
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 h-6 px-1.5 text-warning"
              {...(onDeleteDamaged && { onPress: onDeleteDamaged })}
            >
              {damaged === 1 ? "Delete it" : "Delete them"}
            </Button>
          </span>
        </Notice>
      )}
      {transactions.length === 0 ? (
        <EmptyState {...(onAdd && { onAdd })} />
      ) : (
        <ul className="flex flex-col">
          <li
            aria-hidden="true"
            className="hidden grid-cols-[7rem_5.5rem_minmax(0,1fr)_9rem_9rem_2.25rem] gap-3 border-b border-line pb-2 text-xs text-fg-muted sm:grid"
          >
            <span>Date</span>
            <span>Type</span>
            <span>Coin</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Price</span>
            <span />
          </li>
          {transactions.map((entry) => {
            const { value } = entry;
            const { quantity, price } = amounts(value, entry.symbol);
            const kind = KIND_LABEL[value.type];
            const date = shortDate(value.executedAt);
            return (
              <li
                key={entry.id}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto_2.25rem] items-center gap-x-3 border-b border-line py-3 sm:grid-cols-[7rem_5.5rem_minmax(0,1fr)_9rem_9rem_2.25rem]"
              >
                {/* Phone: logo, two lines, menu. */}
                <span className="sm:hidden">
                  <AssetLogo
                    assetId={value.assetId}
                    symbol={entry.symbol}
                    useImage={useLogos}
                  />
                </span>
                <AriaButton
                  onPress={() => onEdit?.(entry.id)}
                  className="col-span-2 -mx-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md px-2 py-1 text-left transition-colors duration-(--kw-duration-fast) data-hovered:bg-hover sm:col-span-5 sm:grid-cols-[7rem_5.5rem_minmax(0,1fr)_9rem_9rem] sm:items-center"
                >
                  {/* The row's own text is its name (WCAG 2.5.3), after what pressing it does. */}
                  <span className="sr-only">Edit </span>
                  <span className="truncate text-sm font-medium sm:hidden">
                    {kind} · {entry.name}
                  </span>
                  <span className="text-right text-sm font-medium tabular-nums sm:hidden">
                    {quantity}
                  </span>
                  <span className="truncate text-xs text-fg-muted sm:hidden">
                    {date}
                    {value.note ? ` · ${value.note}` : ""}
                  </span>
                  <span className="text-right text-xs whitespace-nowrap text-fg-muted tabular-nums sm:hidden">
                    {price ?? ""}
                  </span>
                  {/* Wide screen: columns. */}
                  <span className="hidden text-sm text-fg-muted tabular-nums sm:block">
                    {date}
                  </span>
                  <span className="hidden text-sm sm:block">{kind}</span>
                  <span className="hidden min-w-0 items-center gap-2 sm:flex">
                    <AssetLogo
                      assetId={value.assetId}
                      symbol={entry.symbol}
                      size="sm"
                      useImage={useLogos}
                    />
                    <span className="truncate text-sm">{entry.name}</span>
                    <span className="text-sm text-fg-muted">
                      {entry.symbol}
                    </span>
                  </span>
                  <span className="hidden text-right text-sm tabular-nums sm:block">
                    {quantity}
                  </span>
                  <span className="hidden text-right text-sm text-fg-muted tabular-nums sm:block">
                    {price ?? "—"}
                  </span>
                </AriaButton>
                <ActionMenu
                  label={`Actions for ${kind} ${quantity} on ${date}`}
                  actions={[
                    {
                      id: "edit",
                      label: "Edit",
                      icon: <Pencil aria-hidden="true" />,
                    },
                    {
                      id: "delete",
                      label: "Delete",
                      icon: <Trash2 aria-hidden="true" />,
                    },
                  ]}
                  onAction={(action) => {
                    if (action === "edit") onEdit?.(entry.id);
                    if (action === "delete") onDelete?.(entry.id);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface text-fg-muted">
        <ArrowLeftRight aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold">No transactions yet</h2>
      <p className="max-w-sm text-base text-fg-muted">
        Add your purchases, sales and transfers. Each one is encrypted on this
        device before it&apos;s saved.
      </p>
      <Button
        variant="primary"
        icon={<Plus aria-hidden="true" />}
        className="mt-2"
        {...(onAdd && { onPress: onAdd })}
      >
        Add transaction
      </Button>
    </div>
  );
}
