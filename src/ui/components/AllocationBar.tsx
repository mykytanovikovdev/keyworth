import { useLayoutEffect, useRef } from "react";
import { chartDuration, revealInSequence, wipeFromLeft } from "../motion.ts";

export interface AllocationSegment {
  id: string;
  /** Written in the legend, such as "BTC" or "Other". */
  label: string;
  /** From 0 to 1. */
  share: number;
  /** A data color, 1 to 5, that follows the item; null is the neutral "Other". */
  slot: 1 | 2 | 3 | 4 | 5 | null;
}

const fill: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "bg-series-1",
  2: "bg-series-2",
  3: "bg-series-3",
  4: "bg-series-4",
  5: "bg-series-5",
};
const fillOf = (slot: AllocationSegment["slot"]) =>
  slot === null ? "bg-line-strong" : fill[slot];

const PERCENT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

/**
 * Shares as one stacked bar, each segment also written in the legend, so
 * color is never the only way to tell them apart. The bar fills left to right;
 * the legend follows as it passes.
 */
export function AllocationBar({
  segments,
  label = "Allocation",
}: {
  segments: readonly AllocationSegment[];
  /** For screen readers. */
  label?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const items = Array.from(legendRef.current?.children ?? []);
    const stopBar = wipeFromLeft(barRef.current);
    const stopLegend = revealInSequence(items, chartDuration() * 0.35);
    return () => {
      stopBar();
      stopLegend();
    };
  }, []);

  return (
    <figure>
      <div ref={barRef} className="flex h-3 gap-0.5" aria-hidden="true">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className={`h-full min-w-1 first:rounded-l-[4px] last:rounded-r-[4px] ${fillOf(segment.slot)}`}
            style={{ flexGrow: segment.share }}
          />
        ))}
      </div>
      <figcaption className="sr-only">{label}</figcaption>
      <ul
        ref={legendRef}
        className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm"
      >
        {segments.map((segment) => (
          <li key={segment.id} className="flex items-center gap-2">
            <span
              className={`size-2.5 rounded-[3px] ${fillOf(segment.slot)}`}
              aria-hidden="true"
            />
            <span className="font-medium">{segment.label}</span>
            <span className="text-fg-muted tabular-nums">
              {PERCENT.format(segment.share)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
