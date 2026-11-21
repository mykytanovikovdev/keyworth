import { Check, ChevronDown, LoaderCircle, RotateCcw } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Button, Notice } from "../../ui/index.ts";

/** A question, on the right in a bubble, as typed (line breaks kept). */
export function UserMessage({ children }: { children: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-xl rounded-br-sm bg-bubble px-4 py-2.5 text-base break-words whitespace-pre-wrap">
        {children}
      </p>
    </div>
  );
}

/** An answer: what was looked at, the text, then how it ended if not well. */
export function AssistantMessage({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

export interface ToolStep {
  /** What was done, in the past tense: "Looked at your portfolio". */
  label: string;
  /** What exactly, and what the AI received: "Shares and changes; amounts stayed on this device". */
  detail: string;
  /** While running: "Looking at your portfolio". */
  running: string;
}

interface ToolStepsProps {
  steps: readonly ToolStep[];
  /** How many have finished; the next one, if any, is running. */
  done: number;
}

/**
 * What the assistant looked at to answer. While it works, one line says what
 * it is doing now; afterwards the line sums up and opens into the list, each
 * step saying what the AI received (amounts only when asked).
 */
export function ToolSteps({ steps, done }: ToolStepsProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const running = done < steps.length;
  const current = steps[done];
  // Afterwards, the steps in one line: "Looked at your portfolio, calculated the month".
  const summary = steps
    .map(({ label }, index) =>
      index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1),
    )
    .join(", ");
  const heading = running && current ? `${current.running}…` : summary;
  const visible = steps.slice(0, Math.min(done + 1, steps.length));

  return (
    <div className="text-sm">
      <AriaButton
        aria-expanded={running ? true : open}
        aria-controls={listId}
        isDisabled={running}
        onPress={() => {
          setOpen(!open);
        }}
        className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-fg-muted transition-colors duration-(--kw-duration-fast) data-hovered:text-fg"
      >
        {running ? (
          <LoaderCircle
            aria-hidden="true"
            className="motion-safe:animate-spin"
          />
        ) : (
          <Check aria-hidden="true" />
        )}
        {/* Keyed by its text, so each new line fades in. */}
        <span key={heading} className="animate-step">
          {heading}
        </span>
        {!running && (
          <ChevronDown
            aria-hidden="true"
            className={`transition-transform duration-(--kw-duration-base) ${open ? "rotate-180" : ""}`}
          />
        )}
      </AriaButton>
      <div className="collapsible" data-open={running || open}>
        <div>
          <ol id={listId} className="mt-2 ml-[7px] border-l border-line pl-4">
            {visible.map((step, index) => (
              <li
                // Steps only append, and two can say the same thing.
                key={index}
                className="relative animate-step pb-2.5 last:pb-0.5"
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-[5px] -left-[21px] size-[9px] rounded-full border-2 border-canvas ${
                    index < done
                      ? "bg-fg-muted"
                      : "bg-accent motion-safe:animate-pulse"
                  }`}
                />
                <span className="text-fg">
                  {index < done ? step.label : step.running}
                </span>
                <span className="block text-fg-muted">{step.detail}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** Under an answer that was stopped part way. */
export function StoppedNote() {
  return <p className="text-xs text-fg-muted">You stopped this answer.</p>;
}

/** Under an answer that broke off: why, and a way to ask again. */
export function AnswerFailed({
  reason,
  onRetry,
}: {
  reason: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Notice tone="error">{reason}</Notice>
      <Button
        size="sm"
        icon={<RotateCcw aria-hidden="true" />}
        onPress={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}
