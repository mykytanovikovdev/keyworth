import type { ReactElement, ReactNode } from "react";
import {
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type TooltipProps as AriaTooltipProps,
} from "react-aria-components";

interface TooltipProps {
  /** Short text shown on hover and keyboard focus. */
  content: ReactNode;
  /** A focusable React Aria element, such as Button or ToggleButton. */
  children: ReactElement;
  placement?: AriaTooltipProps["placement"];
}

/**
 * A text label for an icon-only control, shown on hover and keyboard focus.
 * The control keeps its own aria-label: tooltips never appear on touch.
 */
export function Tooltip({
  content,
  children,
  placement = "top",
}: TooltipProps) {
  return (
    <TooltipTrigger delay={500} closeDelay={0}>
      {children}
      <AriaTooltip
        placement={placement}
        offset={6}
        className="max-w-60 rounded-sm bg-fg px-2 py-1 text-xs text-canvas data-entering:animate-fade-in data-exiting:animate-fade-out"
      >
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
