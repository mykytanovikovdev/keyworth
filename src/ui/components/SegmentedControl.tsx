import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

export interface SegmentOption {
  id: string;
  label: string;
}

interface SegmentedControlProps {
  /** Accessible name of the group: what is being chosen. */
  label: string;
  options: readonly SegmentOption[];
  value: string;
  onChange?: (id: string) => void;
  /** Segments share the width equally, as tabs at the top of a form do. */
  isFullWidth?: boolean;
  isDisabled?: boolean;
  /** Layout only (margins, width). */
  className?: string;
}

/**
 * One of a few options, all visible at once, such as a transaction's kind. It
 * looks like the theme toggle with labels: the chosen segment is raised.
 */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  isFullWidth = false,
  isDisabled = false,
  className = "",
}: SegmentedControlProps) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      isDisabled={isDisabled}
      onSelectionChange={(keys) => {
        const [key] = keys;
        if (typeof key === "string") onChange?.(key);
      }}
      className={`${isFullWidth ? "flex" : "inline-flex"} rounded-md bg-surface p-0.5 data-disabled:opacity-50 ${className}`}
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          className={`inline-flex h-8 min-w-0 items-center justify-center rounded-sm px-3 text-sm whitespace-nowrap text-fg-muted transition-colors duration-(--kw-duration-fast) data-hovered:text-fg data-selected:bg-raised data-selected:font-medium data-selected:text-fg data-selected:shadow-raised ${isFullWidth ? "flex-1 px-1" : ""}`}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
