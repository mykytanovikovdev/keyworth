import { Copy, Download, Printer } from "lucide-react";
import { Button, showToast } from "../../ui/index.ts";

/** What Download saves and Print shows: the key exactly as on screen, with a title. */
function recoveryKeyText(recoveryKey: string): string {
  return `Keyworth recovery key\n\n${recoveryKey}\n\nIf you forget your passphrase, this key opens your data. Keep it offline or in a password manager.\n`;
}

function download(recoveryKey: string) {
  const url = URL.createObjectURL(
    new Blob([recoveryKeyText(recoveryKey)], { type: "text/plain" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "keyworth-recovery-key.txt";
  link.click();
  // After the click has started the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

async function copy(recoveryKey: string) {
  try {
    await navigator.clipboard.writeText(recoveryKey);
    showToast("Recovery key copied", { tone: "success" });
  } catch {
    showToast("Couldn't copy", {
      tone: "error",
      description: "Select the key and copy it, or download it instead.",
    });
  }
}

/**
 * Prints only the key: while `data-printing-key` is on <html>, the print
 * styles in src/ui/styles.css hide everything but `[data-print-key]`, also
 * when the panel sits in a dialog over another page.
 */
function print() {
  const root = document.documentElement;
  root.setAttribute("data-printing-key", "");
  window.addEventListener(
    "afterprint",
    () => {
      root.removeAttribute("data-printing-key");
    },
    { once: true },
  );
  window.print();
}

/**
 * The recovery key, shown once: nine groups of four in a 3 × 3 grid, easy to
 * compare with a written copy, and the three ways to keep it.
 */
export function RecoveryKeyPanel({ recoveryKey }: { recoveryKey: string }) {
  const groups = recoveryKey.split("-");
  return (
    <div className="flex flex-col gap-3">
      <div data-print-key="">
        <p className="mb-3 hidden text-lg font-semibold print:block">
          Keyworth recovery key
        </p>
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
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<Download aria-hidden="true" />}
          onPress={() => {
            download(recoveryKey);
          }}
        >
          Download
        </Button>
        <Button
          size="sm"
          icon={<Copy aria-hidden="true" />}
          onPress={() => void copy(recoveryKey)}
        >
          Copy
        </Button>
        <Button size="sm" icon={<Printer aria-hidden="true" />} onPress={print}>
          Print
        </Button>
      </div>
    </div>
  );
}
