import {
  type CalendarDate,
  getLocalTimeZone,
  parseDate,
  today,
} from "@internationalized/date";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { decimal } from "../../../shared/money/decimal.ts";
import { MARKET_LIMITS } from "../../../shared/schemas/market.ts";
import { typedText } from "../../../shared/schemas/text.ts";
import { TRANSACTION_LIMITS } from "../../../shared/schemas/transaction.ts";
import {
  Button,
  Checkbox,
  ComboBox,
  type ComboBoxOption,
  DateField,
  Dialog,
  DialogActions,
  Notice,
  SegmentedControl,
  TextField,
} from "../../ui/index.ts";
import { AssetLogo } from "./AssetLogo.tsx";
import { type CoinSource, useCoinSearch } from "./coin-search.ts";
import {
  type FieldErrors,
  fieldErrors,
  type FormKind,
  type FormValues,
  AMOUNT_MAX_LENGTH,
  executedAt,
  parseAmount,
  typedAmount,
} from "./form-values.ts";
import { money, quantity as quantityText, shortDate } from "./format.ts";

/*
 * Adding or editing one transaction. The dialog keeps the fields; what they
 * make is checked by the transaction service, whose refusals come back as
 * `errors` next to the field they concern. The fields start from `initial`
 * once: to start over (a newer version from another device), give the form a
 * new `key`.
 */

const KINDS = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "receive", label: "Receive" },
  { id: "send", label: "Send" },
] as const;

const isKind = (id: string): id is FormKind =>
  KINDS.some((kind) => kind.id === id);

export interface PriceOnDay {
  /** Plain digits, in the price currency. */
  price: string;
  /** Whose price it is, said after it: "Coin Metrics", "CoinGecko". */
  source: string;
}

