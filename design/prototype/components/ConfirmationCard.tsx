import { Check, Pencil, X } from "lucide-react";
import { formatUsd } from "../format.ts";
import { Button } from "./Button.tsx";

interface Trade {
  type: string;
  asset: string;
  date: string;
  quantity: string;
  price: number;
  total: number;
}

/**
 * The only way a change reaches the vault: the user reads exactly what will be
 * recorded and confirms. The date is spelled out to remove 20.12.25 ambiguity.
 */
export function ConfirmationCard({
  trade,
  priceNote,
}: {
  trade: Trade;
  priceNote: string;
}) {
  const rows: [string, string][] = [
    ["Type", trade.type],
    ["Asset", trade.asset],
    ["Date", trade.date],
    ["Quantity", trade.quantity],
    ["Price", formatUsd(trade.price)],
    ["Total", formatUsd(trade.total)],
  ];

  return (
    <section
      aria-labelledby="confirm-title"
      className="kw-enter max-w-md rounded-lg border border-line bg-raised p-4 shadow-raised"
    >
      <h3 id="confirm-title" className="text-[15px] font-semibold">
        Record this trade?
      </h3>
      <p className="mt-0.5 text-sm text-fg-muted">
        Nothing is saved until you confirm.
      </p>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-right font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 flex items-start gap-2 rounded-md bg-gain-soft px-3 py-2 text-sm text-gain">
        <Check size={16} strokeWidth={2} className="mt-0.5 shrink-0" />
        {priceNote}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" icon={<Check size={16} strokeWidth={2} />}>
          Confirm
        </Button>
        <Button icon={<Pencil size={15} strokeWidth={1.75} />}>Edit</Button>
        <Button variant="ghost" icon={<X size={16} strokeWidth={1.75} />}>
          Reject
        </Button>
      </div>
    </section>
  );
}
