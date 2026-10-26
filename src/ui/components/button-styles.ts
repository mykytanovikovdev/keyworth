// Button variants as class names, shared by Button and ButtonLink so a link
// that acts as a button looks exactly like one.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent data-hovered:bg-accent/90 data-pressed:bg-accent/80",
  secondary:
    "border border-line bg-raised text-fg data-hovered:bg-hover data-pressed:bg-hover",
  ghost:
    "text-fg-muted data-hovered:bg-hover data-hovered:text-fg data-pressed:bg-hover data-pressed:text-fg",
  // Only for the final confirmation of an irreversible deletion.
  danger:
    "bg-loss text-on-loss data-hovered:bg-loss-hover data-pressed:bg-loss-pressed",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3",
  md: "h-10 gap-2 px-4",
};

// State comes from React Aria's data attributes, not :hover, so touch devices
// never keep a "stuck" hover after a tap.
const base =
  "inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap select-none transition-colors duration-(--kw-duration-fast) data-disabled:cursor-not-allowed data-disabled:opacity-50 data-pending:cursor-wait";

export function buttonClassName(variant: ButtonVariant, size: ButtonSize) {
  return `${base} ${sizes[size]} ${variants[variant]}`;
}