interface TransactionFormProps {
  isOpen: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  mode: "add" | "edit";
  initial: FormValues;
  coins: CoinSource;
  /** Price currencies: the fiat ones and the two stablecoins. */
  currencies: readonly ComboBoxOption[];
  /** A coin's price on a day in a currency, to offer as the price. */
  priceOn?: (
    assetId: string,
    day: string,
    currency: string,
  ) => Promise<PriceOnDay | null>;
  /**
   * Units of a coin held at a moment (plain digits), leaving out the
   * transaction being edited: what "All" fills in on a sale or a send.
   */
  heldAt?: (assetId: string, executedAt: string) => string;
  /** The service's refusals, in words. */
  errors?: FieldErrors;
  pending?: boolean;
  /** Logos from the server; off in mockups. */
  useLogos?: boolean;
  onSubmit?: (values: FormValues) => void;
  /** A field changed: refusals shown so far no longer apply. */
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TransactionForm({
  isOpen,
  onOpenChange,
  mode,
  initial,
  coins,
  currencies,
  priceOn,
  heldAt,
  errors = {},
  pending = false,
  useLogos = true,
  onSubmit,
  onEdit,
  onDelete,
}: TransactionFormProps) {
  const [values, setValues] = useState(initial);
  // "Now" for a sale dated today: when the form opened is close enough.
  const [openedAt] = useState(() => Date.now());
  const [coinText, setCoinText] = useState(initial.asset?.name ?? "");
  const [checked, setChecked] = useState(false);
  const [feeOpen, setFeeOpen] = useState(initial.fee !== "");
  const [noteOpen, setNoteOpen] = useState(initial.note !== "");
  const search = useCoinSearch(coins, coinText, values.asset);
  const hint = usePriceOnDay(values, priceOn);

  const update = (change: Partial<FormValues>) => {
    setValues((current) => ({ ...current, ...change }));
    onEdit?.();
  };
  const shown: FieldErrors = {
    ...errors,
    ...(checked ? fieldErrors(values) : {}),
  };
  const coinOptions: ComboBoxOption[] = [
    ...(values.asset && !search.coins.some((c) => c.id === values.asset?.id)
      ? [values.asset]
      : []),
    ...search.coins,
  ].map((coin) => ({
    id: coin.id,
    label: coin.name,
    detail: coin.symbol,
    icon: (
      <AssetLogo
        assetId={coin.id}
        symbol={coin.symbol}
        size="sm"
        useImage={useLogos}
      />
    ),
  }));
  const trade = values.kind === "buy" || values.kind === "sell";
  // A sale or a send can take everything held that day, to the last digit.
  const takesOut = values.kind === "sell" || values.kind === "send";
  const held =
    takesOut && values.asset && values.day && heldAt
      ? heldAt(values.asset.id, executedAt(values.day, openedAt))
      : null;
  const heldLine =
    held !== null && values.day && values.asset
      ? `Held on ${shortDate(values.day)}: ${quantityText(held, values.asset.symbol)}`
      : null;
  const total = totalOf(values);
  const symbol = values.asset?.symbol ?? "";

  return (
    <Dialog
      title={mode === "add" ? "Add transaction" : "Edit transaction"}
      isOpen={isOpen}
      {...(onOpenChange && { onOpenChange })}
    >
      {(close) => (
        <form
          noValidate
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setChecked(true);
            if (Object.keys(fieldErrors(values)).length > 0) return;
            onSubmit?.(values);
          }}
        >
          {shown.form && (
            <Notice
              tone={
                shown.form.startsWith("This transaction changed")
                  ? "warning"
                  : "error"
              }
            >
              {shown.form}
            </Notice>
          )}
          <SegmentedControl
            label="Kind of transaction"
            options={KINDS}
            value={values.kind}
            isFullWidth
            onChange={(id) => {
              if (isKind(id)) update({ kind: id });
            }}
          />
          <ComboBox
            label="Coin"
            placeholder="Search coins"
            options={coinOptions}
            value={values.asset?.id ?? null}
            inputValue={coinText}
            maxLength={MARKET_LIMITS.queryLength}
            onInputChange={setCoinText}
            onChange={(id) => {
              const coin =
                search.coins.find((c) => c.id === id) ??
                (values.asset?.id === id ? values.asset : null);
              update({ asset: coin });
              if (coin) setCoinText(coin.name);
            }}
            isLoading={search.isLoading}
            emptyMessage={search.emptyMessage}
            isInvalid={shown.asset !== undefined}
            {...(shown.asset && { errorMessage: shown.asset })}
          />
          <DateField
            label="Date"
            value={values.day ? parseDate(values.day) : null}
            maxValue={today(getLocalTimeZone())}
            onChange={(day: CalendarDate | null) => {
              update({ day: day ? day.toString() : null });
            }}
            action={
              <Button
                variant="ghost"
                onPress={() => {
                  update({ day: today(getLocalTimeZone()).toString() });
                }}
              >
                Today
              </Button>
            }
            isInvalid={shown.day !== undefined}
            {...(shown.day && { errorMessage: shown.day })}
          />
          <TextField
            label="Quantity"
            inputMode="decimal"
            autoComplete="off"
            maxLength={AMOUNT_MAX_LENGTH}
            value={values.quantity}
            onChange={(quantity) => {
              update({ quantity: typedAmount(quantity, values.quantity) });
            }}
            {...(symbol && { suffix: symbol })}
            {...(takesOut && {
              action: (
                <Button
                  variant="ghost"
                  isDisabled={held === null || !/[1-9]/.test(held)}
                  onPress={() => {
                    if (held !== null) update({ quantity: held });
                  }}
                >
                  All
                </Button>
              ),
            })}
            {...((heldLine !== null || values.kind === "send") && {
              description: (
                <>
                  {heldLine && <span className="block">{heldLine}</span>}
                  {values.kind === "send" && (
                    <span className="block">
                      Include the network fee, if it was paid in this coin.
                    </span>
                  )}
                </>
              ),
            })}
            isInvalid={shown.quantity !== undefined}
            {...(shown.quantity && { errorMessage: shown.quantity })}
          />
          {values.kind !== "send" && (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[1fr_7.5rem] items-start gap-2">
                <TextField
                  label={
                    values.kind === "receive"
                      ? "Value per coin"
                      : "Price per coin"
                  }
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={AMOUNT_MAX_LENGTH}
                  value={values.price}
                  onChange={(price) => {
                    update({ price: typedAmount(price, values.price) });
                  }}
                  isInvalid={shown.price !== undefined}
                  {...(shown.price && { errorMessage: shown.price })}
                />
                <ComboBox
                  label="Currency"
                  options={currencies}
                  value={values.priceCurrency}
                  onChange={(id) => {
                    if (id) update({ priceCurrency: id });
                  }}
                  emptyMessage="No currency matches."
                  showDetail={false}
                />
              </div>
              {hint && (
                <p className="text-xs text-fg-muted">
                  Price that day: {money(hint.price, values.priceCurrency)} (
                  {hint.source}) ·{" "}
                  <AriaButton
                    onPress={() => {
                      update({ price: hint.price });
                    }}
                    className="rounded-sm font-medium text-accent underline-offset-2 data-hovered:underline"
                  >
                    Use this price
                  </AriaButton>
                </p>
              )}
            </div>
          )}
          {values.kind === "receive" && (
            <Checkbox
              label="Income"
              description="Staking, interest or rewards: counted as earnings, not as money you put in."
              isSelected={values.income}
              onChange={(income) => {
                update({ income });
              }}
            />
          )}
          {trade && feeOpen && (
            <TextField
              label="Fee"
              inputMode="decimal"
              autoComplete="off"
              maxLength={AMOUNT_MAX_LENGTH}
              value={values.fee}
              suffix={values.priceCurrency}
              onChange={(fee) => {
                update({ fee: typedAmount(fee, values.fee) });
              }}
              isInvalid={shown.fee !== undefined}
              {...(shown.fee && { errorMessage: shown.fee })}
            />
          )}
          {noteOpen && (
            <TextField
              label="Note"
              value={values.note}
              maxLength={TRANSACTION_LIMITS.noteLength}
              onChange={(note) => {
                update({
                  note: typedText(note, TRANSACTION_LIMITS.noteLength),
                });
              }}
              isInvalid={shown.note !== undefined}
              {...(shown.note && { errorMessage: shown.note })}
            />
          )}
          {((trade && !feeOpen) || !noteOpen) && (
            <div className="-my-1 flex gap-1">
              {trade && !feeOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus aria-hidden="true" />}
                  onPress={() => {
                    setFeeOpen(true);
                  }}
                >
                  Add fee
                </Button>
              )}
              {!noteOpen && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus aria-hidden="true" />}
                  onPress={() => {
                    setNoteOpen(true);
                  }}
                >
                  Add note
                </Button>
              )}
            </div>
          )}
          {trade && (
            <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
              <span className="text-fg-muted">
                {values.kind === "buy" ? "Total paid" : "Total received"}
              </span>
              <span className="font-medium tabular-nums">
                {total ? money(total, values.priceCurrency) : "—"}
              </span>
            </div>
          )}
          <DialogActions>
            {mode === "edit" && onDelete && (
              <Button variant="ghost" className="sm:mr-auto" onPress={onDelete}>
                Delete
              </Button>
            )}
            <Button onPress={close} isDisabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={pending}>
              {mode === "add" ? "Add transaction" : "Save changes"}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

