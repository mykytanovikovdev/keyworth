import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import { Tooltip } from "./Tooltip.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent data-hovered:bg-accent/90 data-pressed:bg-accent/80",
  secondary:
    "border border-line bg-raised text-fg data-hovered:bg-hover data-pressed:bg-hover",
  ghost:
    "text-fg-muted data-hovered:bg-hover data-hovered:text-fg data-pressed:bg-hover data-pressed:text-fg",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3",
  md: "h-10 gap-2 px-4",
};

// State comes from React Aria's data attributes, not :hover, so touch devices
// never keep a "stuck" hover after a tap.
const base =
  "inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap select-none transition-colors duration-(--kw-duration-fast) data-disabled:cursor-not-allowed data-disabled:opacity-50 data-pending:cursor-wait";

interface ButtonProps extends Omit<
  AriaButtonProps,
  "className" | "style" | "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A Lucide icon before the label; replaced by a spinner while pending. */
  icon?: ReactNode;
  /** Layout only (margins, width); colors and sizes come from props. */
  className?: string;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {props.isPending ? (
        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
      ) : (
        icon
      )}
      {children}
    </AriaButton>
  );
}

interface IconButtonProps extends Omit<
  AriaButtonProps,
  "className" | "style" | "children" | "aria-label"
> {
  /** Accessible name, also shown as a tooltip on hover and keyboard focus. */
  label: string;
  /** A Lucide icon. */
  children: ReactNode;
  /** "primary" for the one main action of a view, such as Send. */
  variant?: "ghost" | "primary";
  tooltip?: boolean;
  /** Layout only (margins, position). */
  className?: string;
}

const iconVariants = {
  ghost:
    "text-fg-muted data-hovered:bg-hover data-hovered:text-fg data-pressed:bg-hover data-pressed:text-fg",
  primary:
    "bg-accent text-on-accent data-hovered:bg-accent/90 data-pressed:bg-accent/80",
};

export function IconButton({
  label,
  children,
  variant = "ghost",
  tooltip = true,
  className = "",
  ...props
}: IconButtonProps) {
  const button = (
    <AriaButton
      {...props}
      aria-label={label}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors duration-(--kw-duration-fast) data-disabled:cursor-not-allowed data-disabled:opacity-50 ${iconVariants[variant]} ${className}`}
    >
      {children}
    </AriaButton>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
