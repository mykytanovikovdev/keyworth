import { Check, Minus } from "lucide-react";
import {
  CheckboxButton,
  CheckboxField,
  type CheckboxFieldProps,
  Text,
} from "react-aria-components";

interface CheckboxProps extends Omit<
  CheckboxFieldProps,
  "className" | "style" | "children"
> {
  label: string;
  /**
   * The label for screen readers only, where what is chosen is already on
   * screen beside the box (a row of a list).
   */
  hideLabel?: boolean;
  /** A second, quieter line under the label: what choosing it means. */
  description?: string;
  /** Layout only (margins, width). */
  className?: string;
}

/**
 * A yes/no choice with a visible label; the label and the box are clickable.
 * `isIndeterminate` shows a dash: some of several are chosen ("all" boxes).
 */
export function Checkbox({
  label,
  hideLabel = false,
  description,
  className = "",
  ...props
}: CheckboxProps) {
  return (
    <CheckboxField {...props} className={`flex flex-col gap-0.5 ${className}`}>
      <CheckboxButton className="group flex items-start gap-2.5 text-sm font-medium text-fg">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-raised text-on-accent transition-colors duration-(--kw-duration-fast) group-data-focus-visible:ring-2 group-data-focus-visible:ring-focus group-data-focus-visible:ring-offset-2 group-data-hovered:border-fg-muted group-data-indeterminate:border-accent group-data-indeterminate:bg-accent group-data-selected:border-accent group-data-selected:bg-accent">
          <Check
            aria-hidden="true"
            size={12}
            strokeWidth={3}
            className="hidden group-data-indeterminate:hidden group-data-selected:block"
          />
          <Minus
            aria-hidden="true"
            size={12}
            strokeWidth={3}
            className="hidden group-data-indeterminate:block"
          />
        </span>
        <span className={hideLabel ? "sr-only" : ""}>{label}</span>
      </CheckboxButton>
      {description && (
        <Text slot="description" className="pl-6.5 text-sm text-fg-muted">
          {description}
        </Text>
      )}
    </CheckboxField>
  );
}
