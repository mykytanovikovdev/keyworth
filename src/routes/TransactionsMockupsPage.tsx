import { Settings } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import {
  FIAT_CURRENCIES,
  STABLECOINS,
} from "../../shared/schemas/currencies.ts";
import type { Transaction } from "../../shared/schemas/transaction.ts";
import {
  heldAt,
  ledgerProblems,
  parseTransaction,
} from "../features/transactions/check.ts";
import type { CoinSource } from "../features/transactions/coin-search.ts";
import {
  type AssetChoice,
  emptyValues,
  type FieldErrors,
  type FormValues,
  fromTransaction,
  problemErrors,
  toTransaction,
} from "../features/transactions/form-values.ts";
import {
  type ListedTransaction,
  TransactionList,
} from "../features/transactions/TransactionList.tsx";
import {
  type PriceOnDay,
  TransactionForm,
} from "../features/transactions/TransactionForm.tsx";
import { Section } from "../features/settings/Section.tsx";
import {
  ButtonLink,
  ComboBox,
  type ComboBoxOption,
  KeyworthMark,
  showToast,
  ThemeToggle,
} from "../ui/index.ts";

/*
 * Mockups of the 4.3b screens, for review before they are wired up (dev and
 * design builds only). Everything here is sample data in memory; the form's
 * refusals come from the real rules (check.ts). `?screen=<id>` opens one;
 * `&bare` hides the switcher, for screenshots.
 */

const coin = (id: string, symbol: string, name: string): AssetChoice => ({
  id: `crypto:${id}`,
  symbol,
  name,
});

const TOP: AssetChoice[] = [
  coin("bitcoin", "BTC", "Bitcoin"),
  coin("ethereum", "ETH", "Ethereum"),
  coin("tether", "USDT", "Tether"),
  coin("ripple", "XRP", "XRP"),
  coin("binancecoin", "BNB", "BNB"),
  coin("solana", "SOL", "Solana"),
  coin("usd-coin", "USDC", "USDC"),
  coin("dogecoin", "DOGE", "Dogecoin"),
  coin("cardano", "ADA", "Cardano"),
  coin("tron", "TRX", "TRON"),
  coin("chainlink", "LINK", "Chainlink"),
  coin("litecoin", "LTC", "Litecoin"),
  coin("polkadot", "DOT", "Polkadot"),
  coin("cosmos", "ATOM", "Cosmos Hub"),
];

/** Coins only "the server" knows, after a pause. */
const ELSEWHERE: AssetChoice[] = [
  coin("pepe", "PEPE", "Pepe"),
  coin("bonk", "BONK", "Bonk"),
  coin("pengu", "PENGU", "Pudgy Penguins"),
];

const COINS: CoinSource = {
  top: TOP,
  search: (text) =>
    new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (text.toLowerCase() === "error") reject(new Error("down"));
        const query = text.toLowerCase();
        resolve(
          ELSEWHERE.filter(
            (c) =>
              c.name.toLowerCase().includes(query) ||
              c.symbol.toLowerCase().startsWith(query),
          ),
        );
      }, 900);
    }),
};

const ALL_COINS = [...TOP, ...ELSEWHERE];
const symbolOf = (assetId: string) =>
  ALL_COINS.find((c) => c.id === assetId)?.symbol ?? "";

const CURRENCIES: ComboBoxOption[] = [
  ...FIAT_CURRENCIES.map(([code, name]) => ({
    id: code,
    label: code,
    detail: name,
  })),
  ...STABLECOINS.map((code) => ({
    id: code,
    label: code,
    detail: code === "USDT" ? "Tether" : "USD Coin",
  })),
].sort((a, b) => a.label.localeCompare(b.label, "en"));

const BASE_CURRENCIES: ComboBoxOption[] = [...FIAT_CURRENCIES]
  .sort(([, a], [, b]) => a.localeCompare(b, "en"))
  .map(([code, name]) => ({ id: code, label: name, detail: code }));

/** Sample prices: a made-up curve, close enough to look real. */
const PRICES: Record<string, number> = {
  BTC: 60000,
  ETH: 2300,
  SOL: 140,
  LTC: 62,
  DOGE: 0.16,
  XRP: 1.2,
  PEPE: 0.0000081,
};

