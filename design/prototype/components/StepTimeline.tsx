import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";

export interface Step {
  label: string;
  detail: string;
}

interface StepTimelineProps {
  steps: Step[];
  /** How many steps have finished; the next one, if any, is running. */
  completed: number;
  summary: string;
  /** Whether the list stays open after every step has finished. */
  openWhenDone?: boolean;
}

/**
 * What the assistant did to answer: tool calls as a compact, expandable list.
 * Open while running, then folds into a one-line summary.
 */
export function StepTimeline({
  steps,
  completed,
  summary,
  openWhenDone = false,
}: StepTimelineProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const listId = useId();
  const running = completed < steps.length;
  const open = running || (userOpen ?? openWhenDone);
  const visible = steps.slice(0, Math.min(completed + 1, steps.length));
  const current = steps[completed];
  const heading = running && current ? `${current.label}…` : summary;

  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        disabled={running}
        onClick={() => {
          setUserOpen(!open);
        }}
        className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-fg-muted transition-colors duration-150 enabled:hover:text-fg"
      >
        {running ? (
          <LoaderCircle
            size={15}
            strokeWidth={2}
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Check size={15} strokeWidth={2} />
        )}
        {/* Keyed by its text, so every change of the line fades in again. */}
        <span key={heading} className="kw-step-fade">
          {heading}
        </span>
        {!running && (
          <ChevronDown
            size={15}
            strokeWidth={2}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      <div className="kw-collapsible" data-open={open}>
        <div>
          <ol
            id={listId}
            className="relative mt-2 ml-[7px] border-l border-line pl-4"
          >
            {visible.map((step, index) => {
              const done = index < completed;
              return (
                <li
                  key={step.label}
                  className="kw-step-fade relative pb-2.5 last:pb-0.5"
                >
                  <span
                    className={`absolute top-[5px] -left-[21px] flex size-[9px] rounded-full border-2 border-canvas ${done ? "bg-fg-muted" : "bg-accent motion-safe:animate-pulse"}`}
                  />
                  <span className="text-fg">{step.label}</span>
                  <span className="block text-fg-muted">{step.detail}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
