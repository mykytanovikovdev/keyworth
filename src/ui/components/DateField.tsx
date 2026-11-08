import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";
import {
  DateField as AriaDateField,
  DateInput,
  DateSegment,
  FieldError,
  I18nProvider,
  Label,
  Text,
} from "react-aria-components";

const IN_WORDS = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

interface DateFieldProps {
  label: string;
  value: CalendarDate | null;
  onChange?: (value: CalendarDate | null) => void;
  /** The latest day allowed, such as today. */
  maxValue?: CalendarDate;
  /** Next to the field, such as a "Today" button. */
  action?: ReactNode;
  /** Shown, and announced, when `isInvalid` is true. */
  errorMessage?: string;
  isInvalid?: boolean;
  isDisabled?: boolean;
  /** Layout only (margins, width). */
  className?: string;
}

/**
 * A day typed as day / month / year, the order most of the world writes it,
 * and repeated in words below ("December 20, 2025"), so 03/04 can never be
 * read the wrong way round.
 */
export function DateField({
  label,
  value,
  onChange,
  maxValue,
  action,
  errorMessage,
  isInvalid = false,
  isDisabled = false,
  className = "",
}: DateFieldProps) {
  return (
    <I18nProvider locale="en-GB">
      <AriaDateField
        value={value}
        onChange={(next) => {
          onChange?.(next);
        }}
        {...(maxValue && { maxValue })}
        isInvalid={isInvalid}
        isDisabled={isDisabled}
        validationBehavior="aria"
        granularity="day"
        className={`flex flex-col gap-1.5 ${className}`}
      >
        <Label className="text-sm font-medium text-fg">{label}</Label>
        <div className="flex items-center gap-2">
          <DateInput className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-line-strong bg-raised px-3 text-md text-fg tabular-nums transition-colors duration-(--kw-duration-fast) data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focus-within:border-focus data-focus-within:ring-1 data-focus-within:ring-focus data-hovered:border-fg-muted data-invalid:border-loss data-invalid:data-focus-within:ring-loss">
            {(segment) => (
              <DateSegment
                segment={segment}
                className="rounded-sm px-0.5 outline-none data-focused:bg-accent data-focused:text-on-accent data-placeholder:text-fg-muted data-[type=literal]:px-0 data-[type=literal]:text-fg-muted"
              />
            )}
          </DateInput>
          {action}
        </div>
        <Text slot="description" className="text-xs text-fg-muted">
          {value ? IN_WORDS.format(value.toDate("UTC")) : "Day, month, year"}
        </Text>
        <FieldError className="text-xs font-medium text-loss">
          {errorMessage}
        </FieldError>
      </AriaDateField>
    </I18nProvider>
  );
}
