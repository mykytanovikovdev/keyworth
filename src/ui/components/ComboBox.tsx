import { Check, ChevronDown, LoaderCircle, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { typedText } from "../../../shared/schemas/text.ts";
import {
  ComboBox as AriaComboBox,
  Button as AriaButton,
  FieldError,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
} from "react-aria-components";

export interface ComboBoxOption {
  id: string;
  /** What the field shows once chosen: "Bitcoin", "Georgian Lari". */
  label: string;
  /** A quieter word after it, also matched when typing: "BTC", "GEL". */
  detail?: string;
  /** A small picture before it, such as a coin's logo. */
  icon?: ReactNode;
}

interface ComboBoxProps {
  label: string;
  /** Visually hidden, for a field whose meaning the surrounding text gives. */
  hideLabel?: boolean;
  placeholder?: string;
  options: readonly ComboBoxOption[];
  /** The chosen option's id. */
  value: string | null;
  onChange?: (id: string | null) => void;
  /**
   * What is typed. Give it with `onInputChange` to search elsewhere and pass
   * the results as `options`; without them the options are filtered here, by
   * label and detail.
   */
  inputValue?: string;
  onInputChange?: (text: string) => void;
  /** Characters the field takes; hidden characters never get in. */
  maxLength?: number;
  /** A search is under way: a spinner in the field, and in an empty list. */
  isLoading?: boolean;
  /** What the open list says when it has no options. */
  emptyMessage?: string;
  /** The chosen option's detail inside the field too; off where it is narrow. */
  showDetail?: boolean;
  description?: string;
  /** Shown, and announced, when `isInvalid` is true. */
  errorMessage?: string;
  isInvalid?: boolean;
  isDisabled?: boolean;
  /** Layout only (margins, width). */
  className?: string;
}

const matches = (option: ComboBoxOption, text: string) => {
  const query = text.trim().toLocaleLowerCase("en");
  return (
    option.label.toLocaleLowerCase("en").includes(query) ||
    (option.detail?.toLocaleLowerCase("en").includes(query) ?? false)
  );
};

/**
 * A field to type into and pick from a list: a coin among thousands, a
 * currency among 163. Opens on typing, on the arrow, or with ↓; the chosen
 * option shows in the field with its picture.
 */
export function ComboBox({
  label,
  hideLabel = false,
  placeholder,
  options,
  value,
  onChange,
  inputValue,
  onInputChange,
  maxLength = 100,
  isLoading = false,
  emptyMessage = "Nothing matches.",
  showDetail = true,
  description,
  errorMessage,
  isInvalid = false,
  isDisabled = false,
  className = "",
}: ComboBoxProps) {
  const selected = options.find((option) => option.id === value) ?? null;
  const [ownText, setOwnText] = useState(selected?.label ?? "");
  const text = inputValue ?? ownText;
  // The chosen option's own label is no search: the list shows everything.
  const showsChoice = selected !== null && text === selected.label;
  const shown =
    onInputChange || showsChoice || !text.trim()
      ? options
      : options.filter((option) => matches(option, text));
  return (
    <AriaComboBox
      items={shown}
      value={value}
      inputValue={text}
      onInputChange={(next) => {
        const kept = typedText(next, maxLength);
        setOwnText(kept);
        onInputChange?.(kept);
      }}
      onChange={(key) => {
        const chosen = options.find((option) => option.id === key);
        // With the text in our hands, the chosen label has to be put in it.
        if (chosen) {
          setOwnText(chosen.label);
          onInputChange?.(chosen.label);
        }
        onChange?.(typeof key === "string" ? key : null);
      }}
      menuTrigger="input"
      allowsEmptyCollection
      isInvalid={isInvalid}
      isDisabled={isDisabled}
      validationBehavior="aria"
      className={`group/field flex flex-col gap-1.5 ${className}`}
    >
      <Label className={hideLabel ? "sr-only" : "text-sm font-medium text-fg"}>
        {label}
      </Label>
      <Group className="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border border-line-strong bg-raised pl-3 text-md text-fg transition-colors duration-(--kw-duration-fast) data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focus-within:border-focus data-focus-within:ring-1 data-focus-within:ring-focus data-hovered:border-fg-muted data-invalid:border-loss data-invalid:data-focus-within:ring-loss">
        {showsChoice ? (
          selected.icon && (
            <span className="flex shrink-0" aria-hidden="true">
              {selected.icon}
            </span>
          )
        ) : (
          <Search aria-hidden="true" className="shrink-0 text-fg-muted" />
        )}
        <Input
          maxLength={maxLength}
          {...(placeholder !== undefined && { placeholder })}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted"
        />
        {showDetail && showsChoice && selected.detail && (
          <span className="shrink-0 text-sm text-fg-muted">
            {selected.detail}
          </span>
        )}
        {isLoading && (
          <LoaderCircle
            aria-hidden="true"
            className="shrink-0 animate-spin text-fg-muted"
          />
        )}
        <AriaButton
          aria-label={`Show ${label.toLocaleLowerCase("en")} options`}
          className="flex h-full shrink-0 items-center rounded-r-md pr-3 pl-1 text-fg-muted data-hovered:text-fg"
        >
          <ChevronDown aria-hidden="true" />
        </AriaButton>
      </Group>
      {description && (
        <Text slot="description" className="text-xs text-fg-muted">
          {description}
        </Text>
      )}
      <FieldError className="text-xs font-medium text-loss">
        {errorMessage}
      </FieldError>
      <Popover
        placement="bottom start"
        className="w-max max-w-[min(20rem,calc(100vw-24px))] min-w-(--trigger-width) rounded-md border border-line bg-raised p-1 shadow-raised data-entering:animate-fade-in data-exiting:animate-fade-out"
      >
        <ListBox
          className="max-h-72 overflow-x-hidden overflow-y-auto outline-none"
          renderEmptyState={() => (
            <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-fg-muted">
              {isLoading && (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              )}
              {isLoading ? "Searching…" : emptyMessage}
            </p>
          )}
        >
          {(option: ComboBoxOption) => (
            <ListBoxItem
              id={option.id}
              textValue={option.label}
              className="group flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-fg outline-none data-focused:bg-hover"
            >
              {option.icon && (
                <span className="flex shrink-0" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="min-w-0 truncate">{option.label}</span>
              {option.detail && (
                <span className="min-w-0 truncate text-fg-muted">
                  {option.detail}
                </span>
              )}
              <Check
                aria-hidden="true"
                className="ml-auto shrink-0 text-accent opacity-0 group-data-selected:opacity-100"
              />
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
