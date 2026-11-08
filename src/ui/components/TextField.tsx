import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { fieldBoxClassName } from "./field-styles.ts";

interface TextFieldProps extends Omit<
  AriaTextFieldProps,
  "className" | "style" | "children" | "validationBehavior"
> {
  label: string;
  description?: string;
  /** Shown, and announced, when `isInvalid` is true. */
  errorMessage?: string;
  placeholder?: string;
  /** A unit inside the field, after what is typed: "BTC". */
  suffix?: string;
  /** Layout only (margins, width). */
  className?: string;
}

/**
 * A labelled single-line text input. Validation is driven by the caller (zod
 * schemas in shared/), so the field reports errors through ARIA instead of the
 * browser's native validation bubbles.
 */
export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  suffix,
  className = "",
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField
      {...props}
      validationBehavior="aria"
      className={`flex flex-col gap-1.5 ${className}`}
    >
      <Label className="text-sm font-medium text-fg">{label}</Label>
      <div className="relative">
        <Input
          {...(placeholder !== undefined && { placeholder })}
          className={`h-10 px-3 ${suffix ? "pr-16" : ""} ${fieldBoxClassName}`}
        />
        {suffix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-muted"
          >
            {suffix}
          </span>
        )}
      </div>
      {description && (
        <Text slot="description" className="text-xs text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-xs font-medium text-loss">
        {errorMessage}
      </FieldError>
    </AriaTextField>
  );
}
