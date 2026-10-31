import { Check } from "lucide-react";
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
  /** A second, quieter line under the label: what choosing it means. */
  description?: string;
  /** Layout only (margins, width). */
  className?: string;
}

/** A yes/no choice with a visible label; the label and the box are clickable. */
export function Checkbox({
  label,
  description,
  className = "",
  ...props
}: CheckboxProps) {
  return (
    <CheckboxField {...props} className={`flex flex-col gap-0.5 ${className}`}>
      <CheckboxButton className="group flex items-start gap-2.5 text-sm font-medium text-fg">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-raised text-on-accent transition-colors duration-(--kw-duration-fast) group-data-focus-visible:ring-2 group-data-focus-visible:ring-focus group-data-focus-visible:ring-offset-2 group-data-hovered:border-fg-muted group-data-selected:border-accent group-data-selected:bg-accent">
          <Check
            aria-hidden="true"
            size={12}
            strokeWidth={3}
            className="opacity-0 group-data-selected:opacity-100"
          />
        </span>
        {label}
      </CheckboxButton>
      {description && (
        <Text slot="description" className="pl-6.5 text-sm text-fg-muted">
          {description}
        </Text>
      )}
    </CheckboxField>
  );
}
