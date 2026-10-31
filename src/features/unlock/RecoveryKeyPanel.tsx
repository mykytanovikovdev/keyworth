import { Copy, Download, Printer } from "lucide-react";
import { Button } from "../../ui/index.ts";

/**
 * The recovery key, shown once: nine groups of four in a 3 × 3 grid, easy to
 * compare with a written copy, and the three ways to keep it.
 */
export function RecoveryKeyPanel({ recoveryKey }: { recoveryKey: string }) {
  const groups = recoveryKey.split("-");
  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={`Recovery key: ${recoveryKey}`}
        className="grid grid-cols-3 gap-x-3 gap-y-2 rounded-lg border border-line bg-raised px-4 py-5 text-center text-lg font-medium tracking-wider tabular-nums shadow-raised"
      >
        {groups.map((group, index) => (
          <span key={index} aria-hidden="true">
            {group}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Download aria-hidden="true" />}>
          Download
        </Button>
        <Button size="sm" icon={<Copy aria-hidden="true" />}>
          Copy
        </Button>
        <Button size="sm" icon={<Printer aria-hidden="true" />}>
          Print
        </Button>
      </div>
    </div>
  );
}
