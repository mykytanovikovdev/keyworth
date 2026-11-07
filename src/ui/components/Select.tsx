import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";

export interface SelectOption {
  id: string;
  label: string;
}

interface SelectProps {
  label: string;
  /** Visually hidden, for a select whose meaning the surrounding text gives. */
  hideLabel?: boolean;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  isDisabled?: boolean;
  /** Layout only (margins, width). */
  className?: string;
}

/**
 * Pick one of a list, such as a currency; the choice applies at once. A long
 * list scrolls, and typing the first letters of a label jumps to it.
 *
 * Built as a menu of radio items (React Aria `Menu`), not React Aria's
 * `Select`: that one always adds a hidden native `<select>` for form autofill,
 * and WebKit reports creating any `<select>` as a CSP violation
 * (`style-src-attr`, from its own internals), which the strict CSP would show
 * in every Safari console. Keyboard, typeahead and screen readers work the same.
 */
export function Select({
  label,
  hideLabel = false,
  options,
  value,
  defaultValue,
  onChange,
  isDisabled = false,
  className = "",
}: SelectProps) {
  const [chosen, setChosen] = useState(defaultValue);
  const selected = value ?? chosen;
  const current = options.find((option) => option.id === selected);
  const labelId = useId();
  const valueId = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span
        id={labelId}
        className={hideLabel ? "sr-only" : "text-sm font-medium text-fg"}
      >
        {label}
      </span>
      <MenuTrigger>
        <AriaButton
          aria-labelledby={`${labelId} ${valueId}`}
          isDisabled={isDisabled}
          className="flex h-10 min-w-36 items-center justify-between gap-2 rounded-md border border-line-strong bg-raised px-3 text-sm text-fg transition-colors duration-(--kw-duration-fast) outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focus-visible:border-focus data-focus-visible:ring-1 data-focus-visible:ring-focus data-hovered:border-fg-muted"
        >
          <span id={valueId} className="truncate">
            {current?.label ?? "Choose…"}
          </span>
          <ChevronDown aria-hidden="true" className="text-fg-muted" />
        </AriaButton>
        <Popover
          placement="bottom start"
          // Never wider than the screen less React Aria's 12px margins: a long
          // label wraps instead of pushing the page sideways on a phone.
          className="w-max max-w-[calc(100vw-24px)] min-w-(--trigger-width) rounded-md border border-line bg-raised p-1 shadow-raised data-entering:animate-fade-in data-exiting:animate-fade-out"
        >
          <Menu
            aria-labelledby={labelId}
            items={options}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={selected === undefined ? [] : [selected]}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const [key] = [...keys];
              if (typeof key !== "string") return;
              setChosen(key);
              onChange?.(key);
            }}
            className="max-h-72 overflow-y-auto outline-none"
          >
            {(option) => (
              <MenuItem
                id={option.id}
                textValue={option.label}
                className="group flex cursor-default items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm text-fg outline-none data-focused:bg-hover"
              >
                {option.label}
                <Check
                  aria-hidden="true"
                  className="text-accent opacity-0 group-data-selected:opacity-100"
                />
              </MenuItem>
            )}
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
}
