import { Eye, EyeOff } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { AllocationBar } from "../components/AllocationBar.tsx";
import { Change, HoldingsTable } from "../components/HoldingsTable.tsx";
import { ValueChart } from "../components/ValueChart.tsx";
import {
  holdings,
  octoberLabels,
  octoberValue,
  periods,
  portfolio,
} from "../data.ts";
import { formatCompactUsd, formatUsd } from "../format.ts";
import { revealInSequence } from "../motion.ts";

const HIDDEN = "••••••";

export function PortfolioScreen() {
  const [period, setPeriod] = useState<(typeof periods)[number]>("1M");
  const [hidden, setHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const sections = Array.from(
      rootRef.current?.querySelectorAll("[data-reveal]") ?? [],
    );
    return revealInSequence(sections);
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        ref={rootRef}
        className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-2 pb-16 md:px-8"
      >
        <section
          data-reveal
          className="flex flex-wrap items-end justify-between gap-4"
        >
          <div>
            <h2 className="text-sm text-fg-muted">Total value</h2>
            <p className="mt-1 text-4xl font-semibold tracking-tight">
              {hidden ? HIDDEN : formatUsd(portfolio.total)}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm">
              {hidden ? (
                <Change percent={portfolio.changePercent} />
              ) : (
                <Change
                  amount={portfolio.change}
                  percent={portfolio.changePercent}
                />
              )}
              <span className="text-fg-muted">this month</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Period"
              className="flex rounded-md bg-surface p-0.5"
            >
              {periods.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={value === period}
                  onClick={() => {
                    setPeriod(value);
                  }}
                  className={`rounded-[5px] px-3 py-1.5 text-sm transition-colors duration-150 ${value === period ? "bg-raised font-medium text-fg shadow-raised" : "text-fg-muted hover:text-fg"}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-pressed={hidden}
              onClick={() => {
                setHidden(!hidden);
              }}
              className="inline-flex size-9 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg"
              title={hidden ? "Show amounts" : "Hide amounts"}
              aria-label={hidden ? "Show amounts" : "Hide amounts"}
            >
              {hidden ? (
                <EyeOff size={18} strokeWidth={1.75} />
              ) : (
                <Eye size={18} strokeWidth={1.75} />
              )}
            </button>
          </div>
        </section>

        <section data-reveal aria-label="Value over time">
          <ValueChart
            values={octoberValue}
            labels={octoberLabels}
            format={hidden ? () => HIDDEN : formatUsd}
            formatTick={hidden ? () => "" : formatCompactUsd}
            label="Portfolio value from October 1 to 19, rising 4.2%"
            height={260}
          />
        </section>

        <section data-reveal>
          <h2 className="mb-4 text-[15px] font-semibold">Allocation</h2>
          <AllocationBar holdings={holdings} />
        </section>

        <section data-reveal>
          <h2 className="mb-2 text-[15px] font-semibold">Holdings</h2>
          <HoldingsTable holdings={holdings} />
        </section>
      </div>
    </div>
  );
}
