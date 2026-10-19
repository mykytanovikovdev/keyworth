import { useLayoutEffect, useRef } from "react";
import type { Holding, SeriesSlot } from "../data.ts";
import { formatShare } from "../format.ts";
import { growInSequence, revealInSequence } from "../motion.ts";

// Color follows the asset, never its rank.
const fill: Record<SeriesSlot, string> = {
  1: "bg-series-1",
  2: "bg-series-2",
  3: "bg-series-3",
  4: "bg-series-4",
  5: "bg-series-5",
};

/** Portfolio shares as one stacked bar; every segment is also labelled in text. */
export function AllocationBar({ holdings }: { holdings: Holding[] }) {
  const barRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const segments = Array.from(barRef.current?.children ?? []);
    const items = Array.from(legendRef.current?.children ?? []);
    const stopBar = growInSequence(segments);
    const stopLegend = revealInSequence(items, 200);
    return () => {
      stopBar();
      stopLegend();
    };
  }, []);

  return (
    <figure>
      <div ref={barRef} className="flex h-3 gap-0.5" aria-hidden="true">
        {holdings.map((holding) => (
          <div
            key={holding.symbol}
            className={`h-full origin-left first:rounded-l-[4px] last:rounded-r-[4px] ${fill[holding.slot]}`}
            style={{ flexGrow: holding.share }}
          />
        ))}
      </div>
      <figcaption className="sr-only">Allocation by asset</figcaption>
      <ul
        ref={legendRef}
        className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm"
      >
        {holdings.map((holding) => (
          <li key={holding.symbol} className="flex items-center gap-2">
            <span
              className={`size-2.5 rounded-[3px] ${fill[holding.slot]}`}
              aria-hidden="true"
            />
            <span className="font-medium">{holding.symbol}</span>
            <span className="text-fg-muted tabular-nums">
              {formatShare(holding.share)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