const priceOn = (
  assetId: string,
  day: string,
  currency: string,
): Promise<PriceOnDay | null> => {
  const base = PRICES[symbolOf(assetId)];
  if (base === undefined) return Promise.resolve(null);
  const wobble = 1 + (Number(day.slice(8, 10)) % 7) / 100;
  const rate = currency === "EUR" ? 0.92 : currency === "GEL" ? 2.7 : 1;
  const price = (base * wobble * rate).toPrecision(8);
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve({
        price: String(Number(price)),
        source: ["BTC", "ETH", "SOL", "LTC", "DOGE", "XRP"].includes(
          symbolOf(assetId),
        )
          ? "Coin Metrics"
          : "CoinGecko",
      });
    }, 250);
  });
};

const tx = (
  id: string,
  value: Record<string, unknown>,
): { id: string; value: Transaction } => ({
  id,
  value: { source: "manual", ...value } as Transaction,
});

const SAMPLE: { id: string; value: Transaction }[] = [
  tx("t1", {
    type: "buy",
    assetId: "crypto:bitcoin",
    executedAt: "2025-03-14T12:00:00Z",
    quantity: "0.25",
    price: "81240.5",
    priceCurrency: "USD",
    fee: "12.4",
  }),
  tx("t2", {
    type: "buy",
    assetId: "crypto:ethereum",
    executedAt: "2025-06-02T12:00:00Z",
    quantity: "4.1",
    price: "2310.75",
    priceCurrency: "EUR",
  }),
  tx("t3", {
    type: "transfer_in",
    assetId: "crypto:solana",
    executedAt: "2025-08-19T12:00:00Z",
    quantity: "32",
    price: "0",
    priceCurrency: "USD",
    note: "Airdrop",
  }),
  tx("t4", {
    type: "income",
    assetId: "crypto:ethereum",
    executedAt: "2025-10-01T12:00:00Z",
    quantity: "0.042",
    price: "4120.18",
    priceCurrency: "USD",
    note: "Staking, September",
  }),
  tx("t5", {
    type: "sell",
    assetId: "crypto:bitcoin",
    executedAt: "2025-11-20T12:00:00Z",
    quantity: "0.05",
    price: "91870",
    priceCurrency: "USDT",
  }),
  tx("t6", {
    type: "transfer_out",
    assetId: "crypto:ethereum",
    executedAt: "2025-12-18T12:00:00Z",
    quantity: "1.2",
    note: "To the hardware wallet",
  }),
  tx("t7", {
    type: "buy",
    assetId: "crypto:litecoin",
    executedAt: "2025-12-20T12:00:00Z",
    quantity: "5",
    price: "60.03",
    priceCurrency: "USD",
  }),
];

const listed = (entries: readonly { id: string; value: Transaction }[]) =>
  [...entries]
    .sort((a, b) => b.value.executedAt.localeCompare(a.value.executedAt))
    .map((entry): ListedTransaction => {
      const found = ALL_COINS.find((c) => c.id === entry.value.assetId);
      return {
        ...entry,
        symbol: found?.symbol ?? "?",
        name: found?.name ?? entry.value.assetId,
      };
    });

interface DemoProps {
  start?: { id: string; value: Transaction }[];
  damaged?: number;
  /** Opens the form at once, with these fields. */
  open?: {
    mode: "add" | "edit";
    values: FormValues;
    id?: string;
    errors?: FieldErrors;
  };
}

