import {
  ArrowLeftRight,
  Download,
  FileUp,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import type { Transaction } from "../../../shared/schemas/transaction.ts";
import { ActionMenu, Button, Checkbox, Notice } from "../../ui/index.ts";
import { AssetLogo } from "./AssetLogo.tsx";
import { groupDigits, KIND_LABEL, money, shortDate } from "./format.ts";

/*
 * Every transaction, newest first: on a wide screen in columns, on a phone in
 * two lines a row. A row opens its transaction to edit; its menu also deletes.
 * "Select transactions" turns the menus into boxes, to delete several at once;
 * "Delete all transactions" asks once, on the page.
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
  /** Opens "Import transactions". */
  onImport?: () => void;
  /** Saves every transaction as a CSV file. */
  onExport?: () => void;
  /** Deletes the transactions chosen in select mode. */
  onDeleteSelected?: (ids: readonly string[]) => void;
  /** Asks to delete every transaction. */
  onDeleteAll?: () => void;
  /** Opens in select mode with these chosen (the design page's states). */
  defaultSelected?: readonly string[];
}

// Wide-screen columns: date, type, coin, quantity, price, then the menu; while
// selecting, the box comes first and the menu goes.
const COLUMNS = "sm:grid-cols-[7rem_5.5rem_minmax(0,1fr)_9rem_9rem_2.25rem]";
const COLUMNS_SELECTING =
  "sm:grid-cols-[2rem_7rem_5.5rem_minmax(0,1fr)_9rem_9rem]";

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
      // Received for nothing (an airdrop): "Free" reads as meant, $0.00 as a bug.
      const free =
        transaction.type !== "buy" &&
        transaction.type !== "sell" &&
        !/[1-9]/.test(transaction.price);
      return {
        quantity,
        price: free
          ? "Free"
          : money(transaction.price, transaction.priceCurrency),
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
  onImport,
  onExport,
  onDeleteSelected,
  onDeleteAll,
  defaultSelected,
}: TransactionListProps) {
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(
    defaultSelected ? new Set(defaultSelected) : null,
  );
  const selecting = selected !== null && transactions.length > 0;
  const chosen = transactions.filter(({ id }) => selected?.has(id));
  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
        {transactions.length > 0 && !selecting && (
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              icon={<Plus aria-hidden="true" />}
              {...(onAdd && { onPress: onAdd })}
            >
              Add transaction
            </Button>
            <ActionMenu
              label="More actions"
              actions={[
                {
                  id: "import",
                  label: "Import from CSV…",
                  icon: <FileUp aria-hidden="true" />,
                },
                {
                  id: "export",
                  label: "Export to CSV",
                  icon: <Download aria-hidden="true" />,
                },
                {
                  id: "select",
                  label: "Select transactions",
                  icon: <ListChecks aria-hidden="true" />,
                },
                {
                  id: "delete-all",
                  label: "Delete all transactions…",
                  icon: <Trash2 aria-hidden="true" />,
                },
              ]}
              onAction={(id) => {
                if (id === "import") onImport?.();
                else if (id === "export") onExport?.();
                else if (id === "select") setSelected(new Set());
                else onDeleteAll?.();
              }}
            />
          </div>
        )}
      </div>
      {selecting && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2">
          <div className="flex items-center gap-3">
            <Checkbox
              label="Select all"
              isSelected={chosen.length === transactions.length}
              isIndeterminate={
                chosen.length > 0 && chosen.length < transactions.length
              }
              onChange={(all) => {
                setSelected(
                  new Set(all ? transactions.map(({ id }) => id) : []),
                );
              }}
            />
            <span
              className="text-sm text-fg-muted tabular-nums"
              aria-live="polite"
            >
              {chosen.length === 0
                ? "None selected"
                : `${String(chosen.length)} selected`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 aria-hidden="true" />}
              isDisabled={chosen.length === 0}
              onPress={() => {
                onDeleteSelected?.(chosen.map(({ id }) => id));
                setSelected(null);
              }}
            >
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setSelected(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
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
        <EmptyState {...(onAdd && { onAdd })} {...(onImport && { onImport })} />
      ) : (
        <ul className="flex flex-col">
          <li
            aria-hidden="true"
            className={`hidden gap-3 border-b border-line pb-2 text-xs text-fg-muted sm:grid ${selecting ? COLUMNS_SELECTING : COLUMNS}`}
          >
            {selecting && <span />}
            <span>Date</span>
            <span>Type</span>
            <span>Coin</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Price</span>
            {!selecting && <span />}
          </li>
          {transactions.map((entry) => {
            const { value } = entry;
            const { quantity, price } = amounts(value, entry.symbol);
            const kind = KIND_LABEL[value.type];
            const date = shortDate(value.executedAt);
            return (
              <li
                key={entry.id}
                className={`grid items-center gap-x-3 border-b border-line py-3 ${selecting ? `grid-cols-[2rem_minmax(0,1fr)_auto] ${COLUMNS_SELECTING}` : `grid-cols-[2rem_minmax(0,1fr)_auto_2.25rem] ${COLUMNS}`}`}
              >
                {/* Selecting: the box first, where the eye starts (the logo's place on a phone). */}
                {selecting ? (
                  <span className="flex justify-center">
                    <Checkbox
                      label={`Select ${kind} ${quantity} on ${date}`}
                      hideLabel
                      isSelected={selected.has(entry.id)}
                      onChange={() => {
                        toggle(entry.id);
                      }}
                    />
                  </span>
                ) : (
                  // Phone: logo, two lines, menu.
                  <span className="sm:hidden">
                    <AssetLogo
                      assetId={value.assetId}
                      symbol={entry.symbol}
                      useImage={useLogos}
                    />
                  </span>
                )}
                <AriaButton
                  onPress={() => {
                    if (selecting) toggle(entry.id);
                    else onEdit?.(entry.id);
                  }}
                  className="col-span-2 -mx-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md px-2 py-1 text-left transition-colors duration-(--kw-duration-fast) data-hovered:bg-hover sm:col-span-5 sm:grid-cols-[7rem_5.5rem_minmax(0,1fr)_9rem_9rem] sm:items-center"
                >
                  {/* The row's own text is its name (WCAG 2.5.3), after what pressing it does. */}
                  <span className="sr-only">
                    {selecting
                      ? selected.has(entry.id)
                        ? "Deselect "
                        : "Select "
                      : "Edit "}
                  </span>
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
                {!selecting && (
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
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({
  onAdd,
  onImport,
}: {
  onAdd?: () => void;
  onImport?: () => void;
}) {
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
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          {...(onAdd && { onPress: onAdd })}
        >
          Add transaction
        </Button>
        <Button
          variant="ghost"
          icon={<FileUp aria-hidden="true" />}
          {...(onImport && { onPress: onImport })}
        >
          Import from a file
        </Button>
      </div>
    </div>
  );
}
