import { getLocalTimeZone, today } from "@internationalized/date";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FIAT_CURRENCIES } from "../../../shared/schemas/currencies.ts";
import { DEFAULT_BASE_CURRENCY } from "../../../shared/schemas/settings.ts";
import {
  Button,
  type ComboBoxOption,
  Notice,
  showToast,
  Skeleton,
} from "../../ui/index.ts";
import { sessionQuery } from "../auth/client.ts";
import { settingsQuery } from "../settings/settings-record.ts";
import { failureMessage } from "../unlock/messages.ts";
import type { CoinSource } from "./coin-search.ts";
import {
  type AssetChoice,
  emptyValues,
  type FieldErrors,
  type FormValues,
  fromTransaction,
  problemErrors,
  toTransaction,
} from "./form-values.ts";
import {
  assetsOf,
  priceOnDay,
  quotesQuery,
  searchCoins,
  snapshotQuery,
} from "./market.ts";
import { access, transactionsQuery } from "./queries.ts";
import {
  deleteTransaction,
  saveTransaction,
  TransactionError,
  type TransactionList,
} from "./service.ts";
import { TransactionForm } from "./TransactionForm.tsx";
import { TransactionList as ListView } from "./TransactionList.tsx";

/*
 * The transactions page (the app's home until the portfolio arrives in 4.4):
 * the list from the vault, the form that adds and edits through the service,
 * deleting with Undo. Decrypted transactions live only under ["vault", …].
 */

const PRICE_CURRENCIES: ComboBoxOption[] = [
  ...FIAT_CURRENCIES.map(([code, name]) => ({
    id: code,
    label: code,
    detail: name,
  })),
  { id: "USDT", label: "USDT", detail: "Tether" },
  { id: "USDC", label: "USDC", detail: "USD Coin" },
].sort((a, b) => a.label.localeCompare(b.label, "en"));

const localToday = () => today(getLocalTimeZone()).toString();

/** "crypto:bitcoin" → "BITCOIN", until the coin's real symbol is known. */
const fallbackSymbol = (assetId: string) =>
  (assetId.split(":")[1] ?? assetId).toUpperCase();

interface OpenForm {
  mode: "add" | "edit";
  id?: string;
  values: FormValues;
  /** A new one starts the form over: a newer version came from another device. */
  key: number;
}

