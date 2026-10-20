import type { HTMLAttributes } from "react";

export type CardTone = "raised" | "surface";

const tones: Record<CardTone, string> = {
  // Content that sits above the page: answers' cards, dialogs' contents.
  raised: "border border-line bg-raised shadow-raised",
  // Quiet grouping on the page itself: no border, no shadow.
  surface: "bg-surface",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
}

/** A container for related content. Padding and layout come from `className`. */
export function Card({ tone = "raised", className = "", ...props }: CardProps) {
  return (
    <div {...props} className={`rounded-lg ${tones[tone]} ${className}`} />
  );
}
