import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "gain" | "loss" | "warning";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface text-fg-muted ring-1 ring-line ring-inset",
  accent: "bg-accent-soft text-accent",
  gain: "bg-gain-soft text-gain",
  loss: "bg-loss-soft text-loss",
  warning: "bg-warning-soft text-warning",
};

interface BadgeProps {
  tone?: BadgeTone;
  /**
   * A Lucide icon. Status tones (gain, loss, warning) need one, or a sign in the
   * text: color is never the only signal.
   */
  icon?: ReactNode;
  children: ReactNode;
}

/** A short status or category label. Not interactive. */
export function Badge({ tone = "neutral", icon, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