/** What a trade comes to: quantity times price, plus the fee on a buy, minus it on a sale. */
function totalOf(values: FormValues): string | null {
  const amount = parseAmount(values.quantity);
  const price = parseAmount(values.price);
  if (!amount || !price) return null;
  const gross = decimal(amount).times(decimal(price));
  const fee = values.fee.trim() ? parseAmount(values.fee) : "0";
  if (fee === null) return null;
  const total =
    values.kind === "sell"
      ? gross.minus(decimal(fee))
      : gross.plus(decimal(fee));
  return total.toFixed(2);
}

function usePriceOnDay(
  values: FormValues,
  priceOn: TransactionFormProps["priceOn"],
): PriceOnDay | null {
  const [hint, setHint] = useState<{ key: string; value: PriceOnDay | null }>({
    key: "",
    value: null,
  });
  const key =
    values.asset && values.day
      ? `${values.asset.id}|${values.day}|${values.priceCurrency}`
      : "";
  useEffect(() => {
    if (!key || !priceOn || !values.asset || !values.day) return;
    let current = true;
    priceOn(values.asset.id, values.day, values.priceCurrency).then(
      (value) => {
        if (current) setHint({ key, value });
      },
      () => {
        if (current) setHint({ key, value: null });
      },
    );
    return () => {
      current = false;
    };
  }, [key, priceOn, values.asset, values.day, values.priceCurrency]);
  return hint.key === key ? hint.value : null;
}
