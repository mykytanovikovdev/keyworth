import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type NoticeTone = "error" | "warning" | "info";

const tones: Record<NoticeTone, { className: string; icon: ReactNode }> = {
  error: {
    className: "bg-loss-soft text-loss",
    icon: <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" />,
  },
  warning: {
    className: "bg-warning-soft text-warning",
    icon: <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0" />,
  },
  info: {
    className: "bg-surface text-fg-muted",
    icon: <Info aria-hidden="true" className="mt-0.5 shrink-0" />,
  },
};

/**
 * A short message inside a page or form: an error the user must act on, a
 * warning, or a note. Errors are announced (`role="alert"`); the others are not.
 */
export function Notice({
  tone,
  children,
  className = "",
}: {
  tone: NoticeTone;
  children: ReactNode;
  /** Layout only (margins). */
  className?: string;
}) {
  return (
    <p
      {...(tone === "error" && { role: "alert" })}
      className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-sm ${tones[tone].className} ${className}`}
    >
      {tones[tone].icon}
      <span>{children}</span>
    </p>
  );
}