export function TransactionsPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const userId = session?.user.id ?? "";
  const queryClient = useQueryClient();
  const transactions = useQuery(transactionsQuery(userId));
  const settings = useQuery(settingsQuery(userId));
  const snapshot = useQuery(snapshotQuery);
  const baseCurrency =
    settings.data?.value?.baseCurrency ?? DEFAULT_BASE_CURRENCY;

  // Coins picked in the form this visit: named at once, before any query.
  const [picked, setPicked] = useState<ReadonlyMap<string, AssetChoice>>(
    new Map(),
  );
  const top = useMemo(() => assetsOf(snapshot.data), [snapshot.data]);
  const records = transactions.data?.records ?? [];
  const unnamed = [
    ...new Set(records.map(({ value }) => value.assetId)),
  ].filter((id) => !top.some((coin) => coin.id === id) && !picked.has(id));
  const outside = useQuery(quotesQuery(userId, unnamed));
  const assets = useMemo(() => {
    const known = new Map<string, AssetChoice>();
    for (const coin of [
      ...top,
      ...assetsOf(outside.data),
      ...picked.values(),
    ]) {
      known.set(coin.id, coin);
    }
    return known;
  }, [top, outside.data, picked]);
  const assetOf = (id: string): AssetChoice =>
    assets.get(id) ?? {
      id,
      symbol: fallbackSymbol(id),
      name: fallbackSymbol(id),
    };

  const coins: CoinSource = useMemo(
    () => ({ top, search: searchCoins }),
    [top],
  );
  const priceOn = useMemo(
    () => (assetId: string, day: string, currency: string) =>
      priceOnDay(assetId, day, currency, localToday()),
    [],
  );

  const [form, setForm] = useState<OpenForm | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const key = transactionsQuery(userId).queryKey;
  const current = () => queryClient.getQueryData<TransactionList>(key);
  const store = (list: TransactionList) => {
    queryClient.setQueryData(key, list);
  };
  const failed = (error: unknown) => {
    const { title, description } = failureMessage(error);
    showToast(title, { tone: "error", description });
  };

  const open = (next: Omit<OpenForm, "key">) => {
    setErrors({});
    setForm({ ...next, key: Date.now() });
  };

  const submit = async (values: FormValues) => {
    const list = current();
    if (!list || !form) return;
    setPending(true);
    try {
      const next = await saveTransaction(access, list, {
        ...(form.id && { id: form.id }),
        value: toTransaction(values, Date.now()),
      });
      if (values.asset) {
        const asset = values.asset;
        setPicked((known) => new Map(known).set(asset.id, asset));
      }
      store(next);
      setForm(null);
      showToast(form.mode === "add" ? "Transaction added" : "Changes saved", {
        tone: "success",
      });
    } catch (error) {
      if (!(error instanceof TransactionError)) {
        failed(error);
        return;
      }
      setErrors(
        problemErrors(error.problems, {
          isThisOne: (id) =>
            id === form.id || !list.records.some((r) => r.id === id),
          symbolOf: (assetId) => assetOf(assetId).symbol,
        }),
      );
      if (error.latest) {
        store(error.latest);
        const latest = error.latest.records.find((r) => r.id === form.id);
        if (form.id && !latest) {
          setForm(null);
          showToast("This transaction was deleted on another device", {
            tone: "error",
          });
        } else if (latest) {
          setForm({
            ...form,
            values: fromTransaction(
              latest.value,
              assetOf(latest.value.assetId),
              baseCurrency,
            ),
            key: Date.now(),
          });
        }
      }
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    const list = current();
    const removed = list?.records.find((record) => record.id === id);
    if (!list) return;
    try {
      store(await deleteTransaction(access, list, id));
      setForm(null);
    } catch (error) {
      if (error instanceof TransactionError) {
        const { form: message, quantity } = problemErrors(error.problems, {
          isThisOne: () => false,
          symbolOf: (assetId) => assetOf(assetId).symbol,
        });
        showToast("Can't delete this transaction", {
          tone: "error",
          description: message ?? quantity ?? "",
        });
      } else failed(error);
      return;
    }
    if (!removed) return;
    showToast("Transaction deleted", {
      action: {
        label: "Undo",
        onAction: () => {
          const now = current();
          if (!now) return;
          // Put back as it was, under a new id: the old record is gone.
          saveTransaction(access, now, { value: removed.value }).then(
            store,
            failed,
          );
        },
      },
    });
  };

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
        transactions={[...records]
          .sort((a, b) => b.value.executedAt.localeCompare(a.value.executedAt))
          .map((record) => ({
            id: record.id,
            value: record.value,
            symbol: assetOf(record.value.assetId).symbol,
            name: assetOf(record.value.assetId).name,
          }))}
        damaged={transactions.data.damaged.length}
        onAdd={() => {
          open({ mode: "add", values: emptyValues(baseCurrency) });
        }}
        onEdit={(id) => {
          const record = records.find((r) => r.id === id);
          if (!record) return;
          open({
            mode: "edit",
            id,
            values: fromTransaction(
              record.value,
              assetOf(record.value.assetId),
              baseCurrency,
            ),
          });
        }}
        onDelete={(id) => void remove(id)}
        onDeleteDamaged={() => void removeDamaged()}
      />
      {form && (
        <TransactionForm
          key={form.key}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setForm(null);
          }}
          mode={form.mode}
          initial={form.values}
          coins={coins}
          currencies={PRICE_CURRENCIES}
          priceOn={priceOn}
          errors={errors}
          pending={pending}
          onSubmit={(values) => void submit(values)}
          onEdit={() => {
            setErrors({});
          }}
          {...(form.id && {
            onDelete: () => {
              if (form.id) void remove(form.id);
            },
          })}
        />
      )}
    </>
  );
}