/** The list and the form working together on sample data, as the app will. */
function Demo({ start = SAMPLE, damaged = 0, open }: DemoProps) {
  const [entries, setEntries] = useState(start);
  const [broken, setBroken] = useState(damaged);
  const [form, setForm] = useState<{
    mode: "add" | "edit";
    values: FormValues;
    id?: string;
  } | null>(open ?? null);
  const [errors, setErrors] = useState<FieldErrors>(open?.errors ?? {});
  const [pending, setPending] = useState(false);

  const openEdit = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    const asset = ALL_COINS.find((c) => c.id === entry?.value.assetId);
    if (!entry || !asset) return;
    setErrors({});
    setForm({
      mode: "edit",
      id,
      values: fromTransaction(entry.value, asset, "USD"),
    });
  };

  const remove = (id: string) => {
    const before = entries;
    const removed = entries.find((e) => e.id === id);
    const after = entries.filter((e) => e.id !== id);
    const problems = ledgerProblems(before, after);
    if (problems.length > 0) {
      showToast("Can't delete this transaction", {
        tone: "error",
        description:
          problemErrors(problems, {
            isThisOne: () => false,
            symbolOf,
          }).form ?? "",
      });
      return;
    }
    setEntries(after);
    setForm(null);
    showToast("Transaction deleted", {
      ...(removed && {
        action: {
          label: "Undo",
          onAction: () => {
            setEntries((current) => [...current, removed]);
          },
        },
      }),
    });
  };

  const submit = (values: FormValues) => {
    const now = Date.now();
    const parsed = parseTransaction(toTransaction(values, now), now);
    if ("problem" in parsed) {
      setErrors(
        problemErrors([parsed.problem], { isThisOne: () => true, symbolOf }),
      );
      return;
    }
    const id = form?.id ?? `new-${String(now)}`;
    const after = [
      ...entries.filter((e) => e.id !== id),
      { id, value: parsed.value },
    ];
    const problems = ledgerProblems(entries, after);
    if (problems.length > 0) {
      setErrors(
        problemErrors(problems, {
          isThisOne: (transactionId) => transactionId === id,
          symbolOf,
        }),
      );
      return;
    }
    setPending(true);
    window.setTimeout(() => {
      setPending(false);
      setEntries(after);
      setForm(null);
      showToast(form?.mode === "edit" ? "Changes saved" : "Transaction added", {
        tone: "success",
      });
    }, 500);
  };

  return (
    <MockShell>
      <TransactionList
        transactions={listed(entries)}
        damaged={broken}
        useLogos={false}
        onAdd={() => {
          setErrors({});
          setForm({ mode: "add", values: emptyValues("USD") });
        }}
        onEdit={openEdit}
        onDelete={remove}
        onDeleteDamaged={() => {
          setBroken(0);
          showToast("Unreadable transactions deleted");
        }}
      />
      {form && (
        <TransactionForm
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setForm(null);
          }}
          mode={form.mode}
          initial={form.values}
          coins={COINS}
          currencies={CURRENCIES}
          priceOn={priceOn}
          heldAt={(assetId, at) =>
            heldAt(entries, assetId, at, form.id).toString()
          }
          errors={errors}
          pending={pending}
          useLogos={false}
          onSubmit={submit}
          onEdit={() => {
            setErrors({});
          }}
          {...(form.id && {
            onDelete: () => {
              if (form.id) remove(form.id);
            },
          })}
        />
      )}
    </MockShell>
  );
}

function MockShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <KeyworthMark />
            <span className="max-[359px]:sr-only">Keyworth</span>
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ButtonLink
              href="/design/transactions?screen=settings-currency"
              variant="ghost"
              size="sm"
              icon={<Settings aria-hidden="true" />}
            >
              Settings
            </ButtonLink>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

function SettingsCurrency() {
  // Like Settings: the choice is saved, the field waits disabled meanwhile,
  // and the saved value arrives a moment after the press.
  const [stored, setStored] = useState("GEL");
  const [saving, setSaving] = useState<string | null>(null);
  return (
    <MockShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <Section
          title="Base currency"
          description="Totals, gains and charts are shown in this currency. Saved encrypted, like your trades."
        >
          <ComboBox
            label="Base currency"
            hideLabel
            placeholder="Search currencies"
            options={BASE_CURRENCIES}
            value={saving ?? stored}
            isDisabled={saving !== null}
            onChange={(currency) => {
              if (!currency || currency === stored) return;
              void Promise.resolve().then(() => {
                setSaving(currency);
                window.setTimeout(() => {
                  setStored(currency);
                  setSaving(null);
                }, 600);
              });
            }}
            emptyMessage="No currency matches."
            className="w-full sm:w-64"
          />
        </Section>
      </div>
    </MockShell>
  );
}

const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

const filled: FormValues = {
  ...emptyValues("USD"),
  asset: TOP[0] ?? null,
  day: "2025-12-20",
  quantity: "0.5",
  price: "60000.03",
};

