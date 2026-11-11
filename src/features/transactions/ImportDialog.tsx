import { Check, CircleX, Equal, FileUp, Minus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cleanText } from "../../../shared/schemas/text.ts";
import {
  Button,
  buttonClassName,
  Dialog,
  DialogActions,
  Notice,
} from "../../ui/index.ts";
import { CSV_TEMPLATE } from "./csv-export.ts";
import {
  type FileProblem,
  fileProblemText,
  type ImportPlan,
} from "./csv-import.ts";
import { downloadText } from "./download.ts";
import { groupDigits } from "./format.ts";

/*
 * "Import transactions": pick a CSV file, see what it would add, skip and
 * refuse, then import. The file is read and checked on this device by
 * `check`; nothing is written until the import button is pressed, and then
 * `onImport` writes the plan's rows.
 */

export type ImportStep =
  | { kind: "choose"; problem?: FileProblem }
  | { kind: "checking"; name: string }
  | { kind: "preview"; name: string; plan: ImportPlan }
  | { kind: "importing"; name: string; plan: ImportPlan; done: number };

interface ImportDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Reads and checks a file: what importing it would do, or why it can't. */
  check: (
    file: File,
  ) => Promise<{ plan: ImportPlan } | { problem: FileProblem }>;
  /**
   * Writes the plan's rows and says how many are in so far. The page closes
   * the dialog and says how it went.
   */
  onImport: (plan: ImportPlan, progress: (done: number) => void) => void;
  /** The step to open on: the mockups show each one. */
  initial?: ImportStep;
}

/** Problems listed one by one; past that, a count. */
const LISTED = 100;

const count = (n: number) => groupDigits(String(n));

const plural = (n: number, one: string, many: string) =>
  `${count(n)} ${n === 1 ? one : many}`;

