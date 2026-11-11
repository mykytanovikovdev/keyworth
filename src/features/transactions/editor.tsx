import { getLocalTimeZone, today } from "@internationalized/date";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { FIAT_CURRENCIES } from "../../../shared/schemas/currencies.ts";
import { DEFAULT_BASE_CURRENCY } from "../../../shared/schemas/settings.ts";
import { type ComboBoxOption, showToast } from "../../ui/index.ts";
import { sessionQuery } from "../auth/client.ts";
import { settingsQuery } from "../settings/settings-record.ts";
import { failureMessage } from "../unlock/messages.ts";
import { type CoinSource, heldCoins } from "./coin-search.ts";
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
  outsideSnapshot,
  priceOnDay,
  quotesQuery,
  searchCoins,
  snapshotQuery,
} from "./market.ts";
import { heldAt, heldNow } from "./check.ts";
import { access, transactionsQuery } from "./queries.ts";
import {
  deleteTransaction,
  keepIfUnlocked,
  saveTransaction,
  TransactionError,
  type TransactionList,
} from "./service.ts";
import { TransactionForm } from "./TransactionForm.tsx";

/*
 * Adding, editing and deleting a transaction, for any page: the form, the
 * service's refusals in words, deleting with Undo, and the names of the coins
 * the user holds. The transactions page and the portfolio page share it, so
 * there is one way to change a transaction. Decrypted transactions live only
 * under ["vault", …].
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

const choiceIn = (
  known: ReadonlyMap<string, AssetChoice>,
  assetId: string,
): AssetChoice =>
  known.get(assetId) ?? {
    id: assetId,
    symbol: fallbackSymbol(assetId),
    name: fallbackSymbol(assetId),
  };

interface OpenForm {
  mode: "add" | "edit";
  id?: string;
  values: FormValues;
  /** A new one starts the form over: a newer version came from another device. */
  key: number;
}

export function useTransactionEditor() {
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
  const records = useMemo(
    () => transactions.data?.records ?? [],
    [transactions.data],
  );
  // Coins outside the snapshot, by id: their names and today's prices (a
  // coin just picked in the form is named already, but still needs a price).
  const outsideIds = useMemo(
    () =>
      outsideSnapshot(
        snapshot.data,
        records.map(({ value }) => value.assetId),
      ),
    [snapshot.data, records],
  );
  const outside = useQuery(quotesQuery(userId, outsideIds));
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
  const assetOf = (id: string): AssetChoice => choiceIn(assets, id);
  // Today's prices in dollars: they order the coins held by value.
  const prices = useMemo(
    () =>
      new Map(
        [...(snapshot.data?.quotes ?? []), ...(outside.data?.quotes ?? [])].map(
          (quote) => [quote.id, quote.price],
        ),
      ),
    [snapshot.data, outside.data],
  );

  const coins: CoinSource = useMemo(
    () => ({ top, search: searchCoins }),
    [top],
  );
  // Today's prices already here are used before any coin is asked for by
  // name; "today" is read at each call, so a tab left open past midnight
  // moves on.
  const priceOn = useMemo(
    () => (assetId: string, day: string, currency: string) =>
      priceOnDay(assetId, day, currency, localToday(), (id) => prices.get(id)),
    [prices],
  );

  const [form, setForm] = useState<OpenForm | null>(null);
  const formOpen = form !== null;
  const editing = form?.id;
  // What a sale or a send in the form can take from.
  const held = useMemo(
    () =>
      formOpen
        ? heldCoins(
            heldNow(records, editing),
            (id) => choiceIn(assets, id),
            (id) => prices.get(id),
          )
        : [],
    [formOpen, records, editing, assets, prices],
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const key = transactionsQuery(userId).queryKey;
  const current = () => queryClient.getQueryData<TransactionList>(key);
  const store = (list: TransactionList) =>
    keepIfUnlocked(access, list, (kept) => {
      queryClient.setQueryData(key, kept);
    });
  const failed = (error: unknown) => {
    const { title, description } = failureMessage(error);
    showToast(title, { tone: "error", description });
  };

  const open = (next: Omit<OpenForm, "key">) => {
    setErrors({});
    setForm({ ...next, key: Date.now() });
  };
  const openAdd = () => {
    open({ mode: "add", values: emptyValues(baseCurrency) });
  };
  const openEdit = (id: string) => {
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

  const dialog: ReactNode = form && (
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
      heldAt={(assetId, at) => heldAt(records, assetId, at, form.id).toString()}
      heldCoins={held}
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
  );

  return {
    userId,
    transactions,
    snapshot,
    outside,
    baseCurrency,
    assetOf,
    openAdd,
    openEdit,
    remove,
    current,
    store,
    failed,
    /** The form when open; render it anywhere on the page. */
    dialog,
  };
}