const SCREENS: { id: string; label: string; render: () => ReactNode }[] = [
  { id: "list", label: "1. Transactions", render: () => <Demo /> },
  {
    id: "empty",
    label: "2. No transactions yet",
    render: () => <Demo start={[]} />,
  },
  {
    id: "damaged",
    label: "3. Some can't be read",
    render: () => <Demo damaged={2} />,
  },
  {
    id: "add",
    label: "4. Add: empty",
    render: () => <Demo open={{ mode: "add", values: emptyValues("USD") }} />,
  },
  {
    id: "add-filled",
    label: "5. Add: buy, filled",
    render: () => <Demo open={{ mode: "add", values: filled }} />,
  },
  {
    id: "add-fee",
    label: "6. Add: sell with a fee and a note",
    render: () => (
      <Demo
        open={{
          mode: "add",
          values: {
            ...filled,
            kind: "sell",
            quantity: "0.1",
            price: "91000",
            fee: "4.55",
            note: "Kraken",
          },
        }}
      />
    ),
  },
  {
    id: "add-receive",
    label: "7. Add: receive (income)",
    render: () => (
      <Demo
        open={{
          mode: "add",
          values: {
            ...filled,
            kind: "receive",
            asset: TOP[1] ?? null,
            quantity: "0.04",
            price: "",
            income: true,
            day: day(3),
          },
        }}
      />
    ),
  },
  {
    id: "add-send",
    label: "8. Add: send",
    render: () => (
      <Demo
        open={{
          mode: "add",
          values: {
            ...filled,
            kind: "send",
            asset: TOP[1] ?? null,
            quantity: "1.2",
          },
        }}
      />
    ),
  },
  {
    id: "add-sell-all",
    label: "8b. Add: sell, what was held that day",
    render: () => (
      <Demo
        open={{
          mode: "add",
          values: {
            ...filled,
            kind: "sell",
            quantity: "",
            price: "91000",
            day: "2025-12-01",
          },
        }}
      />
    ),
  },
  {
    id: "add-missing",
    label: "9. Add: fields missing",
    render: () => (
      <Demo
        open={{
          mode: "add",
          values: emptyValues("USD"),
          errors: {
            asset: "Choose a coin.",
            day: "Enter the date.",
            quantity: "Enter a quantity greater than zero, such as 0.5.",
            price: "Enter the price per coin, such as 60000.03.",
          },
        }}
      />
    ),
  },
  {
    id: "add-oversold",
    label: "10. Add: selling more than held",
    render: () => (
      <Demo
        open={{
          mode: "add",
          values: {
            ...filled,
            kind: "sell",
            quantity: "0.3",
            day: "2025-12-01",
          },
          errors: { quantity: "You held 0.2 BTC on December 1, 2025." },
        }}
      />
    ),
  },
  {
    id: "add-later-short",
    label: "11. Add: a later sale left short",
    render: () => (
      <Demo
        open={{
          mode: "add",
          values: {
            ...filled,
            kind: "sell",
            quantity: "0.18",
            day: "2025-04-01",
          },
          errors: {
            form: "This would leave your 0.05 BTC going out on November 20, 2025 short: only 0.02 BTC would be left by then.",
          },
        }}
      />
    ),
  },
  {
    id: "edit",
    label: "12. Edit",
    render: () => {
      const entry = SAMPLE[1];
      const asset = TOP[1];
      return entry && asset ? (
        <Demo
          open={{
            mode: "edit",
            id: entry.id,
            values: fromTransaction(entry.value, asset, "USD"),
          }}
        />
      ) : null;
    },
  },
  {
    id: "edit-elsewhere",
    label: "13. Edit: changed on another device",
    render: () => {
      const entry = SAMPLE[1];
      const asset = TOP[1];
      return entry && asset ? (
        <Demo
          open={{
            mode: "edit",
            id: entry.id,
            values: fromTransaction(entry.value, asset, "USD"),
            errors: {
              form: "This transaction changed on another device. Its current version is shown below.",
            },
          }}
        />
      ) : null;
    },
  },
  {
    id: "settings-currency",
    label: "14. Settings: base currency search",
    render: () => <SettingsCurrency />,
  },
];

export default function TransactionsMockupsPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [screenId, setScreenId] = useState(params.get("screen") ?? "list");
  const screen = SCREENS.find((entry) => entry.id === screenId) ?? SCREENS[0];
  return (
    <>
      <Fragment key={screenId}>{screen?.render()}</Fragment>
      {!params.has("bare") && (
        <div className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-lg border border-line bg-raised p-2 shadow-raised">
          <label className="sr-only" htmlFor="mockup-screen">
            Screen
          </label>
          <select
            id="mockup-screen"
            value={screen?.id}
            onChange={(event) => {
              setScreenId(event.target.value);
              const url = new URL(window.location.href);
              url.searchParams.set("screen", event.target.value);
              window.history.replaceState(null, "", url);
            }}
            className="h-8 max-w-48 rounded-md border border-line-strong bg-raised px-2 text-sm text-fg"
          >
            {SCREENS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