export function ImportDialog({
  isOpen,
  onOpenChange,
  check,
  onImport,
  initial = { kind: "choose" },
}: ImportDialogProps) {
  const [step, setStep] = useState<ImportStep>(initial);
  const busy = step.kind === "checking" || step.kind === "importing";

  const choose = (file: File | undefined) => {
    if (!file) return;
    // The name is the file's maker's text: shown as text, short, nothing hidden.
    const name = cleanText(file.name, 80);
    setStep({ kind: "checking", name });
    check(file).then(
      (result) => {
        setStep(
          "plan" in result
            ? { kind: "preview", name, plan: result.plan }
            : { kind: "choose", problem: result.problem },
        );
      },
      () => {
        setStep({ kind: "choose", problem: { kind: "not-text" } });
      },
    );
  };

  const picker = (label: string, variant: "primary" | "ghost") => (
    <FileButton
      label={label}
      variant={variant}
      isDisabled={busy}
      onSelect={choose}
    />
  );

  return (
    <Dialog
      title="Import transactions"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
    >
      {(close) => (
        <div className="mt-2 flex flex-col gap-4">
          {(step.kind === "choose" || step.kind === "checking") && (
            <>
              <p className="text-sm text-fg-muted">
                A CSV file in Keyworth&apos;s format: one made by Export to CSV,
                or the template filled in. It&apos;s read on this device and
                never uploaded; each transaction is encrypted before it&apos;s
                saved.
              </p>
              {step.kind === "choose" && step.problem && (
                <Notice tone="error">{fileProblemText(step.problem)}</Notice>
              )}
              {step.kind === "checking" && (
                <p className="text-sm" role="status">
                  Checking {step.name}…
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {picker("Choose a file", "primary")}
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    downloadText(CSV_TEMPLATE, "keyworth-template.csv");
                  }}
                >
                  Download the template
                </Button>
              </div>
              <DialogActions>
                <Button onPress={close} isDisabled={busy}>
                  Cancel
                </Button>
              </DialogActions>
            </>
          )}
          {(step.kind === "preview" || step.kind === "importing") && (
            <Preview
              step={step}
              picker={picker("Choose another", "ghost")}
              onCancel={close}
              onImport={() => {
                const { plan, name } = step;
                setStep({ kind: "importing", name, plan, done: 0 });
                onImport(plan, (done) => {
                  setStep({ kind: "importing", name, plan, done });
                });
              }}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Hover and press, as `hover:` and `active:` (a label has no React Aria state). */
const FILE_BUTTON_STATES = {
  primary: "hover:bg-accent/90 active:bg-accent/80",
  ghost: "hover:bg-hover hover:text-fg active:bg-hover active:text-fg",
} as const;

/**
 * Looks like a Button and opens the file picker. The file input is inside it,
 * visually hidden, so a tap lands on its label and the browser opens the
 * picker itself. React Aria's FileTrigger calls the input's `click()` from its
 * press handler instead, which Chrome on iOS honoured only every other tap,
 * and not at all after a download.
 */
function FileButton({
  label,
  variant,
  isDisabled,
  onSelect,
}: {
  label: string;
  variant: "primary" | "ghost";
  isDisabled: boolean;
  onSelect: (file: File | undefined) => void;
}) {
  return (
    <label
      {...(isDisabled && { "data-disabled": "" })}
      className={`${buttonClassName(variant, variant === "ghost" ? "sm" : "md")} ${FILE_BUTTON_STATES[variant]} cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus`}
    >
      <FileUp aria-hidden="true" />
      {label}
      <input
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={isDisabled}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          // Choosing the same file again is a change too.
          input.value = "";
          onSelect(file);
        }}
      />
    </label>
  );
}

function Preview({
  step,
  picker,
  onCancel,
  onImport,
}: {
  step: Extract<ImportStep, { kind: "preview" | "importing" }>;
  picker: ReactNode;
  onCancel: () => void;
  onImport: () => void;
}) {
  const { plan } = step;
  const importing = step.kind === "importing";
  const adding = plan.added.length;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm break-words text-fg-muted">
          {step.name} · {plural(plan.rows, "row", "rows")}
        </p>
        {!importing && <div className="-mx-2 -my-1">{picker}</div>}
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {adding === 0 ? (
          <li className="flex items-center gap-2 text-fg-muted">
            <Minus aria-hidden="true" className="shrink-0" />
            Nothing new to add
          </li>
        ) : (
          <li className="flex items-center gap-2">
            <Check aria-hidden="true" className="shrink-0" />
            {`${plural(adding, "new transaction", "new transactions")} to add`}
          </li>
        )}
        {plan.duplicates.length > 0 && (
          <li className="flex items-center gap-2 text-fg-muted">
            <Equal aria-hidden="true" className="shrink-0" />
            {`${plural(plan.duplicates.length, "row is", "rows are")} recorded already: skipped`}
          </li>
        )}
        {plan.problems.length > 0 && (
          <li className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-loss">
              <CircleX aria-hidden="true" className="shrink-0" />
              {`${plural(plan.problems.length, "row", "rows")} can't be imported: skipped`}
            </span>
            <ul className="ml-6 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md bg-surface px-3 py-2 text-fg-muted">
              {plan.problems.slice(0, LISTED).map(({ row, message }) => (
                <li key={row}>
                  <span className="font-medium text-fg">Row {count(row)}:</span>{" "}
                  {message}
                </li>
              ))}
              {plan.problems.length > LISTED && (
                <li>and {count(plan.problems.length - LISTED)} more</li>
              )}
            </ul>
          </li>
        )}
      </ul>
      <DialogActions>
        <Button onPress={onCancel} isDisabled={importing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          isDisabled={adding === 0}
          isPending={importing}
          onPress={onImport}
        >
          {importing
            ? step.done === 0
              ? "Importing…"
              : `Importing ${count(step.done)} of ${count(adding)}…`
            : adding === 0
              ? "Nothing to import"
              : `Import ${plural(adding, "transaction", "transactions")}`}
        </Button>
      </DialogActions>
    </>
  );
}
