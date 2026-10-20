import type { ReactNode } from "react";
import { Link as AriaLink } from "react-aria-components";
import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from "./button-styles.ts";

/*
 * Links navigate; buttons act. Both are React Aria components, so links get the
 * same hover, press and focus states. Navigation inside the app goes through
 * the router wired into UIProvider, so these stay router-agnostic.
 */

interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children: ReactNode;
  /** Layout only (margins, width). */
  className?: string;
}

/** A link styled as a button, for navigation that reads as an action. */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  children,
  className = "",
}: ButtonLinkProps) {
  return (
    <AriaLink
      href={href}
      className={`${buttonClassName(variant, size)} ${className}`}
    >
      {icon}
      {children}
    </AriaLink>
  );
}

interface TextLinkProps {
  href: string;
  children: ReactNode;
}

/** An inline link in running text. Underlined, so it never relies on color. */
export function TextLink({ href, children }: TextLinkProps) {
  return (
    <AriaLink
      href={href}
      className="rounded-sm text-fg underline decoration-line-strong underline-offset-4 transition-colors duration-(--kw-duration-fast) data-hovered:text-accent data-hovered:decoration-accent"
    >
      {children}
    </AriaLink>
  );
}
