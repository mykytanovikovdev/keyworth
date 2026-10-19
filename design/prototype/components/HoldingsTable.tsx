import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Holding } from "../data.ts";
import {
  formatShare,
  formatSignedPercent,
  formatSignedUsd,
  formatUsd,
} from "../format.ts";

/** Gain or loss: sign, arrow and color together, never color alone. */
export function Change({
  amount,
  percent,
}: {
  amount?: number;
  percent: number;
}) {
  const tone =
    percent > 0 ? "text-gain" : percent < 0 ? "text-loss" : "text-fg-muted";
  const Icon =
    percent > 0 ? ArrowUpRight : percent < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${tone}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {amount !== undefined && <span>{formatSignedUsd(amount)}</span>}
      <span>
        {amount !== undefined
          ? `(${formatSignedPercent(percent)})`
          : formatSignedPercent(percent)}
      </span>
    </span>
  );
}

function AssetBadge({ symbol }: { symbol: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-semibold"
    >
      {symbol.slice(0, 3)}
    </span>
  );
}

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  return (
    <>
      {/* Wide screens: a table. */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-line text-left text-fg-muted">
            <th scope="col" className="py-2.5 font-medium">
              Asset
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Quantity
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Price
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Value
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Share
            </th>
            <th scope="col" className="py-2.5 text-right font-medium">
              Profit / loss
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <tr
              key={holding.symbol}
              className="border-b border-line last:border-b-0"
            >
              <th scope="row" className="py-3 text-left font-normal">
                <span className="flex items-center gap-3">
                  <AssetBadge symbol={holding.symbol} />
                  <span>
                    <span className="block font-medium">{holding.name}</span>
                    <span className="block text-fg-muted">
                      {holding.symbol}
                    </span>
                  </span>
                </span>
              </th>
              <td className="py-3 text-right tabular-nums">
                {holding.quantity}
              </td>
              <td className="py-3 text-right tabular-nums">
                {formatUsd(holding.price)}
              </td>
              <td className="py-3 text-right font-medium tabular-nums">
                {formatUsd(holding.value)}
              </td>
              <td className="py-3 text-right text-fg-muted tabular-nums">
                {formatShare(holding.share)}
              </td>
              <td className="py-3 text-right">
                <Change amount={holding.pnl} percent={holding.pnlPercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Narrow screens: one row per asset, the two numbers that matter. */}
      <ul className="divide-y divide-line md:hidden">
        {holdings.map((holding) => (
          <li
            key={holding.symbol}
            className="flex items-center gap-3 py-3 text-sm"
          >
            <AssetBadge symbol={holding.symbol} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{holding.name}</span>
              <span className="block text-fg-muted tabular-nums">
                {holding.quantity} {holding.symbol}
              </span>
            </span>
            <span className="text-right">
              <span className="block font-medium tabular-nums">
                {formatUsd(holding.value)}
              </span>
              <Change percent={holding.pnlPercent} />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
